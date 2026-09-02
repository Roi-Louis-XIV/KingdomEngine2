"""Projections du World Creator au-dessus des contenus versionnés existants."""

from __future__ import annotations

import copy
from typing import Any

from KingdomData import NotFoundError
from kingdomEvent.modifiers import ModifierEngine, explain
from kingdomEvent.runtime import WorldClock, event_is_active
from kingdomEvent.lifecycle import EventLifecycle
from KingdomVoice.resolver import resolve_audio_scene
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

    def delete_profession(self, profession_key: str) -> dict[str, Any]:
        """Supprime une fiche métier et détache ses mécaniques des bâtiments.

        Les métiers historiques peuvent être embarqués dans un bâtiment alors
        que les modèles récents possèdent aussi une fiche autonome. Cette
        opération traite les deux représentations sans laisser de boutons ou
        d'activités pointant vers une définition supprimée.
        """
        updated_buildings: list[str] = []
        for entity in self.store.list("building"):
            payload = copy.deepcopy(entity["payload"])
            modules = payload.setdefault("modules", {})
            professions = modules.get("professions", [])
            activities = modules.get("activities", [])
            removed_activities = {str(row.get("key", "")) for row in activities if str(row.get("profession", "")) == profession_key}
            uses_profession = any(str(row.get("key", "")) == profession_key for row in professions)
            uses_profession = uses_profession or bool(removed_activities) or payload.get("relations", {}).get("primary_profession_key") == profession_key
            if not uses_profession:
                continue
            modules["professions"] = [row for row in professions if str(row.get("key", "")) != profession_key]
            modules["activities"] = [row for row in activities if str(row.get("profession", "")) != profession_key]
            relations = payload.setdefault("relations", {})
            if relations.get("primary_profession_key") == profession_key:
                relations["primary_profession_key"] = modules["professions"][0].get("key", "") if modules["professions"] else ""

            def references_profession(value: Any) -> bool:
                if isinstance(value, dict):
                    return value.get("profession") == profession_key or any(references_profession(item) for item in value.values())
                if isinstance(value, list):
                    return any(references_profession(item) for item in value)
                return False

            removed_actions = {f"join_{profession_key}", f"leave_{profession_key}"}
            removed_actions.update(removed_activities)
            removed_actions.update(f"claim_{key}" for key in removed_activities)
            payload["actions"] = [action for action in payload.get("actions", []) if str(action.get("key", "")) not in removed_actions and not references_profession(action)]
            interface = payload.get("interface", {})
            for page in interface.get("pages", []):
                page["components"] = [component for component in page.get("components", []) if not references_profession(component) and str(component.get("interaction", {}).get("action", "")) not in removed_actions]
            interface.get("profession_labels", {}).pop(profession_key, None)
            draft = self.store.save("building", entity["entity_key"], payload, "profession-deletion", entity["version"])
            if entity["status"] == "published":
                self.store.publish("building", entity["entity_key"], draft["version"], "profession-deletion")
                self.store.request_discord_provision("building", entity["entity_key"], "profession-deletion")
            updated_buildings.append(entity["entity_key"])

        standalone_deleted = False
        try:
            self.store.delete("profession", profession_key, "profession-deletion")
            standalone_deleted = True
        except NotFoundError:
            pass
        if not standalone_deleted and not updated_buildings:
            raise NotFoundError(f"profession/{profession_key} introuvable.")
        with self.store.connection() as db:
            db.execute("UPDATE player_professions SET active=0 WHERE profession_key=?", (profession_key,))
        return {"deleted": True, "profession_key": profession_key, "updated_buildings": updated_buildings, "standalone_deleted": standalone_deleted}

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
        lifecycle=EventLifecycle(self.store); occurrence_events=lifecycle.active_definitions()
        # Dès qu'une définition utilise le nouveau cycle de vie, son ancien
        # drapeau ``enabled`` ne doit plus la réactiver pendant une pause.
        occurrence_keys={item["event_key"] for item in lifecycle.list()}
        events = occurrence_events + [{"key": row["entity_key"], **row["payload"], "active": event_is_active(row["payload"])} for row in self.store.list("event", published=True) if row["entity_key"] not in occurrence_keys]
        world=WorldClock(self.store).state(); weather=world["weather"]
        modifiers = [{"key": f"weather_{weather.get('key', 'current')}", "modifiers": weather.get("modifiers", [])}]
        if world.get("season"): modifiers.append({"key":f"season_{world['season'].get('key','current')}","modifiers":world["season"].get("modifiers",[])})
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

    def audio_scene(self, building_key: str) -> dict[str, Any]:
        entity=self.store.get("building",building_key,published=True); world=WorldClock(self.store).state()
        building={"key":building_key,**entity["payload"]}
        scene=resolve_audio_scene(building,period=world["time_of_day"],weather=world["weather"],season=world.get("season"),events=EventLifecycle(self.store).active_definitions())
        bots=[row["payload"] for row in self.store.list("bot",published=True) if row["payload"].get("building_key")==building_key and row["payload"].get("bot_type")=="voice"]
        channels=self.store.building_channels(building_key)
        npcs=[{"key":row["entity_key"],"name":row["payload"].get("name",row["entity_key"])} for row in self.store.list("npc",published=True) if row["payload"].get("building_key")==building_key]
        return {**scene,"bot":bots[0].get("name") if bots else None,"voice_channel_id":channels.get("voice_channel_id"),"voice_channel_name":building.get("name"),"npcs":npcs}
