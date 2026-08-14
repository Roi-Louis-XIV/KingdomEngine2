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

    async def execute(
        self, discord_id: str, building_key: str, action_key: str, interaction_id: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            return await self._execute(discord_id, building_key, action_key, interaction_id, context or {})
        except Exception as exc:
            try:
                action = next(item for item in self.building(building_key)["payload"].get("actions", []) if item.get("key") == action_key)
                for event in self._hook_events(action.get("hooks", {}), "on_failure", discord_id, building_key, action_key, {"error": str(exc)}):
                    await self.bus.publish(event)
            except Exception:
                pass
            raise

    async def _execute(
        self, discord_id: str, building_key: str, action_key: str, interaction_id: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        building = self.building(building_key)["payload"]
        actions = actions_from_modules(building_key, building.get("modules", {})) if building.get("action_mode") == "generated" else building.get("actions", [])
        action = next((a for a in actions if a.get("key") == action_key), None)
        if not action or not action.get("enabled", True):
            raise NotFoundError("Cette action n’est pas disponible.")
        emitted: list[Event] = []
        messages: list[str] = []
        selected_results: list[str] = []
        with self.store.connection() as db:
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at) VALUES(?,?)", (discord_id, _now()))
            self._check_cooldowns(db, discord_id, building_key, action)
            self._check_requirements(db, discord_id, action.get("requirements", {}))
            self._check_condition(db, discord_id, building_key, action_key, action.get("conditions"), context)
            emitted.extend(self._hook_events(action.get("hooks", {}), "on_start", discord_id, building_key, action_key))
            effects = list(action.get("effects", []))
            while effects:
                effect = effects.pop(0)
                kind = effect["type"]
                if kind == "message": messages.append(str(effect.get("text", "")))
                elif kind in {"reward", "cost"}:
                    minimum, maximum = self._range(effect.get("amount", 0))
                    amount = self.rng.randint(minimum, maximum) * (1 if kind == "reward" else -1)
                    self._change_resource(db, discord_id, effect.get("resource", "money"), amount)
                elif kind == "production":
                    minimum, maximum = self._range(effect.get("amount", 0))
                    amount = self.rng.randint(minimum, maximum)
                    resource = str(effect.get("resource", effect.get("item")))
                    if effect.get("destination", "player_inventory") in {"player", "player_inventory"}:
                        self._change_resource(db, discord_id, resource, amount)
                    else:
                        self._change_stock(db, str(effect.get("building", building_key)), resource, amount)
                elif kind == "random_reward":
                    choices = effect.get("choices", [])
                    chosen = self.rng.choices(choices, weights=[x.get("weight", 1) for x in choices], k=1)[0]
                    self._change_resource(db, discord_id, chosen["item"], self.rng.randint(int(chosen.get("min", 1)), int(chosen.get("max", 1))))
                    selected_results.append(str(chosen.get("key", chosen["item"])))
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
                    selected_results.append(str(chosen.get("key", "bundle")))
                elif kind == "random_result":
                    outcomes = effect.get("outcomes", [])
                    chosen = self.rng.choices(outcomes, weights=[x.get("weight", 1) for x in outcomes], k=1)[0]
                    selected_results.append(str(chosen.get("key", "result")))
                    # Les effets sélectionnés repassent dans le même interpréteur : aucune
                    # branche ne dépend du bâtiment ou du métier qui a produit le résultat.
                    effects[0:0] = list(chosen.get("effects", []))
                elif kind == "random_message":
                    choices = effect.get("choices", [])
                    chosen = self.rng.choices(choices, weights=[x.get("weight", 1) for x in choices], k=1)[0]
                    messages.append(str(chosen.get("text", "")))
                    selected_results.append(str(chosen.get("key", "message")))
                elif kind in {"stock_cost", "stock_reward"}:
                    minimum, maximum = self._range(effect.get("amount", 0))
                    amount = self.rng.randint(minimum, maximum) * (1 if kind == "stock_reward" else -1)
                    stock_building = str(effect.get("building", building_key))
                    self._change_stock(db, stock_building, str(effect["item"]), amount, int(effect.get("initial_stock", 0)))
                elif kind == "profession":
                    if effect.get("operation", "experience") == "join":
                        self._join_profession(db, discord_id, str(effect["profession"]), bool(effect.get("exclusive", True)))
                    elif effect.get("operation") == "leave":
                        self._leave_profession(db, discord_id, str(effect["profession"]), bool(effect.get("block_when_pending", True)))
                    else:
                        self._award_experience(
                            db, discord_id, str(effect["profession"]), int(effect.get("experience", 0)),
                            int(effect.get("experience_per_level", 100)),
                        )
                elif kind == "profession_join":
                    self._join_profession(db, discord_id, str(effect["profession"]), True)
                elif kind == "profession_leave":
                    self._leave_profession(db, discord_id, str(effect["profession"]), bool(effect.get("block_when_pending", True)))
                elif kind == "profession_experience":
                    self._award_experience(db, discord_id, str(effect["profession"]), int(effect.get("amount", effect.get("experience", 0))), int(effect.get("experience_per_level", 100)))
                elif kind == "tool_grant":
                    self._grant_tool(db, discord_id, effect)
                elif kind == "tool_modify":
                    self._modify_tool(db, discord_id, effect)
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
                elif kind == "state":
                    self._change_state(db, discord_id, str(effect["key"]), str(effect.get("operation", "set")), effect.get("value"))
                elif kind == "contribution":
                    amount = int(effect.get("amount", 1))
                    resource = str(effect.get("resource", "progress"))
                    db.execute(
                        "INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)",
                        (str(effect["objective"]), discord_id, building_key, resource, amount, json.dumps(effect.get("metadata", {}), ensure_ascii=False), _now()),
                    )
                elif kind == "schedule":
                    scope = self._normalise_activity_scope(str(effect.get("limit_scope", "player_action")))
                    if scope not in {"player", "player_building", "player_action", "category"}:
                        raise ValidationError(f"Portée d'activité inconnue : {scope}.")
                    maximum = max(1, int(effect.get("max_active", 1)))
                    category = str(effect.get("category", ""))
                    clauses, parameters = ["discord_id=?", "status='pending'"], [discord_id]
                    if scope in {"player_building", "player_action"}:
                        clauses.append("building_key=?"); parameters.append(building_key)
                    if scope == "player_action":
                        clauses.append("action_key=?"); parameters.append(effect["action"])
                    elif scope == "category":
                        clauses.append("category=?"); parameters.append(category)
                    count = int(db.execute(f"SELECT COUNT(*) FROM scheduled_actions WHERE {' AND '.join(clauses)}", parameters).fetchone()[0])
                    if count >= maximum:
                        raise ValidationError("La limite d'activites en cours est atteinte.")
                    ready_at = time.time() + int(effect.get("duration_seconds", 0))
                    resolved_effects, scheduled_selected = self._resolve_random_effects(db, discord_id, list(effect.get("effects", [])))
                    selected_results.extend(scheduled_selected)
                    claim_hooks = effect.get("hooks", {}).get("on_claim", [])
                    db.execute(
                        "INSERT INTO scheduled_actions(discord_id,building_key,action_key,category,limit_scope,ready_at,effects_json,status,created_at,result_json,claim_hooks_json) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)",
                        (discord_id, building_key, effect["action"], category, scope, ready_at, json.dumps(resolved_effects, ensure_ascii=False), _now(), json.dumps({"selected_results": scheduled_selected}, ensure_ascii=False), json.dumps(claim_hooks, ensure_ascii=False)),
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
                    selected = json.loads(job["result_json"] or "{}").get("selected_results", [])
                    selected_results.extend(map(str, selected))
                    claim_hooks = json.loads(job["claim_hooks_json"] or "[]")
                    effects[0:0] = [{"type": "emit", "event": hook["event"], "payload": {**hook.get("payload", {}), "selected_results": selected}} for hook in claim_hooks]
                elif kind == "emit": emitted.append(Event(str(effect["event"]), f"building:{building_key}", {"discord_id": discord_id, **effect.get("payload", {})}))
            emitted.extend(self._hook_events(action.get("hooks", {}), "on_success", discord_id, building_key, action_key, {"selected_results": selected_results}))
            snapshot = self.player(discord_id, db)
            result = {
                "ok": True, "messages": messages, "player": snapshot, "action": action_key,
                "duration_seconds": int(action.get("duration_seconds", 0)),
                "selected_results": selected_results,
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
            professions = connection.execute("SELECT profession_key,level,experience FROM player_professions WHERE discord_id=? AND active=1", (discord_id,)).fetchall()
            tools = connection.execute("SELECT tool_key,durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id=?", (discord_id,)).fetchall()
            states = connection.execute("SELECT state_key,value_json FROM player_state WHERE discord_id=?", (discord_id,)).fetchall()
            return {
                "discord_id": discord_id,
                "money": int(row["money"]) if row else 0,
                "energy": int(row["energy"]) if row else 100,
                "inventory": {r[0]: int(r[1]) for r in inventory},
                "professions": {r[0]: {"level": int(r[1]), "experience": int(r[2])} for r in professions},
                "tools": {r[0]: {"durability": int(r[1]), "max_durability": int(r[2]), "level": int(r[3]), "loot_bonus": int(r[4])} for r in tools},
                "state": {r[0]: json.loads(r[1]) for r in states},
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

    def _item_name(self, key: str) -> str:
        try:
            payload = self.store.get("item", key, published=True)["payload"]
            return f"{payload.get('emoji', '📦')} {payload.get('name') or key}"
        except (NotFoundError, KeyError):
            return f"{key.replace('_', ' ').capitalize()} ({key})"

    def _change_resource(self, db, discord_id: str, resource: str, amount: int) -> None:
        if resource in {"money", "energy"}:
            current = int(db.execute(f"SELECT {resource} FROM players WHERE discord_id=?", (discord_id,)).fetchone()[0])
            if current + amount < 0: raise ValidationError(f"Ressource insuffisante : {resource}.")
            db.execute(f"UPDATE players SET {resource}=?,updated_at=? WHERE discord_id=?", (current + amount, _now(), discord_id))
        else:
            current_row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, resource)).fetchone()
            current = int(current_row[0]) if current_row else 0
            if current + amount < 0: raise ValidationError(f"Objet insuffisant : {self._item_name(resource)}.")
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,?) ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=excluded.quantity", (discord_id, resource, current + amount))

    @staticmethod
    def _range(value: Any) -> tuple[int, int]:
        if isinstance(value, list):
            return int(value[0]), int(value[-1])
        if isinstance(value, dict):
            return int(value.get("min", 0)), int(value.get("max", value.get("min", 0)))
        return int(value), int(value)

    def _check_requirements(self, db, discord_id: str, requirements: dict[str, Any]) -> None:
        if requirements.get("no_active_profession"):
            row = db.execute("SELECT profession_key FROM player_professions WHERE discord_id=? AND active=1 LIMIT 1", (discord_id,)).fetchone()
            if row:
                raise ValidationError(f"Vous exercez déjà le métier {row[0]}.")
        profession = str(requirements.get("profession", "")).strip()
        if profession:
            row = db.execute(
                "SELECT level FROM player_professions WHERE discord_id=? AND profession_key=? AND active=1",
                (discord_id, profession),
            ).fetchone()
            if not row or int(row[0]) < int(requirements.get("min_level", 1)):
                raise ValidationError(f"Niveau insuffisant pour le m\u00e9tier {profession}.")
        for item, amount in requirements.get("items", {}).items():
            row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, item)).fetchone()
            if not row or int(row[0]) < int(amount):
                name = self._item_name(str(item))
                quantity = int(amount)
                raise ValidationError(f"Objet requis : {name}" + (f" × {quantity}" if quantity > 1 else "") + ".")
        if requirements.get("tool"):
            row = db.execute("SELECT level FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, requirements["tool"])).fetchone()
            if not row or int(row[0]) != int(requirements.get("tool_level", 1)):
                raise ValidationError(f"Niveau d'outil requis : {requirements.get('tool_level', 1)}.")

    def _check_condition(
        self, db, discord_id: str, building_key: str, action_key: str,
        condition: dict[str, Any] | None, context: dict[str, Any],
    ) -> None:
        if condition and not self._condition_value(db, discord_id, building_key, action_key, condition, context):
            raise ValidationError(str(condition.get("message") or "Les conditions de cette action ne sont pas remplies."))

    def _condition_value(self, db, discord_id: str, building_key: str, action_key: str, condition: dict[str, Any], context: dict[str, Any]) -> bool:
        if "all" in condition:
            return all(self._condition_value(db, discord_id, building_key, action_key, item, context) for item in condition["all"])
        if "any" in condition:
            return any(self._condition_value(db, discord_id, building_key, action_key, item, context) for item in condition["any"])
        if "not" in condition:
            return not self._condition_value(db, discord_id, building_key, action_key, condition["not"], context)
        kind, operator, expected = condition["type"], condition.get("operator", ">="), condition.get("value", 1)
        actual: Any
        if kind == "resource":
            resource = str(condition["resource"])
            if resource in {"money", "energy"}:
                actual = db.execute(f"SELECT {resource} FROM players WHERE discord_id=?", (discord_id,)).fetchone()[0]
            else:
                row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, resource)).fetchone(); actual = int(row[0]) if row else 0
        elif kind in {"item_present", "item_absent"}:
            row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, condition["item"])).fetchone(); actual = int(row[0]) if row else 0
            result = actual >= int(condition.get("value", 1)); return result if kind == "item_present" else not result
        elif kind in {"profession_active", "profession_level"}:
            row = db.execute("SELECT level FROM player_professions WHERE discord_id=? AND profession_key=? AND active=1", (discord_id, condition["profession"])).fetchone()
            if kind == "profession_active": return row is not None
            actual = int(row[0]) if row else 0
        elif kind == "no_active_profession":
            return db.execute("SELECT 1 FROM player_professions WHERE discord_id=? AND active=1", (discord_id,)).fetchone() is None
        elif kind in {"tool_present", "tool_level", "tool_durability"}:
            row = db.execute("SELECT level,durability FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, condition["tool"])).fetchone()
            if kind == "tool_present": return row is not None
            actual = int(row[0 if kind == "tool_level" else 1]) if row else 0
        elif kind == "voice_presence": actual = bool(context.get("voice_channel_id"))
        elif kind == "discord_role": return str(condition["role"]) in set(map(str, context.get("roles", [])))
        elif kind in {"no_pending_activity", "activity_limit_available"}:
            scope = self._normalise_activity_scope(str(condition.get("scope", "player_action")))
            count = self._pending_count(db, discord_id, building_key, str(condition.get("action", action_key)), scope, str(condition.get("category", "")))
            if kind == "no_pending_activity": return count == 0
            return count < int(condition.get("max_active", condition.get("value", 1)))
        elif kind == "cooldown_available":
            scope = "global" if condition.get("scope") == "global" else f"player:{discord_id}"
            row = db.execute("SELECT ready_at FROM action_cooldowns WHERE scope=? AND building_key=? AND action_key=?", (scope, str(condition.get("building", building_key)), str(condition.get("action", action_key)))).fetchone()
            return row is None or float(row[0]) <= time.time()
        elif kind == "building_stock":
            row = db.execute("SELECT quantity FROM building_stock WHERE building_key=? AND item_key=?", (str(condition.get("building", building_key)), condition["item"])).fetchone(); actual = int(row[0]) if row else 0
        elif kind == "state":
            row = db.execute("SELECT value_json FROM player_state WHERE discord_id=? AND state_key=?", (discord_id, condition["key"])).fetchone(); actual = json.loads(row[0]) if row else condition.get("default", 0)
        else:
            raise ValidationError(f"Condition inconnue : {kind}.")
        return self._compare(actual, expected, operator)

    @staticmethod
    def _compare(actual: Any, expected: Any, operator: str) -> bool:
        if operator == "=": return actual == expected
        if operator == "!=": return actual != expected
        if operator == ">": return actual > expected
        if operator == ">=": return actual >= expected
        if operator == "<": return actual < expected
        if operator == "<=": return actual <= expected
        raise ValidationError(f"Opérateur inconnu : {operator}.")

    @staticmethod
    def _normalise_activity_scope(scope: str) -> str:
        return {"building": "player_building", "action": "player_action"}.get(scope, scope)

    @staticmethod
    def _pending_count(db, discord_id: str, building_key: str, action_key: str, scope: str, category: str) -> int:
        clauses, parameters = ["discord_id=?", "status='pending'"], [discord_id]
        if scope in {"player_building", "player_action"}: clauses.append("building_key=?"); parameters.append(building_key)
        if scope == "player_action": clauses.append("action_key=?"); parameters.append(action_key)
        if scope == "category": clauses.append("category=?"); parameters.append(category)
        return int(db.execute(f"SELECT COUNT(*) FROM scheduled_actions WHERE {' AND '.join(clauses)}", parameters).fetchone()[0])

    @staticmethod
    def _hook_events(hooks: dict[str, Any], hook: str, discord_id: str, building_key: str, action_key: str, extra: dict[str, Any] | None = None) -> list[Event]:
        entries = hooks.get(hook, []) if isinstance(hooks, dict) else []
        entries = entries if isinstance(entries, list) else [entries]
        return [Event(str(entry["event"]), f"building:{building_key}", {"discord_id": discord_id, "building": building_key, "action": action_key, **entry.get("payload", {}), **(extra or {})}) for entry in entries]

    def _resolve_random_effects(self, db, discord_id: str, effects: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
        resolved: list[dict[str, Any]] = []
        selected: list[str] = []
        for effect in effects:
            kind = effect.get("type")
            if kind == "random_result":
                outcome = self.rng.choices(effect["outcomes"], weights=[item.get("weight", 1) for item in effect["outcomes"]], k=1)[0]
                selected.append(str(outcome.get("key", "result")))
                nested, nested_selected = self._resolve_random_effects(db, discord_id, list(outcome.get("effects", []))); resolved.extend(nested); selected.extend(nested_selected)
            elif kind == "random_reward":
                choice = self.rng.choices(effect["choices"], weights=[item.get("weight", 1) for item in effect["choices"]], k=1)[0]
                resolved.append({"type": "reward", "resource": choice["item"], "amount": self.rng.randint(int(choice.get("min", 1)), int(choice.get("max", 1)))})
                selected.append(str(choice.get("key", choice["item"])))
            elif kind == "random_bundle":
                outcome = self.rng.choices(effect["outcomes"], weights=[item.get("weight", 1) for item in effect["outcomes"]], k=1)[0]
                bonus = 0
                if effect.get("loot_bonus_tool"):
                    row = db.execute("SELECT loot_bonus FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, effect["loot_bonus_tool"])).fetchone(); bonus = int(row[0]) if row else 0
                for resource, quantity in outcome.get("rewards", {}).items():
                    minimum, maximum = self._range(quantity); resolved.append({"type": "reward", "resource": resource, "amount": self.rng.randint(minimum, maximum) + bonus})
                selected.append(str(outcome.get("key", "bundle")))
            elif kind == "random_message":
                choice = self.rng.choices(effect["choices"], weights=[item.get("weight", 1) for item in effect["choices"]], k=1)[0]
                resolved.append({"type": "message", "text": choice.get("text", "")}); selected.append(str(choice.get("key", "message")))
            else:
                resolved.append(effect)
        return resolved, selected

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
            "SELECT experience FROM player_professions WHERE discord_id=? AND profession_key=? AND active=1",
            (discord_id, profession),
        ).fetchone()
        total = (int(row[0]) if row else 0) + experience
        level = max(1, total // max(1, experience_per_level) + 1)
        db.execute(
            "INSERT INTO player_professions(discord_id,profession_key,level,experience) VALUES(?,?,?,?) "
            "ON CONFLICT(discord_id,profession_key) DO UPDATE SET level=excluded.level,experience=excluded.experience,active=1",
            (discord_id, profession, level, total),
        )

    @staticmethod
    def _join_profession(db, discord_id: str, profession: str, exclusive: bool) -> None:
        existing = db.execute("SELECT profession_key FROM player_professions WHERE discord_id=? AND active=1", (discord_id,)).fetchone()
        if existing and str(existing[0]) != profession and exclusive:
            raise ValidationError(f"Vous exercez déjà le métier {existing[0]}.")
        db.execute(
            "INSERT INTO player_professions(discord_id,profession_key,level,experience,active) VALUES(?,?,1,0,1) "
            "ON CONFLICT(discord_id,profession_key) DO UPDATE SET active=1",
            (discord_id, profession),
        )

    @staticmethod
    def _leave_profession(db, discord_id: str, profession: str, block_when_pending: bool) -> None:
        if block_when_pending and db.execute("SELECT 1 FROM scheduled_actions WHERE discord_id=? AND status='pending'", (discord_id,)).fetchone():
            raise ValidationError("Terminez votre activité avant de quitter ce métier.")
        changed = db.execute("UPDATE player_professions SET active=0 WHERE discord_id=? AND profession_key=? AND active=1", (discord_id, profession)).rowcount
        if not changed:
            raise ValidationError(f"Vous n'exercez pas le métier {profession}.")

    @staticmethod
    def _change_state(db, discord_id: str, key: str, operation: str, value: Any) -> None:
        row = db.execute("SELECT value_json FROM player_state WHERE discord_id=? AND state_key=?", (discord_id, key)).fetchone()
        current = json.loads(row[0]) if row else 0
        if operation == "increment":
            value = float(current) + float(value or 0)
            if value.is_integer(): value = int(value)
        elif operation != "set":
            raise ValidationError(f"Opération d'état inconnue : {operation}.")
        db.execute(
            "INSERT INTO player_state(discord_id,state_key,value_json) VALUES(?,?,?) "
            "ON CONFLICT(discord_id,state_key) DO UPDATE SET value_json=excluded.value_json",
            (discord_id, key, json.dumps(value, ensure_ascii=False)),
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

    @staticmethod
    def _grant_tool(db, discord_id: str, effect: dict[str, Any]) -> None:
        maximum = max(1, int(effect.get("max_durability", 1)))
        durability = min(maximum, max(0, int(effect.get("durability", maximum))))
        db.execute(
            "INSERT INTO player_tools(discord_id,tool_key,durability,max_durability,level,loot_bonus) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(discord_id,tool_key) DO NOTHING",
            (discord_id, str(effect["tool"]), durability, maximum, max(1, int(effect.get("level", 1))), int(effect.get("loot_bonus", 0))),
        )

    @staticmethod
    def _modify_tool(db, discord_id: str, effect: dict[str, Any]) -> None:
        row = db.execute("SELECT durability,max_durability,level,loot_bonus FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, effect["tool"])).fetchone()
        if not row:
            raise ValidationError(f"Outil requis : {effect['tool']}.")
        durability, maximum, level, bonus = map(int, row)
        operation = str(effect.get("operation", "consume_durability"))
        amount = int(effect.get("amount", 0))
        if operation == "consume_durability": durability -= amount
        elif operation == "restore_durability": durability = min(maximum, durability + amount)
        elif operation == "set_level": level = max(1, amount)
        elif operation == "increment_level": level = max(1, level + amount)
        elif operation == "set_max_durability": maximum = max(1, amount); durability = min(durability, maximum)
        elif operation == "set_bonus": bonus = amount
        else: raise ValidationError(f"Modification d'outil inconnue : {operation}.")
        if durability < 0: raise ValidationError(f"L'outil {effect['tool']} doit être réparé.")
        db.execute("UPDATE player_tools SET durability=?,max_durability=?,level=?,loot_bonus=? WHERE discord_id=? AND tool_key=?", (durability, maximum, level, bonus, discord_id, effect["tool"]))

    def _repair_tool(self, db, discord_id: str, tool: str, configured_maximum: int, price_per_point: int) -> None:
        row = db.execute("SELECT durability,max_durability FROM player_tools WHERE discord_id=? AND tool_key=?", (discord_id, tool)).fetchone()
        if not row:
            raise ValidationError(f"Aucun outil a reparer : {tool}.")
        current, maximum = int(row[0]), int(row[1])
        missing = maximum - current
        if missing <= 0:
            raise ValidationError(f"L'outil {tool} est deja en parfait etat.")
        self._change_resource(db, discord_id, "money", -(missing * price_per_point))
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

