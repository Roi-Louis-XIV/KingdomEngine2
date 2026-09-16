"""Contrats exhaustifs du catalogue V1 + parcours des nouveaux contenus."""

import asyncio
from copy import deepcopy
import json
from pathlib import Path

import pytest

from KingdomData import ContentStore, ValidationError
from KingdomData.festival_v1_completion import ITEM_ALIASES, complete_v1_catalogue
from KingdomData.world_presets import world_preset
from kingdomCore.engine import GameEngine
from kingdomCore.discord_bot import InterfaceView


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def world(tmp_path):
    store = ContentStore(tmp_path / "festival.db")
    store.initialize()
    store.seed(world_preset("royal_festival"))
    engine = GameEngine(store)
    for player in ("42", "43"):
        engine.player(player)
    with store.connection() as db:
        for player in ("42", "43"):
            engine._ensure_player(db, player)
        db.execute("UPDATE players SET money=1000,energy=100")
    return store, engine


def test_all_source_items_recipes_zones_and_unique_identities():
    source = json.loads((Path(__file__).parents[1] / "KingdomData/festival_v1_catalogue.json").read_text(encoding="utf-8"))
    definitions = world_preset("royal_festival")
    indexed = {(d["type"], d["key"]): d["payload"] for d in definitions}
    assert len(indexed) == len(definitions)
    for row in source["items"]:
        assert ("item", ITEM_ALIASES.get(row["key"], row["key"])) in indexed
    for old, canonical in ITEM_ALIASES.items():
        if old != canonical:
            assert ("item", old) not in indexed
    for key, count in [("deep_mine", 3), ("forester_lodge", 6)]:
        building = indexed["building", key]
        expected = source["buildings"]["mine" if key == "deep_mine" else "forest"]["activities"]
        assert len(expected) == count
        assert {a["key"] for a in expected} <= {a["key"] for a in building["modules"]["activities"]}
    for key in ("edgar_tavern", "royal_forge", "deep_mine", "forester_lodge"):
        building = indexed["building", key]
        assert len({a["key"] for a in building["actions"]}) == len(building["actions"])
        for field, identity in [("products", "item_key"), ("recipes", "key"), ("professions", "key"), ("activities", "key"), ("deliveries", "item_key")]:
            rows = building["modules"].get(field, [])
            assert len({row[identity] for row in rows}) == len(rows), (key, field)
        actions = {a["key"] for a in building["actions"]}
        pages = {p["key"] for p in building["interface"]["pages"]}
        for page in building["interface"]["pages"]:
            for component in page["components"]:
                interaction = component.get("interaction", {})
                if interaction.get("type") == "action":
                    assert interaction["action"] in actions
                elif interaction.get("type") == "navigate":
                    assert interaction["page"] in pages
    original = deepcopy(definitions)
    complete_v1_catalogue(definitions)
    assert definitions == original


def test_shared_cooking_claim_is_exclusive_and_persistent(world):
    store, engine = world
    for player in ("42", "43"):
        run(engine.execute(player, "edgar_tavern", "join_innkeeper", f"join-{player}"))
    run(engine.execute("42", "edgar_tavern", "cook_onion_soup", "start"))
    with pytest.raises(ValidationError):
        run(engine.execute("43", "edgar_tavern", "cook_onion_soup", "already-taken"))
    with pytest.raises(ValidationError):
        run(engine.execute("42", "edgar_tavern", "cook_honey_chicken", "already-working"))
    with pytest.raises(ValidationError):
        run(engine.execute("43", "edgar_tavern", "claim_cook_onion_soup", "foreign-claim"))
    with store.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0")
    engine = GameEngine(store)
    result = run(engine.execute("42", "edgar_tavern", "claim_cook_onion_soup", "claim"))
    assert run(engine.execute("42", "edgar_tavern", "claim_cook_onion_soup", "claim")) == result
    assert engine.player("42")["money"] == 1012
    assert not engine.player("42")["inventory"].get("soupe_oignon")
    assert next(p for p in engine.commerce_options("edgar_tavern") if p["item_key"] == "soupe_oignon")["quantity"] == 20
    run(engine.execute("43", "edgar_tavern", "cook_onion_soup", "next-order"))


