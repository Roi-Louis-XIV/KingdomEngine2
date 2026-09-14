import asyncio

import pytest

from KingdomData import ContentStore
from KingdomData.world_presets import world_preset
from kingdomCore.engine import GameEngine
from kingdomCore.discord_bot import InterfaceView


@pytest.fixture
def shop(tmp_path):
    store = ContentStore(tmp_path / "world.db")
    store.initialize()
    store.seed(world_preset("royal_festival"))
    engine = GameEngine(store)
    engine.player("42")
    with store.connection() as db:
        engine._ensure_player(db, "42")
        db.execute("UPDATE players SET money=500,energy=30 WHERE discord_id='42'")
    return store, engine


def run(coro):
    return asyncio.run(coro)


def test_tavern_buy_consume_and_stock_recipe(shop):
    store, engine = shop
    run(engine.execute_purchase("42", "edgar_tavern", "buy-beer", "royal_ale", 1))
    consumed = run(engine.execute_consumption("42", "edgar_tavern", "drink", "royal_ale"))
    assert consumed["player"]["energy"] == 42
    run(engine.execute_purchase("42", "edgar_tavern", "buy-pie", "meat_pie", 1))
    assert run(engine.execute_consumption("42", "edgar_tavern", "eat", "meat_pie"))["player"]["energy"] == 77
    run(engine.execute("42", "edgar_tavern", "join_innkeeper", "join"))
    with store.connection() as db:
        for key, amount in {"flour_sack": 2, "game_meat": 2, "egg": 1}.items():
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,?)", ("42", key, amount))
    run(engine.execute_delivery("42", "edgar_tavern", "delivery", {"flour_sack": 2, "game_meat": 2, "egg": 1}))
    run(engine.execute("42", "edgar_tavern", "bake_meat_pie", "cook"))
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='edgar_tavern' AND item_key='egg'").fetchone()[0] == 0
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42'")
    run(engine.execute("42", "edgar_tavern", "claim_bake_meat_pie", "claim"))
    assert engine.player("42")["inventory"].get("meat_pie", 0) == 0
    assert next(p for p in engine.commerce_options("edgar_tavern") if p["item_key"] == "meat_pie")["quantity"] == 5


def test_forge_smelt_craft_purchase_repair(shop):
    store, engine = shop
    run(engine.execute("42", "royal_forge", "join_blacksmith", "join"))
    with store.connection() as db:
        for key, amount in {"iron_ore": 4, "festival_coal": 2, "oak_timber": 1}.items():
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES(?,?,?)", ("42", key, amount))
    run(engine.execute_delivery("42", "royal_forge", "deliver", {"iron_ore": 4, "festival_coal": 2, "oak_timber": 1}))
    for i in range(2):
        run(engine.execute("42", "royal_forge", "smelt_festival_iron", f"smelt{i}"))
        with store.connection() as db:
            db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42'")
        run(engine.execute("42", "royal_forge", "claim_smelt_festival_iron", f"claim{i}"))
    run(engine.execute("42", "royal_forge", "forge_pickaxe", "craft"))
    with store.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42'")
    run(engine.execute("42", "royal_forge", "claim_forge_pickaxe", "claim-tool"))
    run(engine.execute_purchase("42", "royal_forge", "purchase", "iron_pickaxe", 1))
    with store.connection() as db:
        db.execute("UPDATE player_tools SET durability=42 WHERE discord_id='42' AND tool_key='iron_pickaxe'")
    before = engine.player("42")["money"]
    run(engine.execute("42", "royal_forge", "repair_iron_pickaxe", "repair"))
    assert engine.player("42")["money"] == before - 58
    with store.connection() as db:
        assert db.execute("SELECT durability FROM player_tools WHERE discord_id='42' AND tool_key='iron_pickaxe'").fetchone()[0] == 100


def test_discord_category_selectors_and_profession_visibility(shop):
    store, engine = shop
    from KingdomData.interfaces import migrate_reference_labels
    migrate_reference_labels(store)

    async def check():
        definition = store.get("building", "edgar_tavern", published=True)["payload"]["interface"]
        view = InterfaceView(engine, definition, page_key="drink_beer", owner_id=42)
        options = [option.value for child in view.children if hasattr(child, "options") for option in child.options]
        assert set(options) == {"royal_ale", "brown_ale", "strong_ale"}
        home = InterfaceView(engine, definition, page_key="home", owner_id=42)
        assert not any(child.label == "👨‍🍳 Cuisiner" for child in home.children)
        await engine.execute("42", "edgar_tavern", "join_innkeeper", "join")
        home = InterfaceView(engine, definition, page_key="home", owner_id=42)
        assert any(child.label == "👨‍🍳 Cuisiner" for child in home.children)
        forge = store.get("building", "royal_forge", published=True)["payload"]["interface"]
        repairs = InterfaceView(engine, forge, page_key="repairs", owner_id=42)
        assert not any(child.custom_id == "kei:act_repair_iron_pickaxe" for child in repairs.children)
        await engine.execute_purchase("42", "royal_forge", "tool", "iron_pickaxe", 1)
        with store.connection() as db:
            db.execute("UPDATE player_tools SET durability=42 WHERE discord_id='42' AND tool_key='iron_pickaxe'")
        repairs = InterfaceView(engine, forge, page_key="repairs", owner_id=42)
        assert any("42/100" in child.label for child in repairs.children)
        with store.connection() as db:
            db.execute("INSERT INTO building_stock(building_key,item_key,quantity) VALUES('royal_forge','simple_axe',0)")
        shop_view = InterfaceView(engine, forge, page_key="shop_harvest_tools", owner_id=42)
        assert [option.value for child in shop_view.children if hasattr(child, "options") for option in child.options] == ["iron_pickaxe"]

    run(check())


def test_existing_revision_three_catalog_is_updated_once(tmp_path):
    import json
    import sqlite3
    from KingdomData.official_content import OfficialContentStore
    from KingdomWeb.accounts import SCHEMA_COMPTES

    path = tmp_path / "platform.db"
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA_COMPTES)
    official = OfficialContentStore(path)
    official.migrate_legacy_presets()
    with official.connection() as db:
        row = db.execute("SELECT e.pack_id,e.payload_json FROM official_content_entities e JOIN official_content_packs p ON p.id=e.pack_id WHERE p.pack_key='royal_festival' AND e.entity_type='server_settings'").fetchone()
        settings = json.loads(row[1])
        settings.pop("workshop_content_revision")
        db.execute("UPDATE official_content_entities SET payload_json=? WHERE pack_id=? AND entity_type='server_settings'", (json.dumps(settings), row[0]))
    official.migrate_legacy_presets()
    updated = official.get("royal_festival", published_only=True)
    assert next(e for e in updated["entities"] if e["type"] == "server_settings")["payload"]["workshop_content_revision"] == 1
    official.migrate_legacy_presets()
    assert official.get("royal_festival", published_only=True) == updated
