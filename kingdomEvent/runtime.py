"""Horloge persistante et activation temporelle du monde."""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from typing import Any

from .lifecycle import EventLifecycle
from .calendar import CalendarEngine

DEFAULT_CLIMATE = [
    {"key":"clear","name":"Beau / éclaircies","emoji":"☀️","weight":35,"rain_probability":10,"temperature_min":8,"temperature_max":16},
    {"key":"cloudy","name":"Nuageux","emoji":"☁️","weight":25,"rain_probability":25,"temperature_min":7,"temperature_max":14},
    {"key":"light_rain","name":"Pluie légère","emoji":"🌦️","weight":20,"rain_probability":55,"temperature_min":7,"temperature_max":13},
    {"key":"rain","name":"Pluie","emoji":"🌧️","weight":10,"rain_probability":80,"temperature_min":6,"temperature_max":12},
    {"key":"fog","name":"Brouillard","emoji":"🌫️","weight":5,"rain_probability":15,"temperature_min":5,"temperature_max":11},
    {"key":"storm","name":"Orage","emoji":"⛈️","weight":5,"rain_probability":95,"temperature_min":8,"temperature_max":15},
]


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp(value: Any) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def event_is_active(payload: dict[str, Any], now: float | None = None) -> bool:
    now = time.time() if now is None else now
    if payload.get("enabled") is False:
        return False
    trigger = payload.get("trigger", {}).get("type", "manual")
    if trigger != "scheduled":
        return bool(payload.get("active") or payload.get("status") == "active" or (payload.get("enabled") and trigger == "manual"))
    starts, ends = _timestamp(payload.get("starts_at")), _timestamp(payload.get("ends_at"))
    return (starts is None or now >= starts) and (ends is None or now < ends)