def test_traditional_shop_consumption_and_purchase_limit(world):
    store, engine = world
    run(engine.execute_purchase("42", "edgar_tavern", "purchase", "beer_86", 2))
    result = run(engine.execute_consumption("42", "edgar_tavern", "drink", "beer_86"))
    assert result["stats"]["alcohol"] == 18
    assert engine.player("42")["inventory"]["beer_86"] == 1
    with pytest.raises(ValidationError):
        run(engine.execute_purchase("42", "edgar_tavern", "too-many", "absinthe", 3))


def test_upgrade_and_hunter_restriction(world):
    store, engine = world
    run(engine.execute("42", "deep_mine", "join_miner", "join"))
    with store.connection() as db:
        for key, quantity in [("iron_ore", 3), ("oak_timber", 1)]:
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42',?,?)", (key, quantity))
    run(engine.execute("42", "royal_forge", "upgrade_iron_pickaxe_2", "upgrade"))
    assert engine.player("42")["money"] == 970
    with pytest.raises(ValidationError):
        run(engine.execute("42", "royal_forge", "upgrade_iron_pickaxe_2", "upgrade-again"))
    run(engine.execute("43", "forester_lodge", "join_forester", "woodcutter"))
    with pytest.raises(ValidationError):
        run(engine.execute("43", "forester_lodge", "hunt_game", "not-hunter"))


def test_legacy_menus_render_and_show_all_products(world):
    store, engine = world
    async def check():
        for key in ("edgar_tavern", "royal_forge", "festival_esplanade"):
            definition = store.get("building", key, published=True)["payload"]["interface"]
            for page in definition["pages"]:
                view = InterfaceView(engine, definition, page_key=page["key"], owner_id=42)
                assert len(view.children) <= 25
                for child in view.children:
                    if hasattr(child, "options"):
                        assert len(child.options) <= 25
    run(check())


def test_bridge_quest_stages_caps_and_restart(world):
    store, engine = world
    with store.connection() as db:
        for key in ("stone_block", "iron_ore", "oak_timber"):
            db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42',?,100)", (key,))
    with pytest.raises(ValidationError):
        run(engine.execute("42", "festival_esplanade", "bridge_framework_oak_timber_10", "too-soon"))
    for i in range(3):
        run(engine.execute("42", "festival_esplanade", "bridge_foundations_stone_block_10", f"stone-{i}"))
    with pytest.raises(ValidationError):
        run(engine.execute("42", "festival_esplanade", "bridge_foundations_stone_block_1", "over-target"))
    run(engine.execute("42", "festival_esplanade", "bridge_foundations_iron_ore_5", "iron"))
    engine = GameEngine(store)
    run(engine.execute("42", "festival_esplanade", "bridge_framework_oak_timber_10", "next-stage"))
    assert engine.player("42")["inventory"]["stone_block"] == 70


def test_all_eight_legacy_recipes_are_present_and_configurable():
    definitions = {(r["type"], r["key"]): r["payload"] for r in world_preset("royal_festival")}
    tavern = definitions["building", "edgar_tavern"]["modules"]["recipes"]
    assert {"cook_onion_soup", "cook_honey_chicken", "cook_boar_pate", "cook_smoked_sausages"} <= {r["key"] for r in tavern}
    forge = definitions["building", "royal_forge"]["modules"]["recipes"]
    assert {"forge_iron_pickaxe_from_ore", "forge_iron_sword_from_ore", "forge_simple_axe_from_ore", "forge_halberd_from_ore"} <= {r["key"] for r in forge}
    for recipe in tavern + forge:
        assert recipe["ingredient_source"] == recipe["output_destination"] == "building_stock"
        for item in [recipe["output_item_key"], *recipe["ingredients"]]:
            assert ("item", item) in definitions
