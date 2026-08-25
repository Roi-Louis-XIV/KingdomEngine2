"""Cycle de vie persistant des occurrences KingdomEvent.

Une définition versionnée décrit les effets. Cette table ne stocke que son
exécution (état, portée et échéances), sans recopier les modificateurs.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

ACTIVE, PAUSED, SCHEDULED, FINISHED, DISABLED = "active", "paused", "scheduled", "finished", "disabled"

def _iso() -> str: return datetime.now(timezone.utc).isoformat()

class EventLifecycle:
    def __init__(self, store): self.store = store

    def activate(self, event_key: str, duration_seconds: float | None = None, *, scope: dict[str, Any] | None = None, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else float(now)
        definition = self.store.get("event", event_key, published=True)
        duration = float(duration_seconds if duration_seconds is not None else definition["payload"].get("duration_seconds", 3600))
        occurrence_id = f"occ_{uuid.uuid4().hex[:16]}"
        with self.store.connection() as db:
            db.execute("INSERT INTO event_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (occurrence_id,event_key,ACTIVE,json.dumps(scope or definition["payload"].get("scope", {}),ensure_ascii=False),now,now+max(0,duration),None,None,None,"{}",_iso(),_iso()))
        return self.get(occurrence_id, now)

    def schedule(self, event_key: str, scheduled_at: float, duration_seconds: float, *, scope: dict[str, Any] | None = None, metadata:dict[str,Any]|None=None) -> dict[str, Any]:
        self.store.get("event", event_key, published=True)
        occurrence_id = f"occ_{uuid.uuid4().hex[:16]}"; stamp=_iso()
        with self.store.connection() as db:
            db.execute("INSERT INTO event_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (occurrence_id,event_key,SCHEDULED,json.dumps(scope or {},ensure_ascii=False),None,None,float(scheduled_at),None,float(duration_seconds),json.dumps(metadata or {},ensure_ascii=False),stamp,stamp))
        return self.get(occurrence_id)

    def schedule_world(self,event_key:str,start:dict[str,Any],end:dict[str,Any],*,scope:dict[str,Any]|None=None,now:float|None=None)->dict[str,Any]:
        from .calendar import CalendarEngine
        from .runtime import WorldClock
        now=time.time() if now is None else float(now); config=WorldClock(self.store)._config(); world=WorldClock(self.store).state(now=now)
        if config.get("clock_mode","accelerated")=="manual" or float(world["speed"])<=0: raise ValueError("La programmation en date monde exige une horloge autonome active.")
        calendar=CalendarEngine(config.get("calendar")); target=calendar.to_world_hours(int(start["year"]),str(start["month_key"]),int(start["day"]),int(start.get("hour",0)),int(start.get("minute",0))); finish=calendar.to_world_hours(int(end["year"]),str(end["month_key"]),int(end["day"]),int(end.get("hour",0)),int(end.get("minute",0)))
        if finish<=target: raise ValueError("La fin monde doit être postérieure au début.")
        real_start=now+(target-float(world["world_hours"]))*3600/float(world["speed"]); real_duration=(finish-target)*3600/float(world["speed"])
        return self.schedule(event_key,real_start,real_duration,scope=scope,metadata={"world_start":start,"world_end":end,"world_start_hours":target,"world_end_hours":finish})

    def _advance(self, now: float) -> None:
        with self.store.connection() as db:
            rows=db.execute("SELECT occurrence_id,scheduled_at,remaining_seconds FROM event_occurrences WHERE status=? AND scheduled_at<=?",(SCHEDULED,now)).fetchall()
            for row in rows:
                duration=max(0,float(row["remaining_seconds"] or 0)); db.execute("UPDATE event_occurrences SET status=?,started_at=?,ends_at=?,scheduled_at=NULL,remaining_seconds=NULL,updated_at=? WHERE occurrence_id=?",(ACTIVE,now,now+duration,_iso(),row["occurrence_id"]))
            db.execute("UPDATE event_occurrences SET status=?,updated_at=? WHERE status=? AND ends_at IS NOT NULL AND ends_at<=?",(FINISHED,_iso(),ACTIVE,now))

    def list(self, *, now: float | None = None) -> list[dict[str, Any]]:
        now=time.time() if now is None else float(now); self._advance(now)
        with self.store.connection() as db: rows=db.execute("SELECT * FROM event_occurrences ORDER BY created_at DESC").fetchall()
        return [self._row(row,now) for row in rows]

    def get(self, occurrence_id: str, now: float | None = None) -> dict[str, Any]:
        now=time.time() if now is None else float(now); self._advance(now)
        with self.store.connection() as db: row=db.execute("SELECT * FROM event_occurrences WHERE occurrence_id=?",(occurrence_id,)).fetchone()
        if not row: raise LookupError("Occurrence Event introuvable.")
        return self._row(row,now)

    def pause(self, occurrence_id: str, *, now: float | None = None) -> dict[str, Any]:
        now=time.time() if now is None else float(now); current=self.get(occurrence_id,now)
        if current["status"] != ACTIVE: raise ValueError("Seul un événement actif peut être mis en pause.")
        remaining=max(0,float(current["ends_at"])-now)
        self._update(occurrence_id,status=PAUSED,paused_at=now,remaining_seconds=remaining,ends_at=None); return self.get(occurrence_id,now)

    def resume(self, occurrence_id: str, *, now: float | None = None) -> dict[str, Any]:
        now=time.time() if now is None else float(now); current=self.get(occurrence_id,now)
        if current["status"] != PAUSED: raise ValueError("Seul un événement en pause peut être repris.")
        self._update(occurrence_id,status=ACTIVE,paused_at=None,ends_at=now+float(current["remaining_seconds"] or 0),remaining_seconds=None); return self.get(occurrence_id,now)

    def extend(self, occurrence_id: str, seconds: float, *, now: float | None = None) -> dict[str, Any]:
        now=time.time() if now is None else float(now); current=self.get(occurrence_id,now); seconds=float(seconds)
        if current["status"]==ACTIVE: self._update(occurrence_id,ends_at=float(current["ends_at"])+seconds)
        elif current["status"]==PAUSED: self._update(occurrence_id,remaining_seconds=max(0,float(current["remaining_seconds"] or 0)+seconds))
        else: raise ValueError("Cet événement ne peut pas être prolongé.")
        return self.get(occurrence_id,now)

    def stop(self, occurrence_id: str, *, now: float | None = None) -> dict[str, Any]:
        now=time.time() if now is None else float(now); self.get(occurrence_id,now)
        self._update(occurrence_id,status=FINISHED,ends_at=now,paused_at=None,remaining_seconds=None); return self.get(occurrence_id,now)

    def active_definitions(self, now: float | None = None) -> list[dict[str, Any]]:
        result=[]
        for occurrence in self.list(now=now):
            if occurrence["status"]!=ACTIVE: continue
            try: definition=self.store.get("event",occurrence["event_key"],published=True)["payload"]
            except Exception: continue
            result.append({"key":occurrence["event_key"],**definition,"active":True,"occurrence":occurrence,"scope":occurrence["scope"] or definition.get("scope",{})})
        return result

    def _update(self, occurrence_id: str, **values) -> None:
        fields=list(values); args=[values[field] for field in fields]
        with self.store.connection() as db: db.execute(f"UPDATE event_occurrences SET {','.join(field+'=?' for field in fields)},updated_at=? WHERE occurrence_id=?",(*args,_iso(),occurrence_id))

    @staticmethod
    def _row(row, now: float) -> dict[str, Any]:
        value=dict(row); value["scope"]=json.loads(value.pop("scope_json") or "{}"); value["metadata"]=json.loads(value.pop("metadata_json") or "{}")
        value["remaining_seconds"]=max(0,int(float(value["ends_at"])-now)) if value["status"]==ACTIVE and value["ends_at"] is not None else (int(value["remaining_seconds"]) if value["remaining_seconds"] is not None else None)
        return value
