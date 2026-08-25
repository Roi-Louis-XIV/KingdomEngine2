"""Moteur géographique générique : hiérarchie, routes et exploration individuelle."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from KingdomData.store import ContentStore, NotFoundError


class WorldError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorldEngine:
    """Exécute le graphe publié sans confondre position logique et Discord."""

    def __init__(self, store: ContentStore):
        self.store = store

    def locations(self, published: bool = True) -> dict[str, dict[str, Any]]:
        rows = self.store.list("location", published=published)
        if published and not rows:
            rows = self.store.list("location")
        return {row["entity_key"]: {"key": row["entity_key"], **row["payload"]} for row in rows}

    def geography(self) -> dict[str, Any]:
        locations = self.locations(False)
        buildings = self.store.list("building")
        children: dict[str, list[str]] = {key: [] for key in locations}
        for key, location in locations.items():
            parent = str(location.get("parent_key", ""))
            if parent in children:
                children[parent].append(key)
        attached: dict[str, list[dict[str, str]]] = {key: [] for key in locations}
        for row in buildings:
            location_key = str(row["payload"].get("location_key", ""))
            if location_key in attached:
                attached[location_key].append({"key": row["entity_key"], "name": row["payload"].get("name", row["entity_key"]), "emoji": row["payload"].get("emoji", "🏰")})
        nodes = [{**location, "children": sorted(children[key]), "buildings": attached[key]} for key, location in locations.items()]
        return {
            "nodes": sorted(nodes, key=lambda item: (item.get("parent_key", ""), item.get("name", item["key"]))),
            "roots": sorted([key for key, value in locations.items() if not value.get("parent_key")]),
            "connections": self._connections(locations),
            "counts": {
                "locations": len(locations), "buildings": len(buildings),
                "connections": len(self._connections(locations)),
                "secret_routes": sum(route["visibility"] != "visible" for route in self._connections(locations)),
            },
        }

    @staticmethod
    def _connections(locations: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        result, seen = [], set()
        for origin, location in locations.items():
            for index, raw in enumerate(location.get("connections", [])):
                target = str(raw.get("target", ""))
                key = str(raw.get("key") or f"{origin}__{target}")
                if key in seen or target not in locations:
                    continue
                seen.add(key)
                result.append({
                    "key": key, "origin": origin, "target": target,
                    "name": raw.get("name") or f"{location.get('name', origin)} → {locations[target].get('name', target)}",
                    "direction": raw.get("direction", "one_way"),
                    "duration_seconds": max(0, int(raw.get("duration_seconds", 0))),
                    "cost": max(0, int(raw.get("cost", 0))),
                    "visibility": raw.get("visibility", "visible"),
                    "conditions": raw.get("conditions", []),
                })
        return result

    @staticmethod
    def _decode_state(row, discord_id: str) -> dict[str, Any]:
        if not row:
            return {"discord_id": str(discord_id), "realm_key": "", "location_key": "", "active_building_key": "", "discovered_locations": [], "discovered_routes": []}
        result = dict(row)
        result["discovered_locations"] = json.loads(result.pop("discovered_locations_json"))
        result["discovered_routes"] = json.loads(result.pop("discovered_routes_json"))
        return result

    def player_state(self, discord_id: str) -> dict[str, Any]:
        self._finalize_due(discord_id)
        with self.store.connection() as db:
            row = db.execute("SELECT * FROM player_world_state WHERE discord_id=?", (str(discord_id),)).fetchone()
        return self._decode_state(row, discord_id)

    def get_travel_state(self, discord_id: str, *, now: float | None = None) -> dict[str, Any] | None:
        self._finalize_due(discord_id, now=now)
        with self.store.connection() as db:
            row = db.execute("SELECT * FROM player_travel_state WHERE discord_id=?", (str(discord_id),)).fetchone()
        if not row:
            return None
        result = dict(row); result["metadata"] = json.loads(result.pop("metadata_json") or "{}")
        result["remaining_seconds"] = max(0, int(float(result["arrives_at"]) - (time.time() if now is None else now) + .999))
        return result

    def _finalize_due(self, discord_id: str, *, now: float | None = None) -> bool:
        current_time = time.time() if now is None else float(now)
        with self.store.connection() as db:
            pending = db.execute("SELECT arrives_at FROM player_travel_state WHERE discord_id=?", (str(discord_id),)).fetchone()
        if not pending or float(pending["arrives_at"]) > current_time:
            return False
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            travel = db.execute("SELECT * FROM player_travel_state WHERE discord_id=?", (str(discord_id),)).fetchone()
            if not travel or float(travel["arrives_at"]) > current_time:
                return False
            state_row = db.execute("SELECT * FROM player_world_state WHERE discord_id=?", (str(discord_id),)).fetchone()
            state = self._decode_state(state_row, discord_id)
            destination = str(travel["destination_key"])
            destination_exists = destination in self.locations()
            if destination_exists:
                discovered_locations = sorted(set(state["discovered_locations"]) | {destination})
                discovered_routes = sorted(set(state["discovered_routes"]) | {str(travel["route_key"])})
                db.execute("UPDATE player_world_state SET location_key=?,active_building_key='',discovered_locations_json=?,discovered_routes_json=?,updated_at=? WHERE discord_id=?", (destination, json.dumps(discovered_locations), json.dumps(discovered_routes), _now(), str(discord_id)))
            db.execute("DELETE FROM player_travel_state WHERE discord_id=?", (str(discord_id),))
            return destination_exists

    def place(self, discord_id: str, location_key: str, *, realm_key: str = "") -> dict[str, Any]:
        locations = self.locations()
        if location_key not in locations:
            raise WorldError("Lieu publié introuvable.")
        current = self.player_state(discord_id)
        with self.store.connection() as db:
            if not db.execute("SELECT 1 FROM players WHERE discord_id=?", (str(discord_id),)).fetchone():
                db.execute("INSERT INTO players(discord_id,updated_at,created_at) VALUES(?,?,?)", (str(discord_id), _now(), _now()))
            discovered = sorted(set(current["discovered_locations"]) | {location_key})
            db.execute(
                "INSERT INTO player_world_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET realm_key=excluded.realm_key,location_key=excluded.location_key,active_building_key='',discovered_locations_json=excluded.discovered_locations_json,updated_at=excluded.updated_at",
                (str(discord_id), realm_key or current.get("realm_key", ""), location_key, "", json.dumps(discovered), json.dumps(current["discovered_routes"]), _now()),
            )
            # Un déplacement administratif explicite annule proprement le
            # trajet précédent au lieu de laisser deux positions concurrentes.
            db.execute("DELETE FROM player_travel_state WHERE discord_id=?", (str(discord_id),))
        return self.player_state(discord_id)

    def available_routes(self, discord_id: str, location_key: str | None = None) -> list[dict[str, Any]]:
        if self.get_travel_state(discord_id):
            return []
        state, locations = self.player_state(discord_id), self.locations()
        origin = location_key or state["location_key"]
        result = []
        for route in self._connections(locations):
            destination = None
            if route["origin"] == origin:
                destination = route["target"]
            elif route["direction"] == "bidirectional" and route["target"] == origin:
                destination = route["origin"]
            if not destination:
                continue
            known = route["key"] in state["discovered_routes"]
            if route["visibility"] in {"secret", "discovered"} and not known:
                continue
            if not self._conditions_met(discord_id, route["conditions"]):
                continue
            result.append({**route, "destination": destination, "destination_name": locations[destination].get("name", destination)})
        return result

    def _conditions_met(self, discord_id: str, conditions: list[dict[str, Any]]) -> bool:
        with self.store.connection() as db:
            for condition in conditions or []:
                kind, key, minimum = condition.get("type"), str(condition.get("key", "")), int(condition.get("minimum", 1))
                if kind == "item" and int((db.execute("SELECT quantity FROM inventory WHERE discord_id=? AND item_key=?", (str(discord_id), key)).fetchone() or [0])[0]) < minimum:
                    return False
                if kind == "profession" and not db.execute("SELECT 1 FROM player_professions WHERE discord_id=? AND profession_key=? AND active=1 AND level>=?", (str(discord_id), key, minimum)).fetchone():
                    return False
        return True

    def travel(self, discord_id: str, destination: str, *, now: float | None = None) -> dict[str, Any]:
        current_time = time.time() if now is None else float(now)
        if self.get_travel_state(discord_id, now=current_time):
            raise WorldError("Un voyage est déjà en cours.")
        state = self.player_state(discord_id)
        route = next((item for item in self.available_routes(discord_id) if item["destination"] == destination), None)
        if not state["location_key"]:
            raise WorldError("Le joueur n’a pas encore de position de départ.")
        if not route:
            raise WorldError("Cette destination n’est pas accessible depuis la position actuelle.")
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM player_travel_state WHERE discord_id=?", (str(discord_id),)).fetchone():
                raise WorldError("Un voyage est déjà en cours.")
            cost = int(route.get("cost", 0))
            if cost:
                money = int((db.execute("SELECT money FROM players WHERE discord_id=?", (str(discord_id),)).fetchone() or [0])[0])
                if money < cost: raise WorldError(f"Il vous manque {cost - money} écu(s) pour ce voyage.")
                db.execute("UPDATE players SET money=money-?,updated_at=? WHERE discord_id=?", (cost, _now(), str(discord_id)))
            duration = int(route["duration_seconds"])
            db.execute("INSERT INTO world_travel_log(discord_id,origin_key,destination_key,route_key,duration_seconds,created_at) VALUES(?,?,?,?,?,?)", (str(discord_id), state["location_key"], destination, route["key"], route["duration_seconds"], _now()))
            if duration > 0:
                db.execute("INSERT INTO player_travel_state(discord_id,status,origin_key,destination_key,route_key,started_at,arrives_at,duration_seconds,metadata_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (str(discord_id), "travelling", state["location_key"], destination, route["key"], current_time, current_time + duration, duration, json.dumps({"route_name": route.get("name", "")}, ensure_ascii=False), _now()))
            else:
                discovered_locations = sorted(set(state["discovered_locations"]) | {destination})
                discovered_routes = sorted(set(state["discovered_routes"]) | {route["key"]})
                db.execute("UPDATE player_world_state SET location_key=?,active_building_key='',discovered_locations_json=?,discovered_routes_json=?,updated_at=? WHERE discord_id=?", (destination, json.dumps(discovered_locations), json.dumps(discovered_routes), _now(), str(discord_id)))
        if duration > 0:
            return {"state": state, "travel": self.get_travel_state(discord_id, now=current_time), "route": route}
        return {"state": self.player_state(discord_id), "travel": None, "route": route}

    def enter_building(self, discord_id: str, building_key: str) -> dict[str, Any]:
        if self.get_travel_state(discord_id):
            raise WorldError("Vous ne pouvez pas entrer dans un bâtiment pendant un voyage.")
        try:
            building = self.store.get("building", building_key, published=True)["payload"]
        except NotFoundError as exc:
            raise WorldError("Bâtiment publié introuvable.") from exc
        location_key = str(building.get("location_key", ""))
        if not location_key:
            raise WorldError("Ce bâtiment n’est pas encore situé dans le monde.")
        self.place(discord_id, location_key)
        with self.store.connection() as db:
            db.execute("UPDATE player_world_state SET active_building_key=?,updated_at=? WHERE discord_id=?", (building_key, _now(), str(discord_id)))
        return self.player_state(discord_id)

    def leave_building(self, discord_id: str) -> dict[str, Any]:
        with self.store.connection() as db:
            db.execute("UPDATE player_world_state SET active_building_key='',updated_at=? WHERE discord_id=?", (_now(), str(discord_id)))
        return self.player_state(discord_id)

    def discover_route(self, discord_id: str, route_key: str) -> dict[str, Any]:
        state = self.player_state(discord_id)
        routes = {route["key"] for route in self._connections(self.locations())}
        if route_key not in routes:
            raise WorldError("Chemin introuvable.")
        discovered = sorted(set(state["discovered_routes"]) | {route_key})
        with self.store.connection() as db:
            db.execute("UPDATE player_world_state SET discovered_routes_json=?,updated_at=? WHERE discord_id=?", (json.dumps(discovered), _now(), str(discord_id)))
        return self.player_state(discord_id)

    def local_activities(self, discord_id: str) -> list[dict[str, Any]]:
        if self.get_travel_state(discord_id):
            return []
        state, locations = self.player_state(discord_id), self.locations()
        location = locations.get(state["location_key"], {})
        result = []
        for reference in location.get("activities", []):
            building_key, activity_key = reference.get("building_key"), reference.get("activity_key")
            try:
                building = self.store.get("building", building_key, published=True)["payload"]
            except NotFoundError:
                continue
            activity = next((item for item in building.get("modules", {}).get("activities", []) if item.get("key") == activity_key), None)
            if activity:
                result.append({"building_key": building_key, **activity})
        return result

    def local_buildings(self, discord_id: str) -> list[dict[str, str]]:
        if self.get_travel_state(discord_id): return []
        state = self.player_state(discord_id)
        return next((node["buildings"] for node in self.geography()["nodes"] if node["key"] == state["location_key"]), [])

    def known_destinations(self, discord_id: str) -> list[dict[str, str]]:
        state, locations = self.player_state(discord_id), self.locations()
        return [{"key": key, "name": locations[key].get("name", key), "emoji": locations[key].get("emoji", "📍")} for key in state["discovered_locations"] if key in locations]
