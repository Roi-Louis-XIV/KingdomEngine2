import asyncio

from KingdomData import ContentStore, ValidationError
from kingdomCore import GameEngine


def test_action_is_atomic_and_idempotent(tmp_path):
    store=ContentStore(tmp_path/"game.db");store.initialize()
    draft=store.save("building","test_mine",{"name":"Mine","actions":[{"key":"mine_ore","name":"Miner","effects":[{"type":"cost","resource":"energy","amount":5},{"type":"reward","resource":"iron_ore","amount":2}]}]})
    store.publish("building","test_mine",draft["version"])
    engine=GameEngine(store)
    first=asyncio.run(engine.execute("42","test_mine","mine_ore","interaction-1"))
    second=asyncio.run(engine.execute("42","test_mine","mine_ore","interaction-1"))
    assert first==second
    assert engine.player("42")["energy"]==95
    assert engine.player("42")["inventory"]=={"iron_ore":2}


def test_failed_action_rolls_back(tmp_path):
    store=ContentStore(tmp_path/"game.db");store.initialize()
    draft=store.save("building","royal_shop",{"name":"Boutique","actions":[{"key":"buy_sword","name":"Acheter","effects":[{"type":"cost","resource":"money","amount":10},{"type":"reward","resource":"sword_item","amount":1}]}]})
    store.publish("building","royal_shop",draft["version"])
    engine=GameEngine(store)
    try: asyncio.run(engine.execute("42","royal_shop","buy_sword","x"))
    except ValidationError: pass
    else: raise AssertionError("L’achat devait échouer")
    assert engine.player("42")["inventory"]=={}


def test_generated_building_action_uses_published_module_parameters(tmp_path):
    store = ContentStore(tmp_path / "generated.db")
    store.initialize()
    modules = {
        "rules": {"experience_per_level": 50},
        "professions": [{"key": "miner", "name": "Mineur", "required_item": "simple_pickaxe", "grant_required_item": True}],
        "activities": [{
            "key": "royal_quarry", "name": "Carriere", "profession": "miner", "tool": "simple_pickaxe",
            "required_level": 1, "energy_cost": 7, "durability_cost": 2, "experience": 20,
            "outcomes": [{"key": "stone", "weight": 1, "rewards": {"raw_stone": [3, 3]}}],
        }],
        "products": [], "recipes": [], "deliveries": [],
        "repairs": {"pickaxe_price_per_point": 2, "durability": {"simple_pickaxe": 80}},
        "upgrades": [{"tool_key": "simple_pickaxe", "from_level": 1, "to_level": 2, "name": "Pioche royale", "price": 10, "max_durability": 120, "loot_bonus": 2, "ingredients": {"iron_ore": 2}}],
    }
    draft = store.save("building", "royal_mine", {"name": "Mine", "action_mode": "generated", "modules": modules, "actions": []})
    store.publish("building", "royal_mine", draft["version"])
    engine = GameEngine(store)

    asyncio.run(engine.execute("42", "royal_mine", "join_miner", "join-1"))
    result = asyncio.run(engine.execute("42", "royal_mine", "royal_quarry", "mine-1"))

    assert result["player"]["energy"] == 93
    assert result["player"]["inventory"]["raw_stone"] == 3
    assert result["player"]["professions"]["miner"] == {"level": 1, "experience": 20}
    assert result["player"]["tools"]["simple_pickaxe"]["durability"] == 78

    with store.connection() as db:
        db.execute("UPDATE players SET money=100 WHERE discord_id='42'")
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42','iron_ore',2)")
    repaired = asyncio.run(engine.execute("42", "royal_mine", "repair_simple_pickaxe", "repair-1"))
    upgraded = asyncio.run(engine.execute("42", "royal_mine", "upgrade_simple_pickaxe_2", "upgrade-1"))
    improved = asyncio.run(engine.execute("42", "royal_mine", "royal_quarry", "mine-2"))

    assert repaired["player"]["money"] == 96
    assert upgraded["player"]["tools"]["simple_pickaxe"]["max_durability"] == 120
    assert upgraded["player"]["tools"]["simple_pickaxe"]["loot_bonus"] == 2
    assert improved["player"]["inventory"]["raw_stone"] == 8


def test_timed_module_defers_rewards_until_claim(tmp_path):
    store = ContentStore(tmp_path / "timed.db")
    store.initialize()
    modules = {
        "professions": [], "products": [], "recipes": [], "deliveries": [], "upgrades": [],
        "activities": [{
            "key": "long_harvest", "name": "Longue recolte", "duration_seconds": 60, "energy_cost": 2,
            "outcomes": [{"key": "wood", "weight": 1, "rewards": {"wood": [1, 1]}}],
        }],
    }
    draft = store.save("building", "timed_forest", {"name": "Foret", "action_mode": "generated", "modules": modules, "actions": []})
    store.publish("building", "timed_forest", draft["version"])
    engine = GameEngine(store)

    started = asyncio.run(engine.execute("7", "timed_forest", "long_harvest", "start-timed"))
    assert started["player"]["energy"] == 98
    assert started["player"]["inventory"] == {}
    with store.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0")
    claimed = asyncio.run(engine.execute("7", "timed_forest", "claim_long_harvest", "claim-timed"))
    assert claimed["player"]["inventory"] == {"wood": 1}


def test_pending_actions_can_drive_a_private_activity_interface(tmp_path):
    store = ContentStore(tmp_path / "pending-interface.db")
    store.initialize()
    modules = {
        "professions": [], "products": [], "recipes": [], "deliveries": [], "upgrades": [],
        "activities": [{
            "key": "forest_trip", "name": "Expédition", "duration_seconds": 60,
            "outcomes": [{"key": "wood", "weight": 1, "rewards": {"wood": [1, 1]}}],
        }],
    }
    draft = store.save("building", "private_forest", {"name": "Forêt", "action_mode": "generated", "modules": modules, "actions": []})
    store.publish("building", "private_forest", draft["version"])
    engine = GameEngine(store)

    asyncio.run(engine.execute("8", "private_forest", "forest_trip", "trip-start"))

    assert [item["action"] for item in engine.pending_actions("8", "private_forest")] == ["forest_trip"]

