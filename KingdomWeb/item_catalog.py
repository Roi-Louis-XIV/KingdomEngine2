"""Catalogue humain des objets et résolution centralisée de leurs références."""

from __future__ import annotations

from typing import Any

from KingdomData import ContentStore


RELATION_LABELS = {
    "produced_by": "Produit par",
    "used_by": "Utilisé par",
    "sold_by": "Vendu par",
    "accepted_by": "Accepté par",
    "related": "Associé à",
}


class ItemCatalogService:
    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def catalog(self, search: str = "", category: str = "", building: str = "", sort: str = "name_asc") -> dict[str, Any]:
        buildings = self.store.list("building")
        building_map = {x["entity_key"]: {"key": x["entity_key"], "name": x["payload"].get("name", x["entity_key"]), "emoji": x["payload"].get("emoji", "🏰")} for x in buildings}
        relations: dict[str, dict[str, set[str]]] = {}
        for entity in buildings:
            self._building_relations(entity["entity_key"], entity["payload"], relations)
        items = []
        for entity in self.store.list("item"):
            payload = entity["payload"]; key = entity["entity_key"]
            item_relations = relations.setdefault(key, {})
            for relation in payload.get("building_relations", []):
                item_relations.setdefault(str(relation.get("building_key")), set()).add(str(relation.get("relation", "related")))
            links = [{**building_map.get(building_key, {"key": building_key, "name": "Bâtiment inconnu", "emoji": "⚠️"}), "relations": sorted(roles), "relation_labels": [RELATION_LABELS.get(role, role) for role in sorted(roles)], "missing": building_key not in building_map} for building_key, roles in item_relations.items()]
            items.append({"id": key, "name": payload.get("name", key), "emoji": payload.get("emoji", "📦"), "description": payload.get("description", ""), "category": payload.get("category", payload.get("type", "other")), "type": payload.get("type", payload.get("category", "other")), "status": entity["status"], "version": entity["version"], "created_at": entity["created_at"], "buildings": sorted(links, key=lambda x: x["name"].casefold()), "payload": payload})
        total = len(items); query = search.strip().casefold()
        if query: items = [x for x in items if query in f"{x['name']} {x['id']} {x['description']}".casefold()]
        if category: items = [x for x in items if x["category"] == category or x["type"] == category]
        if building: items = [x for x in items if any(link["key"] == building for link in x["buildings"])]
        sorters = {"name_asc": lambda x: x["name"].casefold(), "name_desc": lambda x: x["name"].casefold(), "type": lambda x: (x["category"].casefold(), x["name"].casefold()), "building": lambda x: ((x["buildings"][0]["name"].casefold() if x["buildings"] else "zzzz"), x["name"].casefold()), "recent": lambda x: x["created_at"]}
        items.sort(key=sorters.get(sort, sorters["name_asc"]), reverse=sort in {"name_desc", "recent"})
        categories = sorted({x["category"] for x in self._unfiltered_items(buildings, relations) if x["category"]})
        return {"items": items, "total": total, "count": len(items), "categories": categories, "buildings": sorted(building_map.values(), key=lambda x: x["name"].casefold()), "relation_labels": RELATION_LABELS}

    def resolve(self, item_id: str) -> dict[str, Any]:
        entity = next((x for x in self.catalog()["items"] if x["id"] == item_id), None)
        return entity or {"id": item_id, "name": "Objet inconnu", "emoji": "⚠️", "description": "", "category": "missing", "type": "missing", "buildings": [], "missing": True}

    def _unfiltered_items(self, buildings, relations):
        # Petite vue uniquement destinée aux facettes, sans nouvel accès SQLite.
        return [{"category": x["payload"].get("category", x["payload"].get("type", "other"))} for x in self.store.list("item")]

    @staticmethod
    def _add(target: dict[str, dict[str, set[str]]], item: Any, building: str, role: str) -> None:
        if isinstance(item, str) and item and item not in {"money", "energy"}:
            target.setdefault(item, {}).setdefault(building, set()).add(role)

    def _building_relations(self, building: str, payload: dict[str, Any], target: dict[str, dict[str, set[str]]]) -> None:
        modules = payload.get("modules", {})
        for profession in modules.get("professions", []): self._add(target, profession.get("required_item"), building, "used_by")
        for activity in modules.get("activities", []):
            self._add(target, activity.get("tool"), building, "used_by")
            for outcome in activity.get("outcomes", []):
                for effect in outcome.get("effects", []): self._effect(effect, building, target)
        for product in modules.get("products", []): self._add(target, product.get("item_key"), building, "sold_by")
        for recipe in modules.get("recipes", []):
            for item in recipe.get("ingredients", {}): self._add(target, item, building, "used_by")
            self._add(target, recipe.get("output_item_key"), building, "produced_by")
        for delivery in modules.get("deliveries", []): self._add(target, delivery.get("item_key", delivery.get("resource")), str(delivery.get("target_building_key", building)), "accepted_by")
        for upgrade in modules.get("upgrades", []):
            self._add(target, upgrade.get("tool_key", upgrade.get("tool")), building, "used_by")
            for item in upgrade.get("ingredients", {}): self._add(target, item, building, "used_by")
        for action in payload.get("actions", []):
            for item in action.get("requirements", {}).get("items", {}): self._add(target, item, building, "used_by")
            for effect in action.get("effects", []): self._effect(effect, building, target)

    def _effect(self, effect: dict[str, Any], building: str, target: dict[str, dict[str, set[str]]]) -> None:
        kind = effect.get("type", "")
        role = "produced_by" if kind in {"reward", "production", "stock_reward", "tool_grant"} else "used_by" if kind in {"cost", "stock_cost", "durability", "tool_modify"} else "related"
        self._add(target, effect.get("resource", effect.get("item", effect.get("tool"))), str(effect.get("building", building)), role)
        for outcome in effect.get("outcomes", []):
            for nested in outcome.get("effects", []): self._effect(nested, building, target)
            for item in outcome.get("rewards", {}): self._add(target, item, building, "produced_by")
        for choice in effect.get("choices", []): self._add(target, choice.get("item"), building, "produced_by")
