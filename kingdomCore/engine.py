"""Interprète les actions no-code de façon atomique et idempotente."""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from typing import Any

from KingdomData import ContentStore, NotFoundError, ValidationError
from kingdomEvent import Event, EventBus


class GameEngine:
    def __init__(self, store: ContentStore, bus: EventBus | None = None, rng: random.Random | None = None) -> None:
        self.store, self.bus, self.rng = store, bus or EventBus(), rng or random.Random()

    def buildings(self) -> list[dict[str, Any]]:
        return self.store.list("building", published=True)

    async def execute(self, discord_id: str, building_key: str, action_key: str, interaction_id: str) -> dict[str, Any]:
        building = self.store.get("building", building_key, published=True)["payload"]
        action = next((a for a in building.get("actions", []) if a.get("key") == action_key), None)
        if not action or not action.get("enabled", True):
            raise NotFoundError("Cette action n’est pas disponible.")
        emitted: list[Event] = []
        messages: list[str] = []
        with self.store.connection() as db:
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at) VALUES(?,?)", (discord_id, _now()))
            for effect in action.get("effects", []):
                kind = effect["type"]
                if kind == "message": messages.append(str(effect.get("text", "")))
                elif kind in {"reward", "cost"}:
                    amount = int(effect.get("amount", 0)) * (1 if kind == "reward" else -1)
                    self._change_resource(db, discord_id, effect.get("resource", "money"), amount)
                elif kind == "random_reward":
                    choices = effect.get("choices", [])
                    chosen = self.rng.choices(choices, weights=[x.get("weight", 1) for x in choices], k=1)[0]
                    self._change_resource(db, discord_id, chosen["item"], self.rng.randint(int(chosen.get("min", 1)), int(chosen.get("max", 1))))
                elif kind == "emit": emitted.append(Event(str(effect["event"]), f"building:{building_key}", {"discord_id": discord_id, **effect.get("payload", {})}))
            snapshot = self.player(discord_id, db)
            result = {"ok": True, "messages": messages, "player": snapshot, "action": action_key}
            db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES(?,?,?,?,?,?)", (interaction_id, discord_id, building_key, action_key, json.dumps(result, ensure_ascii=False), _now()))
        for event in emitted: await self.bus.publish(event)
        await self.bus.publish(Event("game.action.completed", "kingdomCore", {"discord_id": discord_id, "building": building_key, "action": action_key}))
        return result

    def player(self, discord_id: str, db=None) -> dict[str, Any]:
        def read(connection):
            row = connection.execute("SELECT * FROM players WHERE discord_id=?", (discord_id,)).fetchone()
            inventory = connection.execute("SELECT item_key,quantity FROM inventory WHERE discord_id=? AND quantity>0", (discord_id,)).fetchall()
            return {"discord_id": discord_id, "money": int(row["money"]) if row else 0, "energy": int(row["energy"]) if row else 100, "inventory": {r[0]: int(r[1]) for r in inventory}}
        if db is not None: return read(db)
        with self.store.connection() as connection: return read(connection)

    @staticmethod
    def _change_resource(db, discord_id: str, resource: str, amount: int) -> None:
        if resource in {"money", "energy"}:
            current = int(db.execute(f"SELECT {resource} FROM players WHERE discord_id=?", (discord_id,)).fetchone()[0])
            if current + amount < 0: raise ValidationError(f"Ressource insuffisante : {resource}.")
            db.execute(f"UPDATE players SET {resource}=?,updated_at=? WHERE discord_id=?", (current + amount, _now(), discord_id))
        else:
            current_row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, resource)).fetchone()
            current = int(current_row[0]) if current_row else 0
            if current + amount < 0: raise ValidationError(f"Objet insuffisant : {resource}.")
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,?) ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=excluded.quantity", (discord_id, resource, current + amount))


def _now() -> str: return datetime.now(timezone.utc).isoformat()

