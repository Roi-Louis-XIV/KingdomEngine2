"""Projections du World Creator au-dessus des contenus versionnés existants."""

from __future__ import annotations

from typing import Any

from kingdomEvent.modifiers import ModifierEngine, explain
from kingdomEvent.runtime import WorldClock, event_is_active
from kingdomCore.world import WorldEngine


class WorldCreatorService:
    def __init__(self, store): self.store = store

    def professions(self) -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        for building in self.store.list("building"):
            payload, building_key = building["payload"], building["entity_key"]
            modules = payload.get("modules", {})
            for profession in modules.get("professions", []):
                key = profession["key"]; row = rows.setdefault(key, {**profession, "key": key, "buildings": [], "activities": [], "produced_items": []})
                row["buildings"].append({"key": building_key, "name": payload.get("name", building_key), "primary": payload.get("relations", {}).get("primary_profession_key") == key})
            for activity in modules.get("activities", []):
                row = rows.get(activity.get("profession"))
                if not row: continue
                row["activities"].append({"key": activity["key"], "name": activity.get("name", activity["key"]), "building_key": building_key})
                for outcome in activity.get("outcomes", []):
                    for effect in outcome.get("effects", []):
                        if effect.get("type") in {"reward", "stock_reward"}:
                            item = effect.get("resource") or effect.get("item")
                            if item and item not in row["produced_items"]: row["produced_items"].append(item)
        for standalone in self.store.list("profession"):
            rows.setdefault(standalone["entity_key"], {**standalone["payload"], "key": standalone["entity_key"], "buildings": [], "activities": [], "produced_items": []})
        return sorted(rows.values(), key=lambda row: row.get("name", row["key"]))

    def item_usage(self, item_key: str) -> dict[str, Any]:
        result = {"item_key": item_key, "tools": [], "produced": [], "consumed": [], "deliveries": []}
        for building in self.store.list("building"):
            p, bkey = building["payload"], building["entity_key"]; modules = p.get("modules", {})
            for profession in modules.get("professions", []):
                if profession.get("required_item") == item_key: result["tools"].append({"profession": profession["key"], "building": bkey})
            for activity in modules.get("activities", []):
                if activity.get("tool") == item_key: result["tools"].append({"activity": activity["key"], "building": bkey})
                for outcome in activity.get("outcomes", []):
                    if any((e.get("resource") or e.get("item")) == item_key and e.get("type") in {"reward", "stock_reward"} for e in outcome.get("effects", [])): result["produced"].append({"activity": activity["key"], "building": bkey})
            for recipe in modules.get("recipes", []):
                if recipe.get("output_item_key") == item_key: result["produced"].append({"recipe": recipe["key"], "building": bkey})
                if item_key in recipe.get("ingredients", {}): result["consumed"].append({"recipe": recipe["key"], "building": bkey, "amount": recipe["ingredients"][item_key]})
            for delivery in modules.get("deliveries", []):
                if (delivery.get("item_key") or delivery.get("resource")) == item_key: result["deliveries"].append({"from": bkey, "to": delivery.get("target_building_key")})
        return result

    def effective(self, base: float, property_name: str, context: dict[str, Any]) -> dict[str, Any]:
        events = [{"key": row["entity_key"], **row["payload"], "active": event_is_active(row["payload"])} for row in self.store.list("event", published=True)]
        weather = WorldClock(self.store).state()["weather"]
        modifiers = [{"key": f"weather_{weather.get('key', 'current')}", "modifiers": weather.get("modifiers", [])}]
        effective, trace = ModifierEngine().effective(base, property_name, context, modifiers, events)
        return explain(base, effective, trace)

    def world_state(self) -> dict[str, Any]:
        state = WorldClock(self.store).state()
        world_engine = WorldEngine(self.store); geography = world_engine.geography()
        with self.store.connection() as db:
            travelling_players = [str(row[0]) for row in db.execute("SELECT discord_id FROM player_travel_state")]
        for player_id in travelling_players:
            world_engine.get_travel_state(player_id)  # finalise les arrivées échues
        with self.store.connection() as db:
            positions = [dict(row) for row in db.execute("SELECT location_key,COUNT(*) players FROM player_world_state WHERE location_key<>'' GROUP BY location_key")]
            travels = [dict(row) for row in db.execute("SELECT travel.discord_id,travel.origin_key,travel.destination_key,travel.arrives_at,players.display_name FROM player_travel_state travel LEFT JOIN players ON players.discord_id=travel.discord_id ORDER BY travel.arrives_at")]
        now = __import__("time").time()
        for travel in travels: travel["remaining_seconds"] = max(0, int(float(travel["arrives_at"]) - now + .999))
        upcoming = []
        for row in self.store.list("event", published=True):
            payload = row["payload"]
            if payload.get("starts_at") and not event_is_active(payload): upcoming.append({"key": row["entity_key"], "name": payload.get("name", row["entity_key"]), "emoji": payload.get("emoji", "✦"), "starts_at": payload["starts_at"]})
        return {**state, "world": geography["counts"], "player_positions": positions, "travels": travels, "upcoming_events": sorted(upcoming, key=lambda item: item["starts_at"])[:5]}

    def impacts(self) -> dict[str, Any]:
        """Expose seulement des valeurs que le moteur consomme réellement."""
        impacts: list[dict[str, Any]] = []
        for row in self.store.list("building", published=True):
            building_key, payload = row["entity_key"], row["payload"]; modules = payload.get("modules", {})
            for activity in modules.get("activities", []):
                context={"building_key":building_key,"activity_key":activity["key"],"action_key":activity["key"],"profession_key":activity.get("profession", ""),"tags":activity.get("tags",[])}
                for prop, field, label in (("activity.duration","duration_seconds","Durée"),("energy.cost","energy_cost","Énergie"),("cooldown.duration","cooldown_seconds","Cooldown"),("availability",None,"Disponibilité")):
                    base=1 if field is None else activity.get(field,0); result=self.effective(base,prop,context)
                    if result["modifiers"]: impacts.append({"building_key":building_key,"building_name":payload.get("name",building_key),"subject_key":activity["key"],"subject_name":activity.get("name",activity["key"]),"property":prop,"label":label,**result})
            for recipe in modules.get("recipes", []):
                context={"building_key":building_key,"recipe_key":recipe["key"],"action_key":recipe["key"],"profession_key":recipe.get("profession", ""),"tags":recipe.get("tags",[])}
                for item, amount in recipe.get("ingredients", {}).items():
                    result=self.effective(amount,"recipe.ingredient_quantity",{**context,"item_key":item,"ingredient_key":item})
                    if result["modifiers"]: impacts.append({"building_key":building_key,"building_name":payload.get("name",building_key),"subject_key":recipe["key"],"subject_name":recipe.get("name",recipe["key"]),"property":"recipe.ingredient_quantity","label":f"Ingrédient {item}",**result})
            for product in modules.get("products", []):
                context={"building_key":building_key,"item_key":product.get("item_key")}; result=self.effective(product.get("price",0),"economy.price",context)
                if result["modifiers"]: impacts.append({"building_key":building_key,"building_name":payload.get("name",building_key),"subject_key":product.get("item_key"),"subject_name":product.get("name",product.get("item_key")),"property":"economy.price","label":"Prix",**result})
        return {"impacts": impacts, "supported_properties": ["production.quantity","activity.duration","energy.cost","recipe.ingredient_quantity","economy.price","cooldown.duration","availability"]}

    def locations(self) -> list[dict[str, Any]]:
        return [{"key": row["entity_key"], **row["payload"]} for row in self.store.list("location")]

    def geography(self) -> dict[str, Any]:
        return WorldEngine(self.store).geography()