class WorldClock:
    """Reconstruit l'heure depuis un ancrage durable, sans timer mémoire obligatoire."""

    KEY = "realm_clock"

    def __init__(self, store):
        self.store = store

    def _config(self) -> dict[str, Any]:
        rows = self.store.list("environment", published=True) or self.store.list("environment")
        return rows[0]["payload"] if rows else {"day": 1, "hour": 12, "speed": 1, "mode": "manual", "weather": {"key": "clear", "name": "Beau", "emoji": "☀️"}}

    def _runtime(self, now: float) -> dict[str, Any]:
        with self.store.connection() as db:
            row = db.execute("SELECT value_json FROM world_runtime WHERE runtime_key=?", (self.KEY,)).fetchone()
            if row:
                current = json.loads(row[0])
                config = self._config()
                if current.get("config_version") != config:
                    current = {
                        "anchor_real": now,
                        "anchor_world_hours": (max(1, int(config.get("day", 1))) - 1) * 24 + int(config.get("hour", 12)) + int(config.get("minute", 0)) / 60,
                        "weather": config.get("weather", {}), "weather_changed_at": now,
                        "weather_transition": 0, "config_version": config,
                    }
                    db.execute("UPDATE world_runtime SET value_json=?,updated_at=? WHERE runtime_key=?", (json.dumps(current, ensure_ascii=False), _iso_now(), self.KEY))
                return current
            config = self._config()
            value = {
                "anchor_real": now,
                "anchor_world_hours": (max(1, int(config.get("day", 1))) - 1) * 24 + int(config.get("hour", 12)) + int(config.get("minute", 0)) / 60,
                "weather": config.get("weather", {}),
                "weather_changed_at": now,
                "weather_transition": 0,
                "config_version": config,
            }
            db.execute("INSERT INTO world_runtime VALUES(?,?,?)", (self.KEY, json.dumps(value, ensure_ascii=False), _iso_now()))
            return value

    def state(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else float(now)
        config, runtime = self._config(), self._runtime(now)
        speed = max(0.0, float(config.get("speed", 1)))
        if config.get("clock_mode", "accelerated") == "manual":
            total_hours = (int(config.get("day", 1)) - 1) * 24 + int(config.get("hour", 12)) + int(config.get("minute", 0)) / 60
        else:
            total_hours = runtime["anchor_world_hours"] + (now - runtime["anchor_real"]) * speed / 3600
        day, hour = int(total_hours // 24) + 1, int(total_hours % 24)
        minute = int((total_hours % 1) * 60)
        calendar=CalendarEngine(config.get("calendar")); world_date=calendar.from_world_hours(total_hours); season=calendar.season(world_date)
        weather = self._weather(config, runtime, now)
        period = "morning" if 5 <= hour < 12 else "day" if 12 <= hour < 18 else "evening" if 18 <= hour < 22 else "night"
        events = []
        occurrences = EventLifecycle(self.store).list(now=now)
        occurrence_keys = {item["event_key"] for item in occurrences}
        for row in self.store.list("event", published=True):
            occurrence=next((item for item in occurrences if item["event_key"]==row["entity_key"] and item["status"]=="active"),None)
            if occurrence or (row["entity_key"] not in occurrence_keys and event_is_active(row["payload"], now)):
                events.append({"key": row["entity_key"], "name": row["payload"].get("name", row["entity_key"]), "emoji": row["payload"].get("emoji", "✦"), "ends_at": occurrence["ends_at"] if occurrence else row["payload"].get("ends_at"),"occurrence_id":occurrence["occurrence_id"] if occurrence else None})
        forecasts=self._forecasts(config,runtime,day,weather,season)
        return {"day": day, "world_hours":total_hours,"date":world_date.dict(),"calendar":{"name":calendar.definition.get("name"),"days_per_year":calendar.days_per_year},"season":season,"hour": hour, "minute": minute, "time_of_day": period, "speed": speed, "weather": weather, "forecasts": forecasts, "active_events": events, "event_occurrences":occurrences, "updated_at": _iso_now()}

    def _forecasts(self, config: dict[str, Any], runtime: dict[str, Any], day: int, current: dict[str, Any], season:dict[str,Any]|None=None) -> list[dict[str, Any]]:
        """Maintient une file glissante; un GET ne rerolle jamais une journée existante."""
        count=max(5,min(7,int(config.get("forecast_days",5))))
        queue=[item for item in runtime.get("forecasts",[]) if int(item.get("day",0))>=day]
        options=config.get("weather_options") or DEFAULT_CLIMATE
        previous=queue[-1] if queue else {**current,"day":day}
        if not queue: queue=[previous]
        event_factors=self._climate_factors()
        for modifier in (season or {}).get("modifiers",[]):
            prop=str(modifier.get("property",""))
            if prop.startswith("weather.probability."):
                key=prop.rsplit(".",1)[-1]; value=float(modifier.get("value",1)); event_factors[key]=event_factors.get(key,1)*(value if modifier.get("operator","multiply")=="multiply" else 1)
        while len(queue)<count:
            target_day=int(queue[-1]["day"])+1
            selected=self._next_weather(options,queue[-1],config.get("weather_transitions",{}),target_day,event_factors)
            queue.append({**selected,"day":target_day})
        runtime["forecasts"]=queue[:count]
        with self.store.connection() as db: db.execute("UPDATE world_runtime SET value_json=?,updated_at=? WHERE runtime_key=?",(json.dumps(runtime,ensure_ascii=False),_iso_now(),self.KEY))
        return runtime["forecasts"]

    def _climate_factors(self) -> dict[str,float]:
        factors={}
        for event in EventLifecycle(self.store).active_definitions():
            for modifier in event.get("modifiers",[]):
                prop=str(modifier.get("property",""))
                if not prop.startswith("weather.probability."): continue
                key=prop.rsplit(".",1)[-1]; value=float(modifier.get("value",1)); op=modifier.get("operator","multiply")
                factors[key]=value if op=="set" else factors.get(key,1)*(value if op=="multiply" else 1)+ (value if op=="add" else 0)
        return factors

    @staticmethod
    def _next_weather(options, previous, transitions, day, factors):
        weights=[]; previous_key=str(previous.get("key","")); transition=transitions.get(previous_key,{})
        for option in options:
            weight=max(0,float(option.get("weight",1))) * float(transition.get(option.get("key"),1)) * float(factors.get(option.get("key"),1))
            # Continuité raisonnable par défaut, sans empêcher une configuration explicite.
            if not transition and option.get("key")==previous_key: weight*=1.8
            weights.append(weight)
        rng=random.Random(f"kingdom-weather:{day}:{previous_key}")
        selected=dict(rng.choices(options,weights=weights,k=1)[0]); selected.pop("weight",None); selected.pop("hour",None)
        return selected

    def _weather(self, config: dict[str, Any], runtime: dict[str, Any], now: float) -> dict[str, Any]:
        mode = config.get("mode", "manual")
        if mode == "manual":
            return config.get("weather", runtime.get("weather", {}))
        options = config.get("weather_options", [])
        if not options:
            return config.get("weather", runtime.get("weather", {}))
        interval = max(1, int(config.get("weather_interval_seconds", 3600)))
        transition = int((now - runtime.get("weather_changed_at", now)) // interval)
        if transition <= int(runtime.get("weather_transition", 0)):
            return runtime.get("weather", config.get("weather", {}))
        if mode == "scheduled":
            matching = [item for item in options if int(item.get("hour", -1)) <= self.state_hour(config, runtime, now)]
            selected = (matching or options)[-1]
        else:  # weighted / automatic
            rng = random.Random(f"{runtime.get('anchor_real')}:{transition}")
            selected = rng.choices(options, weights=[max(0.0, float(item.get("weight", 1))) for item in options], k=1)[0]
        weather = {key: value for key, value in selected.items() if key not in {"weight", "hour"}}
        runtime.update({"weather": weather, "weather_changed_at": runtime.get("weather_changed_at", now) + transition * interval, "weather_transition": transition})
        with self.store.connection() as db:
            db.execute("UPDATE world_runtime SET value_json=?,updated_at=? WHERE runtime_key=?", (json.dumps(runtime, ensure_ascii=False), _iso_now(), self.KEY))
        return weather

    @staticmethod
    def state_hour(config: dict[str, Any], runtime: dict[str, Any], now: float) -> int:
        speed = max(0.0, float(config.get("speed", 1)))
        total = runtime["anchor_world_hours"] + (now - runtime["anchor_real"]) * speed / 3600
        return int(total % 24)
