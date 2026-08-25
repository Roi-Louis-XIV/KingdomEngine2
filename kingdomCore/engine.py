"""Interprète les actions no-code de façon atomique et idempotente."""

from __future__ import annotations

import json
import random
import time
from uuid import uuid4
from datetime import datetime, timezone
from typing import Any

from KingdomData import ContentStore, NotFoundError, ValidationError
from import_v1 import actions_from_modules
from kingdomEvent import Event, EventBus
from kingdomEvent.modifiers import ModifierEngine
from kingdomEvent.runtime import WorldClock, event_is_active
from kingdomCore.world import WorldEngine, WorldError


class GameEngine:
    def __init__(self, store: ContentStore, bus: EventBus | None = None, rng: random.Random | None = None) -> None:
        self.store, self.bus, self.rng = store, bus or EventBus(), rng or random.Random()
        self.world_clock = WorldClock(store)
        self._world_snapshot: dict[str, Any] | None = None

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
            # Toute écriture de l'horloge/météo est effectuée avant la
            # transaction gameplay afin d'éviter deux écrivains SQLite.
            self._world_snapshot = self.world_clock.state()
            return await self._execute(discord_id, building_key, action_key, interaction_id, context or {})
        except Exception as exc:
            try:
                action = next(item for item in self.building(building_key)["payload"].get("actions", []) if item.get("key") == action_key)
                for event in self._hook_events(action.get("hooks", {}), "on_failure", discord_id, building_key, action_key, {"error": str(exc)}):
                    await self.bus.publish(event)
            except Exception:
                pass
            raise

    async def execute_local_activity(self, discord_id: str, building_key: str, action_key: str,
                                     interaction_id: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Exécute une activité uniquement si le lieu courant la référence."""
        world = WorldEngine(self.store)
        travel = world.get_travel_state(discord_id)
        if travel:
            raise ValidationError(f"Vous êtes en voyage. Arrivée dans {travel['remaining_seconds']} seconde(s).")
        allowed = {(item["building_key"], item["key"]) for item in world.local_activities(discord_id)}
        if (building_key, action_key) not in allowed:
            raise ValidationError("Cette activité n’est pas disponible à votre position actuelle.")
        return await self.execute(discord_id, building_key, action_key, interaction_id, {**(context or {}), "world_local_activity": True})

    def delivery_options(self, discord_id: str, building_key: str) -> list[dict[str, Any]]:
        building = self.building(building_key)["payload"]
        rules = building.get("modules", {}).get("deliveries", [])
        with self.store.connection() as db:
            inventory = {str(row[0]): int(row[1]) for row in db.execute("SELECT item_key,quantity FROM inventory WHERE discord_id=? AND quantity>0", (discord_id,))}
        return [{**rule, "resource": str(rule.get("item_key", rule.get("resource"))), "quantity": inventory[str(rule.get("item_key", rule.get("resource")))], "name": self._item_name(str(rule.get("item_key", rule.get("resource")))), "destination_name": self._building_name(str(rule.get("target_building_key", rule.get("building", building_key))))} for rule in rules if inventory.get(str(rule.get("item_key", rule.get("resource"))), 0) >= int(rule.get("minimum_quantity", 1))]

    def commerce_options(self, building_key: str) -> list[dict[str, Any]]:
        """Catalogue générique enrichi du stock courant, sans règle liée au lieu."""
        products = self.building(building_key)["payload"].get("modules", {}).get("products", [])
        with self.store.connection() as db:
            stock = {str(row[0]): int(row[1]) for row in db.execute(
                "SELECT item_key,quantity FROM building_stock WHERE building_key=?", (building_key,)
            )}
        return [{**product, "item_key": str(product["item_key"]),
                 "name": product.get("name") or self._item_name(str(product["item_key"])),
                 "quantity": stock.get(str(product["item_key"]), int(product.get("initial_stock", 0)))}
                for product in products if product.get("active", True)]

    async def execute_purchase(self, discord_id: str, building_key: str, interaction_id: str,
                               item_key: str, quantity: int) -> dict[str, Any]:
        """Transfert commercial quantifié, atomique et idempotent."""
        self._world_snapshot = self.world_clock.state()
        quantity = int(quantity)
        if quantity < 1: raise ValidationError("La quantité doit être supérieure à zéro.")
        product = next((item for item in self.commerce_options(building_key) if item["item_key"] == item_key), None)
        if not product: raise ValidationError("Ce produit n'est pas disponible.")
        maximum = int(product.get("maximum_per_purchase", quantity))
        if quantity > maximum: raise ValidationError(f"Maximum par commande : {maximum}.")
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            self._ensure_player(db, discord_id)
            self._change_stock(db, building_key, item_key, -quantity, int(product.get("initial_stock", 0)))
            unit_price = self._effective_number(product.get("price", 0), "economy.price", {"building_key": building_key, "item_key": item_key})
            total = quantity * unit_price
            self._change_resource(db, discord_id, str(product.get("currency", "money")), -total)
            self._change_resource(db, discord_id, item_key, quantity)
            result = {"purchase": {"item": item_key, "name": product["name"], "quantity": quantity,
                                    "total": total}, "player": self.player(discord_id, db)}
            db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES(?,?,?,?,?,?)",
                       (interaction_id, discord_id, building_key, "commerce", json.dumps(result, ensure_ascii=False), _now()))
        await self._publish_configured_events(product.get("events", {}), "on_success", discord_id, building_key, "commerce", result)
        await self.bus.publish(Event("building.commerce.purchased", f"building:{building_key}", {"discord_id": discord_id, "building": building_key, **result["purchase"]}))
        return result

    async def execute_consumption(self, discord_id: str, building_key: str, interaction_id: str,
                                  item_key: str, quantity: int = 1) -> dict[str, Any]:
        """Consomme un objet et interprète ses effets déclaratifs."""
        item = self.store.get("item", item_key, published=True)["payload"]
        if not item.get("consumable"): raise ValidationError("Cet objet n'est pas consommable.")
        effects = list(item.get("consumption", {}).get("effects", item.get("effects", [])))
        if not effects: raise ValidationError("Aucun effet de consommation n'est configuré.")
        quantity = int(quantity)
        if quantity < 1: raise ValidationError("La quantité doit être supérieure à zéro.")
        messages, emitted = [], []
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            self._ensure_player(db, discord_id)
            self._change_resource(db, discord_id, item_key, -quantity)
            for effect in effects:
                kind = str(effect.get("type"))
                amount = float(effect.get("amount", 0)) * quantity
                if kind in {"reward", "cost"}:
                    self._change_resource(db, discord_id, str(effect.get("resource", "money")), int(amount) * (1 if kind == "reward" else -1))
                elif kind == "player_stat":
                    self._change_player_stat(db, discord_id, str(effect["stat"]), amount, effect)
                elif kind == "message": messages.append(str(effect.get("text", "")).format(item=item.get("name", item_key), quantity=quantity))
                elif kind == "emit": emitted.append(Event(str(effect["event"]), f"building:{building_key}", {"discord_id": discord_id, "building": building_key, "item": item_key, **effect.get("payload", {})}))
                elif kind == "state": self._change_state(db, discord_id, str(effect["key"]), str(effect.get("operation", "set")), effect.get("value"))
                else: raise ValidationError(f"Effet de consommation inconnu : {kind}.")
            result = {"consumption": {"item": item_key, "name": item.get("name", item_key), "quantity": quantity},
                      "messages": messages, "stats": self.player_stats(discord_id, db), "player": self.player(discord_id, db)}
            db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES(?,?,?,?,?,?)",
                       (interaction_id, discord_id, building_key, f"consume:{item_key}", json.dumps(result, ensure_ascii=False), _now()))
        for event in emitted: await self.bus.publish(event)
        await self._publish_configured_events(item.get("consumption", {}).get("events", {}), "on_success", discord_id, building_key, f"consume:{item_key}", result)
        await self.bus.publish(Event("building.item.consumed", f"building:{building_key}", {"discord_id": discord_id, "building": building_key, "item": item_key, "quantity": quantity}))
        return result

    def player_stats(self, discord_id: str, db=None) -> dict[str, float]:
        if db is None:
            with self.store.connection() as connection: return self.player_stats(discord_id, connection)
        rows = db.execute("SELECT stat_key,value,updated_at,metadata_json FROM player_stats WHERE discord_id=?", (discord_id,)).fetchall()
        now, result = time.time(), {}
        for row in rows:
            metadata = json.loads(row[3] or "{}")
            value = float(row[1]) + ((now - float(row[2])) / 3600.0) * float(metadata.get("change_per_hour", 0))
            value = min(float(metadata.get("maximum", value)), max(float(metadata.get("minimum", value)), value))
            result[str(row[0])] = round(value, 3)
        return result

    def prepare_game(self, discord_id: str, building_key: str, game_key: str, choice_key: str) -> dict[str, Any]:
        game = self._game_definition(building_key, game_key)
        choice = next((item for item in game.get("choices", game.get("bets", [])) if item.get("key") == choice_key), None)
        if not choice: raise ValidationError("Choix de jeu invalide.")
        session_key = str(uuid4()); stake = int(choice.get("stake", game.get("stake", 0)))
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE"); self._ensure_player(db, discord_id)
            db.execute("UPDATE game_sessions SET status='cancelled' WHERE discord_id=? AND status='pending'", (discord_id,))
            db.execute("INSERT INTO game_sessions(session_key,discord_id,building_key,game_key,choice_key,stake_resource,stake,multiplier,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'pending',?)",
                       (session_key, discord_id, building_key, game_key, choice_key, str(game.get("stake_resource", "money")), stake, float(choice.get("multiplier", 1)), _now()))
        return {"session_key": session_key, "choice": choice, "stake": stake, "stake_resource": game.get("stake_resource", "money")}

    def cancel_game(self, discord_id: str, session_key: str) -> bool:
        with self.store.connection() as db:
            return db.execute("UPDATE game_sessions SET status='cancelled' WHERE session_key=? AND discord_id=? AND status='pending'", (session_key, discord_id)).rowcount == 1

    async def confirm_game(self, discord_id: str, session_key: str, interaction_id: str) -> dict[str, Any]:
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            duplicate = db.execute("SELECT result_json FROM game_sessions WHERE confirmation_interaction_id=?", (interaction_id,)).fetchone()
            if duplicate: return json.loads(duplicate[0])
            row = db.execute("SELECT * FROM game_sessions WHERE session_key=? AND discord_id=?", (session_key, discord_id)).fetchone()
            if not row: raise ValidationError("Cette partie ne t'appartient pas.")
            if row[8] != "pending": raise ValidationError("Cette partie est déjà terminée.")
            game = self._game_definition(str(row[2]), str(row[3])); choice = next(item for item in game.get("choices", game.get("bets", [])) if item["key"] == row[4])
            self._change_resource(db, discord_id, str(row[5]), -int(row[6]))
            faces = list(game.get("outcomes", range(1, int(game.get("sides", 6)) + 1)))
            rolled = self.rng.choice(faces); won = rolled in choice.get("winning_outcomes", choice.get("winning_faces", []))
            payout = int(int(row[6]) * float(row[7])) if won else 0
            if payout: self._change_resource(db, discord_id, str(row[5]), payout)
            result = {"game": str(row[3]), "choice": str(row[4]), "outcome": rolled, "won": won,
                      "stake": int(row[6]), "payout": payout, "player": self.player(discord_id, db)}
            db.execute("UPDATE game_sessions SET status='resolved',confirmation_interaction_id=?,result_json=?,resolved_at=? WHERE session_key=?",
                       (interaction_id, json.dumps(result, ensure_ascii=False), _now(), session_key))
        await self.bus.publish(Event("building.game.resolved", f"building:{row[2]}", {"discord_id": discord_id, "building": str(row[2]), **result}))
        return result

    async def execute_delivery(self, discord_id: str, building_key: str, interaction_id: str, quantities: dict[str, int]) -> dict[str, Any]:
        rules = self.building(building_key)["payload"].get("modules", {}).get("deliveries", [])
        hooks = {name: [entry for rule in rules for entry in ([rule.get("events", {}).get(name)] if rule.get("events", {}).get(name) else [])] for name in ("on_start", "on_success", "on_failure")}
        for event in self._hook_events(hooks, "on_start", discord_id, building_key, "delivery", {"quantities": quantities}): await self.bus.publish(event)
        try:
            result = await self._execute_delivery(discord_id, building_key, interaction_id, quantities)
            for event in self._hook_events(hooks, "on_success", discord_id, building_key, "delivery", result): await self.bus.publish(event)
            return result
        except Exception as exc:
            for event in self._hook_events(hooks, "on_failure", discord_id, building_key, "delivery", {"error": str(exc), "quantities": quantities}): await self.bus.publish(event)
            raise

    async def _execute_delivery(self, discord_id: str, building_key: str, interaction_id: str, quantities: dict[str, int]) -> dict[str, Any]:
        building = self.building(building_key)["payload"]
        rules = {str(rule.get("item_key", rule.get("resource"))): rule for rule in building.get("modules", {}).get("deliveries", [])}
        if not quantities: raise ValidationError("Aucune ressource à livrer.")
        unknown = set(quantities) - set(rules)
        if unknown: raise ValidationError(f"Ressource non acceptée : {next(iter(unknown))}.")
        for resource, quantity in quantities.items():
            rule = rules[resource]; quantity = int(quantity)
            if quantity < int(rule.get("minimum_quantity", 1)): raise ValidationError("La quantité doit être supérieure à zéro et respecter le minimum configuré.")
            maximum = rule.get("maximum_quantity")
            if maximum is not None and quantity > int(maximum): raise ValidationError(f"La quantité maximale acceptée est {maximum}.")
            destination = str(rule.get("target_building_key", rule.get("building", "")))
            if rule.get("destination", "building_stock") == "building_stock": self.store.get("building", destination, published=True)
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            for resource, quantity in quantities.items():
                row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, resource)).fetchone()
                if not row or int(row[0]) < int(quantity): raise ValidationError(f"Quantité insuffisante : {self._item_name(resource)}.")
                rule = rules[resource]
                if rule.get("conditions") and not self._condition_value(db, discord_id, building_key, "delivery", rule["conditions"], {}):
                    raise ValidationError(str(rule.get("condition_message") or "Les conditions de cette livraison ne sont pas remplies."))
                capacity = rule.get("destination_max_stock")
                if capacity is not None and rule.get("destination", "building_stock") == "building_stock":
                    destination = str(rule.get("target_building_key", rule.get("building", building_key)))
                    current = db.execute("SELECT quantity FROM building_stock WHERE building_key=? AND item_key=?", (destination, resource)).fetchone()
                    if (int(current[0]) if current else 0) + int(quantity) > int(capacity): raise ValidationError("Le stock destinataire ne peut pas accepter cette quantité.")
            total_by_currency: dict[str, int] = {}; lines = []
            for resource, quantity_value in quantities.items():
                quantity, rule = int(quantity_value), rules[resource]
                destination = str(rule.get("target_building_key", rule.get("building", building_key)))
                currency, unit_price = str(rule.get("payment_resource", rule.get("currency", "money"))), int(rule.get("unit_price", 0))
                db.execute("UPDATE inventory SET quantity=quantity-? WHERE discord_id=? AND item_key=?", (quantity, discord_id, resource)); db.execute("DELETE FROM inventory WHERE discord_id=? AND item_key=? AND quantity<=0", (discord_id, resource))
                if rule.get("destination", "building_stock") == "building_stock": self._change_stock(db, destination, resource, quantity)
                else: self._change_resource(db, discord_id, resource, quantity)
                payment = quantity * unit_price; total_by_currency[currency] = total_by_currency.get(currency, 0) + payment
                db.execute("INSERT INTO delivery_log VALUES(NULL,?,?,?,?,?,?,?,?,?,?)", (interaction_id, discord_id, building_key, destination, resource, quantity, unit_price, payment, currency, _now()))
                lines.append({"resource": resource, "resource_name": self._item_name(resource), "quantity": quantity, "destination": destination, "destination_name": self._building_name(destination), "unit_price": unit_price, "payment": payment})
            for currency, payment in total_by_currency.items():
                if payment: self._change_resource(db, discord_id, currency, payment)
            result = {"delivery": lines, "payments": total_by_currency, "player": self.player(discord_id, db)}
            db.execute("INSERT INTO action_log(interaction_id,discord_id,building_key,action_key,result_json,created_at) VALUES(?,?,?,?,?,?)", (interaction_id, discord_id, building_key, "delivery", json.dumps(result, ensure_ascii=False), _now()))
        return result

    async def _execute(
        self, discord_id: str, building_key: str, action_key: str, interaction_id: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        building = self.building(building_key)["payload"]
        actions = actions_from_modules(building_key, building.get("modules", {})) if building.get("action_mode") == "generated" else building.get("actions", [])
        action = next((a for a in actions if a.get("key") == action_key), None)
        if not action or not action.get("enabled", True):
            raise NotFoundError("Cette action n’est pas disponible.")
        action = {**action}
        modifier_context = {"building_key": building_key, "action_key": action_key, **action.get("modifier_context", {})}
        if self._effective_number(1, "availability", modifier_context) <= 0:
            raise ValidationError("Cette activité est temporairement indisponible.")
        action["cooldown_seconds"] = self._effective_number(action.get("cooldown_seconds", 0), "cooldown.duration", {**modifier_context, "cooldown_scope": "player"})
        action["global_cooldown_seconds"] = self._effective_number(action.get("global_cooldown_seconds", 0), "cooldown.duration", {**modifier_context, "cooldown_scope": "global"})
        timing = context.get("interface_timing", {})
        if isinstance(timing, dict):
            for field in ("cooldown_seconds", "global_cooldown_seconds"):
                if field in timing:
                    action[field] = min(86400, max(0, int(timing[field])))
        emitted: list[Event] = []
        messages: list[str] = []
        selected_results: list[str] = []
        with self.store.connection() as db:
            previous = db.execute("SELECT result_json FROM action_log WHERE interaction_id=?", (interaction_id,)).fetchone()
            if previous: return json.loads(previous[0])
            now = _now()
            db.execute(
                "INSERT OR IGNORE INTO players(discord_id,updated_at,created_at) VALUES(?,?,?)",
                (discord_id, now, now),
            )
            # Les métadonnées Discord alimentent la supervision sans devenir
            # une dépendance du moteur : un autre client peut les omettre.
            if context.get("display_name") or context.get("avatar_url"):
                db.execute(
                    "UPDATE players SET display_name=?,avatar_url=?,updated_at=? WHERE discord_id=?",
                    (str(context.get("display_name", "")), str(context.get("avatar_url", "")), now, discord_id),
                )
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
                    property_name = str(effect.get("modifier_property") or ("energy.cost" if kind == "cost" and effect.get("resource") == "energy" else "production.quantity"))
                    effect_context = {**modifier_context, **effect.get("_modifier_context", {}), "item_key": effect.get("resource"), "ingredient_key": effect.get("ingredient_key"), "recipe_key": effect.get("recipe_key", effect.get("_modifier_context", {}).get("recipe_key", modifier_context.get("recipe_key")))}
                    minimum, maximum = self._effective_range(effect.get("amount", 0), property_name, effect_context)
                    amount = self.rng.randint(minimum, maximum) * (1 if kind == "reward" else -1)
                    self._change_resource(db, discord_id, effect.get("resource", "money"), amount)
                elif kind == "production":
                    minimum, maximum = self._effective_range(effect.get("amount", 0), "production.quantity", {"building_key": building_key, "action_key": action_key, "item_key": effect.get("resource", effect.get("item"))})
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
                    pool_key = str(effect.get("memory_key", f"{building_key}:{action_key}"))
                    scope = "global" if effect.get("memory_scope") == "global" else f"player:{discord_id}"
                    available = choices
                    if effect.get("avoid_previous") and len(choices) > 1:
                        previous = db.execute("SELECT result_key FROM random_result_memory WHERE scope=? AND pool_key=?", (scope, pool_key)).fetchone()
                        available = [item for item in choices if not previous or str(item.get("key")) != str(previous[0])] or choices
                    chosen = self.rng.choices(available, weights=[x.get("weight", 1) for x in available], k=1)[0]
                    messages.append(str(chosen.get("text", "")))
                    selected_results.append(str(chosen.get("key", "message")))
                    db.execute("INSERT INTO random_result_memory(scope,pool_key,result_key,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,pool_key) DO UPDATE SET result_key=excluded.result_key,updated_at=excluded.updated_at", (scope, pool_key, selected_results[-1], time.time()))
                    if chosen.get("event"):
                        emitted.append(Event(str(chosen["event"]), f"building:{building_key}", {"discord_id": discord_id, "building": building_key, "action": action_key, **chosen.get("payload", {})}))
                elif kind in {"stock_cost", "stock_reward"}:
                    if effect.get("modifier_property"):
                        minimum, maximum = self._effective_range(effect.get("amount", 0), str(effect["modifier_property"]), {**modifier_context, "item_key": effect.get("item"), "ingredient_key": effect.get("ingredient_key"), "recipe_key": effect.get("recipe_key", modifier_context.get("recipe_key"))})
                    else:
                        minimum, maximum = self._range(effect.get("amount", 0))
                    amount = self.rng.randint(minimum, maximum) * (1 if kind == "stock_reward" else -1)
                    stock_building = str(effect.get("building", building_key))
                    self._change_stock(db, stock_building, str(effect["item"]), amount, int(effect.get("initial_stock", 0)))
                elif kind == "deliver_inventory":
                    delivered, total = [], 0
                    for entry in effect.get("items", []):
                        item = str(entry["item"])
                        row = db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, item)).fetchone()
                        quantity = int(row[0]) if row else 0
                        if quantity <= 0: continue
                        db.execute("DELETE FROM inventory WHERE discord_id=? AND item_key=?", (discord_id, item))
                        self._change_stock(db, str(entry.get("building", effect.get("building", building_key))), item, quantity)
                        total += quantity * int(entry.get("unit_price", 0)); delivered.append(f"{quantity} × {self._item_name(item)}")
                    if not delivered: raise ValidationError(str(effect.get("empty_message") or "Tu ne possèdes aucune ressource acceptée à livrer."))
                    self._change_resource(db, discord_id, "money", total)
                    messages.append(str(effect.get("message") or "Livraison effectuée : {items}. Récompense : **{total} écus**.").format(items=" · ".join(delivered), total=total))
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
                elif kind == "player_stat":
                    self._change_player_stat(db, discord_id, str(effect["stat"]), float(effect.get("amount", 0)), effect)
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
                    duration = self._effective_number(effect.get("duration_seconds", 0), "activity.duration", {"building_key": building_key, "action_key": str(effect.get("action", action_key)), "activity_key": str(effect.get("action", action_key))})
                    ready_at = time.time() + duration
                    resolved_effects, scheduled_selected = self._resolve_random_effects(db, discord_id, list(effect.get("effects", [])))
                    selected_results.extend(scheduled_selected)
                    claim_hooks = effect.get("hooks", {}).get("on_claim", [])
                    db.execute(
                        "INSERT INTO scheduled_actions(discord_id,building_key,action_key,category,limit_scope,ready_at,effects_json,status,created_at,result_json,claim_hooks_json) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)",
                        (discord_id, building_key, effect["action"], category, scope, ready_at, json.dumps(resolved_effects, ensure_ascii=False), _now(), json.dumps({"selected_results": scheduled_selected, "modifier_context": modifier_context}, ensure_ascii=False), json.dumps(claim_hooks, ensure_ascii=False)),
                    )
                    messages.append(f"Activite lancee. Recuperation disponible dans {duration} seconde(s).")
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
                    scheduled_result = json.loads(job["result_json"] or "{}")
                    scheduled_context = scheduled_result.get("modifier_context", {})
                    effects[0:0] = [{**resolved, "_modifier_context": scheduled_context} for resolved in json.loads(job["effects_json"])]
                    selected = scheduled_result.get("selected_results", [])
                    selected_results.extend(map(str, selected))
                    claim_hooks = json.loads(job["claim_hooks_json"] or "[]")
                    effects[0:0] = [{"type": "emit", "event": hook["event"], "payload": {**hook.get("payload", {}), "selected_results": selected}} for hook in claim_hooks]
                elif kind == "emit": emitted.append(Event(str(effect["event"]), f"building:{building_key}", {"discord_id": discord_id, **effect.get("payload", {})}))
                elif kind == "play_audio":
                    self.store.queue_audio(db, "play", building_key, audio_key=str(effect["audio_key"]), bot_key=str(effect.get("bot_key", "")), context={"discord_id": discord_id, "action": action_key})
                elif kind == "set_audio_group":
                    self.store.queue_audio(db, "set_group", building_key, group_key=str(effect["group_key"]), bot_key=str(effect.get("bot_key", "")), context={"discord_id": discord_id, "action": action_key})
            emitted.extend(self._hook_events(action.get("hooks", {}), "on_success", discord_id, building_key, action_key, {"selected_results": selected_results}))
            sound_module = building.get("modules", {}).get("audio", {})
            for event in emitted:
                for route in sound_module.get("event_routes", []):
                    if route.get("event") == event.type and route.get("group_key"):
                        self.store.queue_audio(db, "set_group", building_key, group_key=str(route["group_key"]), context={"discord_id": discord_id, "action": action_key, "event": event.type})
                for audio_entity in self.store.list("audio", published=True):
                    audio_payload = audio_entity["payload"]
                    if event.type in audio_payload.get("triggers", []):
                        self.store.queue_audio(db, "play", building_key, audio_key=audio_entity["entity_key"], bot_key=str(audio_payload.get("speaker_bot_key", "")), context={"discord_id": discord_id, "action": action_key, "event": event.type})
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

    def action_available(self, building_key: str, action_key: str) -> bool:
        building = self.building(building_key)["payload"]
        actions = actions_from_modules(building_key, building.get("modules", {})) if building.get("action_mode") == "generated" else building.get("actions", [])
        action = next((item for item in actions if item.get("key") == action_key and item.get("enabled", True)), None)
        if not action: return False
        context = {"building_key": building_key, "action_key": action_key, **action.get("modifier_context", {})}
        self._world_snapshot = self.world_clock.state()
        return self._effective_number(1, "availability", context) > 0

    def cooldown_remaining(self, discord_id: str, building_key: str, action_key: str) -> int:
        with self.store.connection() as db:
            rows = db.execute(
                "SELECT ready_at FROM action_cooldowns WHERE building_key=? AND action_key=? AND scope IN (?, 'global')",
                (building_key, action_key, f"player:{discord_id}"),
            ).fetchall()
        return max([0, *[int(float(row[0]) - time.time()) + 1 for row in rows]])

    def _item_name(self, key: str) -> str:
        try:
            payload = self.store.get("item", key, published=True)["payload"]
            return f"{payload.get('emoji', '📦')} {payload.get('name') or key}"
        except (NotFoundError, KeyError):
            return f"{key.replace('_', ' ').capitalize()} ({key})"

    def _building_name(self, key: str) -> str:
        try:
            payload = self.store.get("building", key, published=True)["payload"]
            return f"{payload.get('emoji', '🏰')} {payload.get('name') or key}"
        except (NotFoundError, KeyError):
            return key.replace("_", " ").capitalize()

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

    def _effective_range(self, value: Any, property_name: str, context: dict[str, Any]) -> tuple[int, int]:
        minimum, maximum = self._range(value)
        events = [{"key": row["entity_key"], **row["payload"], "active": event_is_active(row["payload"])} for row in self.store.list("event", published=True)]
        weather = (self._world_snapshot or self.world_clock.state())["weather"]
        environment = [{"key": f"weather_{weather.get('key', 'current')}", "modifiers": weather.get("modifiers", [])}]
        resolver = ModifierEngine()
        effective_minimum, _ = resolver.effective(minimum, property_name, context, environment, events)
        effective_maximum, _ = resolver.effective(maximum, property_name, context, environment, events)
        return max(0, round(effective_minimum)), max(0, round(effective_maximum))

    def _effective_number(self, value: Any, property_name: str, context: dict[str, Any]) -> int:
        return self._effective_range(value, property_name, context)[0]

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
        elif kind == "player_stat": actual = self.player_stats(discord_id, db).get(str(condition["stat"]), float(condition.get("default", 0)))
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
    def _ensure_player(db, discord_id: str) -> None:
        now = _now()
        db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at,created_at) VALUES(?,?,?)", (discord_id, now, now))

    @staticmethod
    def _change_player_stat(db, discord_id: str, key: str, amount: float, definition: dict[str, Any]) -> None:
        row = db.execute("SELECT value,updated_at,metadata_json FROM player_stats WHERE discord_id=? AND stat_key=?", (discord_id, key)).fetchone()
        metadata = {field: definition[field] for field in ("minimum", "maximum", "change_per_hour") if field in definition}
        now = time.time()
        if row:
            previous_metadata = json.loads(row[2] or "{}"); previous_metadata.update(metadata); metadata = previous_metadata
            current = float(row[0]) + ((now - float(row[1])) / 3600.0) * float(metadata.get("change_per_hour", 0))
        else:
            core = db.execute(f"SELECT {key} FROM players WHERE discord_id=?", (discord_id,)).fetchone() if key in {"energy", "money"} else None
            current = float(core[0]) if core else float(definition.get("default", 0))
        value = current + amount if definition.get("operation", "increment") == "increment" else amount
        value = min(float(metadata.get("maximum", value)), max(float(metadata.get("minimum", value)), value))
        db.execute("INSERT INTO player_stats(discord_id,stat_key,value,updated_at,metadata_json) VALUES(?,?,?,?,?) ON CONFLICT(discord_id,stat_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json",
                   (discord_id, key, value, now, json.dumps(metadata, ensure_ascii=False)))
        if key in {"energy", "money"}:
            db.execute(f"UPDATE players SET {key}=?,updated_at=? WHERE discord_id=?", (int(value), _now(), discord_id))

    def _game_definition(self, building_key: str, game_key: str) -> dict[str, Any]:
        games = self.building(building_key)["payload"].get("modules", {}).get("games", {})
        candidates = games.values() if isinstance(games, dict) else games
        game = next((item for item in candidates if str(item.get("key", game_key)) == game_key), None)
        if not game: raise ValidationError("Jeu introuvable.")
        return game

    async def _publish_configured_events(self, hooks: dict[str, Any], hook: str, discord_id: str,
                                         building_key: str, action_key: str, extra: dict[str, Any]) -> None:
        for event in self._hook_events(hooks, hook, discord_id, building_key, action_key, extra):
            await self.bus.publish(event)

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
        db.execute(
            "INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,1) "
            "ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=MAX(quantity,1)",
            (discord_id, str(effect["tool"])),
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

