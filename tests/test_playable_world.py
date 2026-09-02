import asyncio
import time

import pytest

from KingdomData import ContentStore, ValidationError
from kingdomCore.engine import GameEngine
from kingdomCore.world import WorldEngine, WorldError
from KingdomWeb.world_creator import WorldCreatorService


def publish(store, kind, key, payload):
    draft = store.save(kind, key, payload, "test")
    return store.publish(kind, key, draft["version"], "test")


def playable_store(tmp_path, *, duration=30, cooldown=0, activity_duration=0):
    store = ContentStore(tmp_path / "playable.db"); store.initialize()
    for key, name in (("wood", "Bois"), ("meal", "Repas")):
        publish(store, "item", key, {"name": name})
    publish(store, "location", "capital", {"name": "Capitale", "location_type": "city", "connections": [{"key": "north_gate", "target": "forest", "name": "Porte Nord", "direction": "bidirectional", "duration_seconds": duration}]})
    publish(store, "location", "forest", {"name": "Forêt", "location_type": "forest", "exploration_enabled": True, "activities": [{"building_key": "camp", "activity_key": "cut"}], "connections": []})
    publish(store, "building", "camp", {"name": "Camp", "location_key": "forest", "action_mode": "generated", "modules": {
        "professions": [], "products": [{"item_key": "meal", "name": "Repas", "price": 10, "initial_stock": 5}], "deliveries": [], "upgrades": [],
        "activities": [{"key": "cut", "name": "Couper du bois", "duration_seconds": activity_duration, "energy_cost": 5, "cooldown_seconds": cooldown, "outcomes": [{"key": "wood", "weight": 1, "effects": [{"type": "reward", "resource": "wood", "amount": 1}]}]}],
        "recipes": [{"key": "cook", "name": "Cuisiner", "duration_seconds": 0, "energy_cost": 5, "ingredient_source": "player", "ingredients": {"wood": 2}, "output_item_key": "meal", "output_quantity": 1, "output_destination": "player"}],
    }, "actions": []})
    return store


def test_timed_travel_is_persistent_atomic_and_finalized_after_restart(tmp_path):
    store = playable_store(tmp_path); world = WorldEngine(store); world.place("42", "capital")
    started_at = time.time(); started = world.travel("42", "forest", now=started_at)
    assert started["state"]["location_key"] == "capital"
    assert started["travel"]["remaining_seconds"] == 30
    with pytest.raises(WorldError, match="cours"):
        world.travel("42", "forest", now=started_at + 1)
    rebuilt = WorldEngine(store)
    assert rebuilt.get_travel_state("42", now=started_at + 10)["remaining_seconds"] == 20
    assert rebuilt.get_travel_state("42", now=started_at + 31) is None
    state = rebuilt.player_state("42")
    assert state["location_key"] == "forest"
    assert {"forest"}.issubset(state["discovered_locations"])
    assert "north_gate" in state["discovered_routes"]


def test_zero_duration_route_is_immediate(tmp_path):
    store = playable_store(tmp_path, duration=0); world = WorldEngine(store); world.place("42", "capital")
    result = world.travel("42", "forest")
    assert result["travel"] is None and result["state"]["location_key"] == "forest"


def test_deleted_destination_cancels_safely_and_admin_placement_clears_travel(tmp_path):
    store = playable_store(tmp_path); world = WorldEngine(store); world.place("42", "capital")
    started = time.time(); world.travel("42", "forest", now=started)
    with store.connection() as db:
        db.execute("UPDATE content SET status='archived' WHERE entity_type='location' AND entity_key='forest'")
    assert world.get_travel_state("42", now=started + 31) is None
    assert world.player_state("42")["location_key"] == "capital"
    # Un nouveau lieu publié peut toujours servir de repositionnement sûr.
    publish(store, "location", "harbor", {"name": "Port", "location_type": "place", "connections": []})
    world.place("42", "harbor")
    assert world.get_travel_state("42") is None and world.player_state("42")["location_key"] == "harbor"


def test_local_activity_is_position_validated_and_blocked_during_travel(tmp_path):
    store = playable_store(tmp_path); world = WorldEngine(store); engine = GameEngine(store)
    world.place("42", "capital")
    with pytest.raises(ValidationError, match="position actuelle"):
        asyncio.run(engine.execute_local_activity("42", "camp", "cut", "wrong-place"))
    world.travel("42", "forest")
    with pytest.raises(ValidationError, match="voyage"):
        asyncio.run(engine.execute_local_activity("42", "camp", "cut", "travelling"))
    world.place("42", "forest")
    result = asyncio.run(engine.execute_local_activity("42", "camp", "cut", "local"))
    assert result["player"]["energy"] == 95 and result["player"]["inventory"]["wood"] == 1


