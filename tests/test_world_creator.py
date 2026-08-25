from KingdomData import ContentStore
from kingdomEvent.modifiers import ModifierEngine
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.engine import GameEngine
from kingdomEvent import EventBus
import asyncio


def publish(store, entity_type, key, payload):
    draft = store.save(entity_type, key, payload)
    return store.publish(entity_type, key, draft["version"])


def test_profession_and_item_relations_are_derived_without_parallel_storage(tmp_path):
    store = ContentStore(tmp_path / "world.db"); store.initialize()
    publish(store, "item", "simple_axe", {"name": "Hache", "category": "tool"})
    publish(store, "item", "wood", {"name": "Bois"})
    publish(store, "building", "forest", {"name": "Forêt", "relations": {"primary_profession_key": "woodcutter"}, "modules": {
        "professions": [{"key": "woodcutter", "name": "Bûcheron", "required_item": "simple_axe"}],
        "activities": [{"key": "royal_edge", "name": "Lisière", "profession": "woodcutter", "tool": "simple_axe", "outcomes": [{"weight": 1, "effects": [{"type": "reward", "resource": "wood", "amount": 10}]}]}],
        "products": [], "recipes": [], "deliveries": [], "upgrades": [],
    }, "actions": []})
    service = WorldCreatorService(store); profession = service.professions()[0]; usage = service.item_usage("simple_axe")
    assert profession["key"] == "woodcutter" and profession["buildings"][0]["primary"]
    assert profession["produced_items"] == ["wood"]
    assert usage["tools"] == [{"profession": "woodcutter", "building": "forest"}, {"activity": "royal_edge", "building": "forest"}]
    assert "building_relations" not in store.get("item", "simple_axe")["payload"]


def test_event_modifier_changes_effective_value_not_base(tmp_path):
    store = ContentStore(tmp_path / "events.db"); store.initialize()
    publish(store, "event", "test_famine", {"name": "Famine test", "active": True, "trigger": {"type": "manual"}, "modifiers": [{"target": {"type": "building", "key": "farm"}, "property": "production.quantity", "operator": "multiply", "value": .5}]})
    result = WorldCreatorService(store).effective(10, "production.quantity", {"building_key": "farm"})
    assert result["base"] == 10 and result["effective"] == 5
    assert store.get("event", "test_famine", published=True)["payload"]["modifiers"][0]["value"] == .5


def test_environment_precedes_events_and_exposes_day_night(tmp_path):
    store = ContentStore(tmp_path / "environment.db"); store.initialize()
    publish(store, "environment", "world_environment", {"name": "Monde", "mode": "manual", "day": 4, "hour": 23, "weather": {"key": "rain", "name": "Pluie", "emoji": "🌧", "modifiers": [{"property": "activity.duration", "operator": "multiply", "value": 1.2}]}})
    result = WorldCreatorService(store).effective(10, "activity.duration", {})
    assert result["effective"] == 12
    assert WorldCreatorService(store).world_state()["time_of_day"] == "night"


def test_locations_and_connections_are_persistent(tmp_path):
    store = ContentStore(tmp_path / "locations.db"); store.initialize()
    publish(store, "location", "capital", {"name": "Capitale", "location_type": "city", "connections": [{"target": "alenor_forest", "duration_seconds": 60}]})
    publish(store, "location", "alenor_forest", {"name": "Forêt d’Alenor", "location_type": "forest", "connections": [{"target": "valbrume", "duration_seconds": 120}]})
    publish(store, "location", "valbrume", {"name": "Valbrume", "location_type": "city", "connections": []})
    locations = WorldCreatorService(store).locations()
    assert [row["key"] for row in locations] == ["alenor_forest", "capital", "valbrume"]
    assert next(row for row in locations if row["key"] == "capital")["connections"][0]["target"] == "alenor_forest"


def test_modifier_operators_are_deterministic():
    sources = [{"key": "rain", "modifiers": [{"property": "value", "operator": "multiply", "value": 2}]}]
    events = [{"key": "famine", "active": True, "modifiers": [{"property": "value", "operator": "add", "value": 3}]}]
    effective, trace = ModifierEngine().effective(5, "value", {}, sources, events)
    assert effective == 13 and [item.source for item in trace] == ["environment:rain", "event:famine"]


def test_active_event_changes_real_gameplay_reward_and_can_be_disabled(tmp_path):
    store = ContentStore(tmp_path / "gameplay.db"); store.initialize()
    publish(store, "item", "wheat", {"name": "Blé"})
    publish(store, "building", "farm", {"name": "Ferme", "modules": {"professions": [], "activities": [], "products": [], "recipes": [], "deliveries": [], "upgrades": []}, "actions": [{"key": "harvest_wheat", "name": "Récolter", "effects": [{"type": "reward", "resource": "wheat", "amount": 10}]}]})
    active = publish(store, "event", "test_famine", {"name": "Famine test", "active": True, "trigger": {"type": "manual"}, "modifiers": [{"target": {"type": "building", "key": "farm"}, "property": "production.quantity", "operator": "multiply", "value": .5}]})
    engine = GameEngine(store, EventBus())
    result = asyncio.run(engine.execute("player", "farm", "harvest_wheat", "active-event", {}))
    assert result["player"]["inventory"]["wheat"] == 5
    draft = store.save("event", "test_famine", {**active["payload"], "active": False}, expected_version=active["version"]); store.publish("event", "test_famine", draft["version"])
    result = asyncio.run(engine.execute("player", "farm", "harvest_wheat", "inactive-event", {}))
    assert result["player"]["inventory"]["wheat"] == 15
