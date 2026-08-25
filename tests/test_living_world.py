import asyncio
from datetime import datetime, timezone

import pytest

from KingdomData.store import ContentStore
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.engine import GameEngine
from kingdomCore.world import WorldEngine, WorldError
from kingdomEvent.modifiers import ModifierEngine
from kingdomEvent.runtime import WorldClock, event_is_active


def publish(store, kind, key, payload):
    draft = store.save(kind, key, payload, "test")
    return store.publish(kind, key, draft["version"], "test")


@pytest.fixture()
def living_store(tmp_path):
    store = ContentStore(tmp_path / "living.db"); store.initialize()
    publish(store, "item", "wood", {"name": "Bois", "price": 1})
    for key, payload in [
        ("realm", {"name": "Royaume", "location_type": "kingdom", "connections": []}),
        ("central", {"name": "Région centrale", "location_type": "region", "parent_key": "realm", "connections": []}),
        ("capital", {"name": "Capitale", "location_type": "city", "parent_key": "central", "connections": [{"key": "north_gate", "target": "forest", "name": "Porte Nord", "direction": "bidirectional", "duration_seconds": 10}]}),
        ("forest", {"name": "Forêt", "location_type": "forest", "parent_key": "central", "exploration_enabled": True, "activities": [{"building_key": "woodcamp", "activity_key": "cut"}], "connections": [{"key": "hidden_path", "target": "village", "name": "Passage oublié", "direction": "one_way", "visibility": "secret"}]}),
        ("village", {"name": "Village", "location_type": "village", "parent_key": "central", "connections": []}),
    ]: publish(store, "location", key, payload)
    publish(store, "building", "woodcamp", {"name": "Camp", "location_key": "forest", "modules": {"professions": [], "activities": [{"key": "cut", "name": "Couper du bois", "outcomes": []}]}, "actions": []})
    return store


def test_geography_is_hierarchical_and_building_relation_is_derived(living_store):
    geography = WorldEngine(living_store).geography()
    central = next(node for node in geography["nodes"] if node["key"] == "central")
    forest = next(node for node in geography["nodes"] if node["key"] == "forest")
    assert set(central["children"]) == {"capital", "forest", "village"}
    assert forest["buildings"][0]["key"] == "woodcamp"
    assert geography["counts"] == {"locations": 5, "buildings": 1, "connections": 2, "secret_routes": 1}
    assert {link["origin"]: link["target"] for link in geography["hierarchy"]} == {
        "central": "realm", "capital": "central", "forest": "central", "village": "central"
    }


def test_player_travel_exploration_and_discovery_are_persistent(living_store):
    world = WorldEngine(living_store)
    assert world.place("42", "capital", realm_key="realm")["location_key"] == "capital"
    assert [route["destination"] for route in world.available_routes("42")] == ["forest"]
    result = world.travel("42", "forest", now=100)
    assert result["state"]["location_key"] == "capital"
    assert result["travel"]["remaining_seconds"] == 10
    assert world.get_travel_state("42", now=111) is None
    assert world.player_state("42")["location_key"] == "forest"
    assert "forest" in world.player_state("42")["discovered_locations"]
    assert "village" not in {route["destination"] for route in world.available_routes("42")}  # passage secret encore inconnu
    world.discover_route("42", "hidden_path")
    assert world.travel("42", "village")["state"]["location_key"] == "village"
    reloaded = WorldEngine(living_store).player_state("42")
    assert {"capital", "forest", "village"}.issubset(reloaded["discovered_locations"])
    assert {"north_gate", "hidden_path"}.issubset(reloaded["discovered_routes"])


def test_local_activity_reuses_building_definition(living_store):
    world = WorldEngine(living_store); world.place("42", "forest")
    assert world.local_activities("42") == [{"building_key": "woodcamp", "key": "cut", "name": "Couper du bois", "outcomes": []}]


def test_entering_and_leaving_building_preserves_geographic_context(living_store):
    world = WorldEngine(living_store)
    entered = world.enter_building("42", "woodcamp")
    assert entered["location_key"] == "forest" and entered["active_building_key"] == "woodcamp"
    left = world.leave_building("42")
    assert left["location_key"] == "forest" and left["active_building_key"] == ""


def test_travel_is_validated_by_engine(living_store):
    world = WorldEngine(living_store); world.place("42", "capital")
    with pytest.raises(WorldError): world.travel("42", "village")


def test_persistent_accelerated_clock_and_weighted_weather(tmp_path):
    store = ContentStore(tmp_path / "clock.db"); store.initialize()
    publish(store, "environment", "world", {"name": "Monde", "mode": "weighted", "clock_mode": "accelerated", "day": 1, "hour": 17, "speed": 3600, "weather_interval_seconds": 1, "weather": {"key": "clear", "name": "Beau"}, "weather_options": [{"key": "rain", "name": "Pluie", "weight": 1, "modifiers": []}]})
    clock = WorldClock(store); first = clock.state(now=1000); later = clock.state(now=1006)
    assert first["hour"] == 17 and later["day"] == 1 and later["hour"] == 23 and later["time_of_day"] == "night"
    assert later["weather"]["key"] == "rain"
    assert WorldClock(store).state(now=1006)["weather"]["key"] == "rain"


def test_clock_reloads_a_published_environment_without_restart(tmp_path):
    store = ContentStore(tmp_path / "live_clock.db"); store.initialize()
    first = publish(store, "environment", "world", {"name": "Monde", "clock_mode": "manual", "day": 2, "hour": 3, "minute": 0, "weather": {"key": "clear", "name": "Beau"}})
    clock = WorldClock(store)
    assert clock.state(now=1000)["hour"] == 3
    draft = store.save("environment", "world", {"name": "Monde", "clock_mode": "manual", "day": 4, "hour": 18, "minute": 30, "weather": {"key": "rain", "name": "Pluie"}}, "test", first["version"])
    store.publish("environment", "world", draft["version"], "test")
    refreshed = clock.state(now=1001)
    assert (refreshed["day"], refreshed["hour"], refreshed["minute"]) == (4, 18, 30)
    assert refreshed["weather"]["key"] == "rain"


def test_scheduled_event_and_targeted_modifier_restore_base(living_store):
    now = datetime.now(timezone.utc).timestamp()
    payload = {"name": "Hiver", "enabled": True, "trigger": {"type": "scheduled"}, "starts_at": datetime.fromtimestamp(now-1, timezone.utc).isoformat(), "ends_at": datetime.fromtimestamp(now+1, timezone.utc).isoformat(), "modifiers": [{"target": {"type": "building", "key": "woodcamp"}, "property": "production.quantity", "operator": "multiply", "value": .5}]}
    assert event_is_active(payload, now) and not event_is_active(payload, now+2)
    engine = ModifierEngine(); value, _ = engine.effective(10, "production.quantity", {"building_key": "woodcamp"}, [], [{"key": "winter", **payload, "active": event_is_active(payload, now)}])
    other, _ = engine.effective(10, "production.quantity", {"building_key": "forge"}, [], [{"key": "winter", **payload, "active": True}])
    restored, _ = engine.effective(10, "production.quantity", {"building_key": "woodcamp"}, [], [{"key": "winter", **payload, "active": event_is_active(payload, now+2)}])
    assert (value, other, restored) == (5, 10, 10)


def test_live_world_state_uses_real_geography(living_store):
    state = WorldCreatorService(living_store).world_state()
    assert state["world"]["locations"] == 5
    assert state["world"]["connections"] == 2