def test_energy_and_ingredient_modifiers_are_consumed_by_gameplay(tmp_path):
    store = playable_store(tmp_path); world = WorldEngine(store); world.place("42", "forest")
    publish(store, "event", "winter", {"name": "Hiver", "active": True, "trigger": {"type": "manual"}, "modifiers": [
        {"target": {"type": "activity", "key": "cut"}, "property": "energy.cost", "operator": "multiply", "value": 1.2},
        {"target": {"type": "recipe", "key": "cook"}, "property": "recipe.ingredient_quantity", "operator": "multiply", "value": 1.5},
    ]})
    engine = GameEngine(store)
    cut = asyncio.run(engine.execute_local_activity("42", "camp", "cut", "cut-winter"))
    assert cut["player"]["energy"] == 94
    with store.connection() as db:
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42','wood',5) ON CONFLICT(discord_id,item_key) DO UPDATE SET quantity=5")
    cooked = asyncio.run(engine.execute("42", "camp", "cook", "cook-winter"))
    assert cooked["player"]["inventory"]["wood"] == 2  # 5 - (2 × 1,5)
    assert cooked["player"]["inventory"]["meal"] == 1


def test_effective_cooldown_and_availability_block_real_actions(tmp_path):
    store = playable_store(tmp_path, cooldown=20); WorldEngine(store).place("42", "forest")
    publish(store, "event", "conditions", {"name": "Conditions", "active": True, "trigger": {"type": "manual"}, "modifiers": [
        {"target": {"type": "activity", "key": "cut"}, "property": "cooldown.duration", "operator": "multiply", "value": .5},
    ]})
    engine = GameEngine(store); asyncio.run(engine.execute_local_activity("42", "camp", "cut", "cooldown-1"))
    assert 1 <= engine.cooldown_remaining("42", "camp", "cut") <= 10
    with pytest.raises(ValidationError, match="disponible dans"):
        asyncio.run(engine.execute_local_activity("42", "camp", "cut", "cooldown-2"))
    publish(store, "event", "closed", {"name": "Fermeture", "active": True, "trigger": {"type": "manual"}, "modifiers": [
        {"target": {"type": "activity", "key": "cut"}, "property": "availability", "operator": "set", "value": 0},
    ]})
    WorldEngine(store).place("43", "forest")
    with pytest.raises(ValidationError, match="indisponible"):
        asyncio.run(engine.execute_local_activity("43", "camp", "cut", "closed"))


def test_duration_production_and_price_modifiers_are_consumed(tmp_path):
    store = playable_store(tmp_path, activity_duration=10); WorldEngine(store).place("42", "forest")
    publish(store, "event", "dynamic", {"name": "Monde dynamique", "active": True, "trigger": {"type": "manual"}, "modifiers": [
        {"target": {"type": "activity", "key": "cut"}, "property": "activity.duration", "operator": "multiply", "value": 1.2},
        {"target": {"type": "activity", "key": "cut"}, "property": "production.quantity", "operator": "multiply", "value": 2},
        {"target": {"type": "item", "key": "meal"}, "property": "economy.price", "operator": "multiply", "value": 1.4},
    ]})
    engine = GameEngine(store); before = time.time()
    asyncio.run(engine.execute_local_activity("42", "camp", "cut", "timed"))
    with store.connection() as db:
        ready_at = float(db.execute("SELECT ready_at FROM scheduled_actions WHERE discord_id='42' AND action_key='cut'").fetchone()[0])
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42' AND action_key='cut'")
        db.execute("UPDATE players SET money=100 WHERE discord_id='42'")
    assert 11 <= ready_at - before <= 13
    claimed = asyncio.run(engine.execute("42", "camp", "claim_cut", "claim"))
    assert claimed["player"]["inventory"]["wood"] == 2
    bought = asyncio.run(engine.execute_purchase("42", "camp", "purchase", "meal", 1))
    assert bought["purchase"]["total"] == 14 and bought["player"]["money"] == 86
    impacts = WorldCreatorService(store).impacts()["impacts"]
    assert {item["property"] for item in impacts} >= {"activity.duration", "economy.price"}


def test_discord_explorer_renders_position_then_persistent_travel(tmp_path):
    from kingdomCore.discord_bot import WorldExplorerView
    store = playable_store(tmp_path); world = WorldEngine(store); world.place("42", "capital")
    async def scenario():
        view = WorldExplorerView(GameEngine(store), 42)
        assert "Capitale" in view.embed().title
        world.travel("42", "forest")
        travelling = WorldExplorerView(GameEngine(store), 42)
        assert travelling.embed().title == "🚶 EN VOYAGE"
        assert len(travelling.children) == 1 and "Actualiser" in travelling.children[0].label
    asyncio.run(scenario())
