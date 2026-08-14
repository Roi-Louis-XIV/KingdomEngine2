"""Interprète les actions no-code de façon atomique et idempotente."""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from typing import Any

from KingdomData import ContentStore, NotFoundError, ValidationError
from import_v1 import actions_from_modules
from kingdomEvent import Event, EventBus


class GameEngine:
    def __init__(self, store: ContentStore, bus: EventBus | None = None, rng: random.Random | None = None) -> None:
        self.store, self.bus, self.rng = store, bus or EventBus(), rng or random.Random()

    def buildings(self) -> list[dict[str, Any]]:
        buildings = self.store.list("building", published=True)
        for entity in buildings:
            payload = entity["payload"]
            if payload.get("action_mode") == "generated":
                payload["actions"] = actions_from_modules(entity["entity_key"], payload.get("modules", {}))
        return buildings

    def building(self, key: str) -> dict[str, Any]:
        entity = self.store.get("building", key, published=True)
        payload = entity["payload"]
        if payload.get("action_mode") == "generated":
            payload["actions"] = actions_from_modules(key, payload.get("modules", {}))
        return entity

    async def execute(self, discord_id: str, building_key: str, action_key: str, interaction_id: str) -> dict[str, Any]:
        building = self.building(building_key)["payload"]
        actions = actions_from_modules(building_key, building.get("modules", {})) if building.get("action_mode") == "generated" else building.get("actions", [])
        action = next((a for a in actions if a.get("key") == action_key), None)
        if not action or not action.get("enabled", True):
            raise NotFoundError("Cette action n’est pas disponible.")
        emitted: list[Event] = []
        messages: list[str] = []
        with self.store.connection() as db:
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at) VALUES(?,?)", (discord_id, _now()))
            self._check_cooldowns(db, discord_id, building_key, action)
            self._check_requirements(db, discord_id, action.get("requirements", {}))
            effects = list(action.get("effects", []))
            while effects:
                effect = effects.pop(0)
                kind = effect["type"]
                if kind == "message": messages.append(str(effect.get("text", "")))
                elif kind in {"reward", "cost"}:
                    amount = int(effect.get("amount", 0)) * (1 if kind == "reward" else -1)
                    self._change_resource(db, discord_id, effect.get("resource", "money"), amount)
                elif kind == "random_reward":
                    choices = effect.get("choices", [])
                    chosen = self.rng.choices(choices, weights=[x.get("weight", 1) for x in choices], k=1)[0]
                    self._change_resource(db, discord_id, chosen["item"], self.rng.randint(int(chosen.get("min", 1)), int(chosen.get("max", 1))))
                elif kind == "random_bundle":
                    outcomes = effect.get("outcomes", [])
                    chosen = self.rng.choices(outcomes, weights=[x.get("weight", 1) for x in outcomes], k=1)[0]
                    bonus = 0
                    if effect.get("loot_bonus_tool"):
                        row = db.execute("SELECT loot_bonus FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, effect["loot_bonus_tool"])).fetchone()
                        bonus = int(row[0]) if row else 0
                    for resource, quantity in chosen.get("rewards", {}).items():
                        minimum, maximum = self._range(quantity)
                        self._change_resource(db, discord_id, resource, self.rng.randint(minimum, maximum) + bonus)
                elif kind == "random_message":
                    choices = effect.get("choices", [])
                    chosen = self.rng.choices(choices, weights=[x.get("weight", 1) for x in choices], k=1)[0]
                    messages.append(str(chosen.get("text", "")))
                elif kind in {"stock_cost", "stock_reward"}:
                    amount = int(effect.get("amount", 0)) * (1 if kind == "stock_reward" else -1)
                    stock_building = str(effect.get("building", building_key))
                    self._change_stock(db, stock_building, str(effect["item"]), amount, int(effect.get("initial_stock", 0)))
                elif kind == "profession":
                    self._award_experience(
                        db, discord_id, str(effect["profession"]), int(effect.get("experience", 0)),
                        int(effect.get("experience_per_level", 100)),
                    )
                elif kind == "durability":
                    self._use_tool(
                        db, discord_id, str(effect["tool"]), int(effect.get("amount", 1)),
                        int(effect.get("max_durability", 1)),
                    )
                elif kind == "repair":
                    self._repair_tool(db, discord_id, str(effect["tool"]), int(effect.get("max_durability", 1)), int(effect.get("price_per_point", 1)))
                elif kind == "upgrade":
                    self._upgrade_tool(
                        db, discord_id, str(effect["tool"]), int(effect.get("to_level", 1)),
                        int(effect.get("max_durability", 1)), int(effect.get("loot_bonus", 0)),
                    )
                elif kind == "schedule":
                    pending = db.execute(
                        "SELECT 1 FROM scheduled_actions WHERE discord_id=? AND building_key=? AND action_key=? AND status='pending'",
                        (discord_id, building_key, effect["action"]),
                    ).fetchone()
                    if pending:
                        raise ValidationError("Cette activite est deja en cours.")
                    ready_at = time.time() + int(effect.get("duration_seconds", 0))
                    db.execute(
                        "INSERT INTO scheduled_actions(discord_id,building_key,action_key,ready_at,effects_json,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
                        (discord_id, building_key, effect["action"], ready_at, json.dumps(effect.get("effects", []), ensure_ascii=False), _now()),
                    )
                    messages.append(f"Activite lancee. Recuperation disponible dans {int(effect.get('duration_seconds', 0))} seconde(s).")
                elif kind == "claim_scheduled":
                    job = db.execute(
                        "SELECT * FROM scheduled_actions WHERE discord_id=? AND building_key=? AND action_key=? AND status='pending' ORDER BY id LIMIT 1",
                        (discord_id, building_key, effect["action"]),
                    ).fetchone()
                    if not job:
                        raise ValidationError("Aucune activite terminee a recuperer.")
                    if float(job["ready_at"]) > time.time():
                        raise ValidationError(f"Cette activite sera terminee dans {int(float(job['ready_at']) - time.time()) + 1} seconde(s).")
                    db.execute("UPDATE scheduled_actions SET status='completed',completed_at=? WHERE id=?", (_now(), job["id"]))
                    effects[0:0] = json.loads(job["effects_json"])
                elif kind == "emit": emitted.append(Event(str(effect["event"]), f"building:{building_key}", {"discord_id": discord_id, **effect.get("payload", {})}))
            snapshot = self.player(discord_id, db)
            result = {
                "ok": True, "messages": messages, "player": snapshot, "action": action_key,
                "duration_seconds": int(action.get("duration_seconds", 0)),
            }
            self._set_cooldowns(db, discord_id, building_key, action)
            db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES(?,?,?,?,?,?)", (interaction_id, discord_id, building_key, action_key, json.dumps(result, ensure_ascii=False), _now()))
        for event in emitted: await self.bus.publish(event)
        await self.bus.publish(Event("game.action.completed", "kingdomCore", {"discord_id": discord_id, "building": building_key, "action": action_key}))
        return result

    def player(self, discord_id: str, db=None) -> dict[str, Any]:
        def read(connection):
            row = connection.execute("SELECT * FROM players WHERE discord_id=?", (discord_id,)).fetchone()
            inventory = connection.execute("SELECT item_key,quantity FROM inventory WHERE discord_id=? AND quantity>0", (discord_id,)).fetchall()
            professions = connection.execute("SELECT profession_key,level,experience FROM player_professions WHERE discord_id=?", (discord_id,)).fetchall()
            tools = connection.execute("SELECT tool_key,durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id=?", (discord_id,)).fetchall()
            return {
                "discord_id": discord_id,
                "money": int(row["money"]) if row else 0,
                "energy": int(row["energy"]) if row else 100,
                "inventory": {r[0]: int(r[1]) for r in inventory},
                "professions": {r[0]: {"level": int(r[1]), "experience": int(r[2])} for r in professions},
                "tools": {r[0]: {"durability": int(r[1]), "max_durability": int(r[2]), "level": int(r[3]), "loot_bonus": int(r[4])} for r in tools},
            }
        if db is not None: return read(db)
        with self.store.connection() as connection: return read(connection)

    def pending_actions(self, discord_id: str, building_key: str) -> list[dict[str, Any]]:
        """Retourne les activités encore en attente pour piloter l'interface."""
        with self.store.connection() as db:
            rows = db.execute(
                "SELECT action_key,ready_at FROM scheduled_actions "
                "WHERE discord_id=? AND building_key=? AND status='pending' ORDER BY id",
                (discord_id, building_key),
            ).fetchall()
        return [{"action": str(row[0]), "ready_at": float(row[1])} for row in rows]

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

    @staticmethod
    def _range(value: Any) -> tuple[int, int]:
        if isinstance(value, list):
            return int(value[0]), int(value[-1])
        if isinstance(value, dict):
            return int(value.get("min", 0)), int(value.get("max", value.get("min", 0)))
        return int(value), int(value)

    @staticmethod
    def _check_requirements(db, discord_id: str, requirements: dict[str, Any]) -> None:
        profession = str(requirements.get("profession", "")).strip()
        if profession:
            row = db.execute(
                "SELECT level FROM player_professions WHERE discord_id=? AND profession_key=?",
                (discord_id, profession),
            ).fetchone()
            if not row or int(row[0]) < int(requirements.get("min_level", 1)):
                raise ValidationError(f"Niveau insuffisant pour le m\u00e9tier {profession}.")
        for item, amount in requirements.get("items", {}).items():
            row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, item)).fetchone()
            if not row or int(row[0]) < int(amount):
                raise ValidationError(f"Objet requis : {item}.")
        if requirements.get("tool"):
            row = db.execute("SELECT level FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, requirements["tool"])).fetchone()
            if not row or int(row[0]) != int(requirements.get("tool_level", 1)):
                raise ValidationError(f"Niveau d'outil requis : {requirements.get('tool_level', 1)}.")

    @staticmethod
    def _change_stock(db, building_key: str, item_key: str, amount: int, initial_stock: int = 0) -> None:
        row = db.execute("SELECT quantity FROM building_stock WHERE building_key=? AND item_key=?", (building_key, item_key)).fetchone()
        current = int(row[0]) if row else initial_stock
        if current + amount < 0:
            raise ValidationError(f"Stock insuffisant : {item_key}.")
        db.execute(
            "INSERT INTO building_stock(building_key,item_key,quantity) VALUES(?,?,?) "
            "ON CONFLICT(building_key,item_key) DO UPDATE SET quantity=excluded.quantity",
            (building_key, item_key, current + amount),
        )

    @staticmethod
    def _award_experience(db, discord_id: str, profession: str, experience: int, experience_per_level: int) -> None:
        row = db.execute(
            "SELECT experience FROM player_professions WHERE discord_id=? AND profession_key=?",
            (discord_id, profession),
        ).fetchone()
        total = (int(row[0]) if row else 0) + experience
        level = max(1, total // max(1, experience_per_level) + 1)
        db.execute(
            "INSERT INTO player_professions(discord_id,profession_key,level,experience) VALUES(?,?,?,?) "
            "ON CONFLICT(discord_id,profession_key) DO UPDATE SET level=excluded.level,experience=excluded.experience",
            (discord_id, profession, level, total),
        )

    @staticmethod
    def _use_tool(db, discord_id: str, tool: str, amount: int, max_durability: int) -> None:
        row = db.execute(
            "SELECT durability,max_durability FROM player_tools WHERE discord_id=? AND tool_key=?",
            (discord_id, tool),
        ).fetchone()
        current, maximum = (int(row[0]), int(row[1])) if row else (max_durability, max_durability)
        if current - amount < 0:
            raise ValidationError(f"L'outil {tool} doit \u00eatre r\u00e9par\u00e9.")
        db.execute(
            "INSERT INTO player_tools(discord_id,tool_key,durability,max_durability) VALUES(?,?,?,?) "
            "ON CONFLICT(discord_id,tool_key) DO UPDATE SET durability=excluded.durability,max_durability=excluded.max_durability",
            (discord_id, tool, current - amount, maximum),
        )

    @classmethod
    def _repair_tool(cls, db, discord_id: str, tool: str, configured_maximum: int, price_per_point: int) -> None:
        row = db.execute("SELECT durability,max_durability FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, tool)).fetchone()
        if not row:
            raise ValidationError(f"Aucun outil a reparer : {tool}.")
        current, maximum = int(row[0]), int(row[1])
        missing = maximum - current
        if missing <= 0:
            raise ValidationError(f"L'outil {tool} est deja en parfait etat.")
        cls._change_resource(db, discord_id, "money", -(missing * price_per_point))
        db.execute("UPDATE player_tools SET durability=?,max_durability=? WHERE discord_id=? AND tool_key=?", (maximum, maximum, discord_id, tool))

    @staticmethod
    def _upgrade_tool(db, discord_id: str, tool: str, to_level: int, maximum: int, loot_bonus: int) -> None:
        row = db.execute("SELECT level FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, tool)).fetchone()
        if not row:
            raise ValidationError(f"Aucun outil a ameliorer : {tool}.")
        if int(row[0]) >= to_level:
            raise ValidationError(f"L'amelioration de {tool} est deja appliquee.")
        db.execute(
            "UPDATE player_tools SET level=?,durability=?,max_durability=?,loot_bonus=? WHERE discord_id=? AND tool_key=?",
            (to_level, maximum, maximum, loot_bonus, discord_id, tool),
        )

    @staticmethod
    def _check_cooldowns(db, discord_id: str, building_key: str, action: dict[str, Any]) -> None:
        now = time.time()
        scopes = []
        if int(action.get("cooldown_seconds", 0)) > 0:
            scopes.append(f"player:{discord_id}")
        if int(action.get("global_cooldown_seconds", 0)) > 0:
            scopes.append("global")
        for scope in scopes:
            row = db.execute("SELECT ready_at FROM action_cooldowns WHERE scope=? AND building_key=? AND action_key=?", (scope, building_key, action["key"])).fetchone()
            if row and float(row[0]) > now:
                raise ValidationError(f"Cette action sera de nouveau disponible dans {int(float(row[0]) - now) + 1} seconde(s).")

    @staticmethod
    def _set_cooldowns(db, discord_id: str, building_key: str, action: dict[str, Any]) -> None:
        for scope, seconds in (
            (f"player:{discord_id}", int(action.get("cooldown_seconds", 0))),
            ("global", int(action.get("global_cooldown_seconds", 0))),
        ):
            if seconds <= 0:
                continue
            db.execute(
                "INSERT INTO action_cooldowns(scope,building_key,action_key,ready_at) VALUES(?,?,?,?) "
                "ON CONFLICT(scope,building_key,action_key) DO UPDATE SET ready_at=excluded.ready_at",
                (scope, building_key, action["key"], time.time() + seconds),
            )


def _now() -> str: return datetime.now(timezone.utc).isoformat()

