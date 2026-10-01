import asyncio

import pytest

from KingdomData import ContentStore, NotFoundError, ValidationError
from kingdomCore import GameEngine


def setup_delivery(tmp_path, *, price=2, maximum=None):
    store = ContentStore(tmp_path / "delivery-engine.db"); store.initialize()
    for key, kind in (("wood", "item"), ("fine_wood", "item")):
        draft = store.save(kind, key, {"name": "Bois" if key == "wood" else "Bois fin"}); store.publish(kind, key, draft["version"])
    destination = store.save("building", "warehouse", {"name": "Entrepôt", "actions": []}); store.publish("building", "warehouse", destination["version"])
    rules = [{"item_key": "wood", "source": "player_inventory", "destination": "building_stock", "target_building_key": "warehouse", "minimum_quantity": 1, "maximum_quantity": maximum, "unit_price": price, "payment_resource": "money"}, {"item_key": "fine_wood", "destination": "building_stock", "target_building_key": "warehouse", "minimum_quantity": 1, "unit_price": 7, "payment_resource": "money"}]
    source = store.save("building", "depot", {"name": "Dépôt", "modules": {"professions": [], "activities": [], "products": [], "recipes": [], "deliveries": rules, "upgrades": []}, "actions": []}); store.publish("building", "depot", source["version"])
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,updated_at) VALUES('1','now')")
        db.execute("INSERT INTO inventory VALUES('1','wood',10)"); db.execute("INSERT INTO inventory VALUES('1','fine_wood',3)")
    return store, GameEngine(store)


def test_selected_quantity_payment_log_and_idempotence(tmp_path):
    store, engine = setup_delivery(tmp_path)
    result = asyncio.run(engine.execute_delivery("1", "depot", "delivery-1", {"wood": 6}))
    repeated = asyncio.run(engine.execute_delivery("1", "depot", "delivery-1", {"wood": 6}))
    assert result == repeated and result["payments"] == {"money": 12}
    assert result["player"]["inventory"]["wood"] == 4
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='warehouse' AND item_key='wood'").fetchone()[0] == 6
        assert tuple(db.execute("SELECT quantity,unit_price,total_payment FROM delivery_log").fetchone()) == (6, 2, 12)


def test_two_competing_deliveries_cannot_spend_the_same_inventory(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    store, engine = setup_delivery(tmp_path)
    def attempt(key):
        try: return asyncio.run(engine.execute_delivery("1", "depot", key, {"wood": 8}))
        except ValidationError: return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, ("race-a", "race-b")))
    assert sum(result is not None for result in results) == 1
    assert engine.player("1")["inventory"]["wood"] == 2


def test_dynamic_options_and_deliver_all_multiple_resources(tmp_path):
    _, engine = setup_delivery(tmp_path)
    assert {item["resource"] for item in engine.delivery_options("1", "depot")} == {"wood", "fine_wood"}
    result = asyncio.run(engine.execute_delivery("1", "depot", "all-1", {item["resource"]: item["quantity"] for item in engine.delivery_options("1", "depot")}))
    assert result["payments"] == {"money": 41} and result["player"]["inventory"] == {}


@pytest.mark.parametrize("quantities", [{"wood": 0}, {"wood": 11}, {"stone": 1}])
def test_invalid_delivery_rolls_back_completely(tmp_path, quantities):
    store, engine = setup_delivery(tmp_path)
    with pytest.raises(ValidationError): asyncio.run(engine.execute_delivery("1", "depot", f"bad-{quantities}", quantities))
    assert engine.player("1")["inventory"] == {"wood": 10, "fine_wood": 3}
    with store.connection() as db: assert db.execute("SELECT COUNT(*) FROM delivery_log").fetchone()[0] == 0


def test_maximum_zero_payment_and_missing_destination(tmp_path):
    store, engine = setup_delivery(tmp_path, price=0, maximum=4)
    with pytest.raises(ValidationError): asyncio.run(engine.execute_delivery("1", "depot", "too-many", {"wood": 5}))
    result = asyncio.run(engine.execute_delivery("1", "depot", "donation", {"wood": 4}))
    assert result["payments"] == {"money": 0}
    with store.connection() as db: db.execute("UPDATE content SET payload_json=REPLACE(payload_json,'warehouse','missing_building') WHERE entity_type='building' AND entity_key='depot'")
    with pytest.raises(NotFoundError): asyncio.run(engine.execute_delivery("1", "depot", "missing", {"fine_wood": 1}))
