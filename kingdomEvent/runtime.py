"""Horloge persistante et activation temporelle du monde."""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from typing import Any


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
        weather = self._weather(config, runtime, now)
        period = "morning" if 5 <= hour < 12 else "day" if 12 <= hour < 18 else "evening" if 18 <= hour < 22 else "night"
        events = []
        for row in self.store.list("event", published=True):
            if event_is_active(row["payload"], now):
                events.append({"key": row["entity_key"], "name": row["payload"].get("name", row["entity_key"]), "emoji": row["payload"].get("emoji", "✦"), "ends_at": row["payload"].get("ends_at")})
        return {"day": day, "hour": hour, "minute": minute, "time_of_day": period, "speed": speed, "weather": weather, "active_events": events, "updated_at": _iso_now()}

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
        else:
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
