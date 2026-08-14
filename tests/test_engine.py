import asyncio

from KingdomData import ContentStore, ValidationError
from kingdomCore import GameEngine
from kingdomEvent import EventBus


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


class OutcomeRng:
    def __init__(self, outcome_key): self.outcome_key = outcome_key
    def choices(self, values, weights, k):
        return [next((value for value in values if value.get("key") == self.outcome_key), values[0])]
    def randint(self, minimum, maximum): return maximum


def test_generic_multi_profession_activity_executes_weighted_multi_effect_result(tmp_path):
    store = ContentStore(tmp_path / "generic-forest.db")
    store.initialize()
    bus = EventBus()
    events = []
    async def capture(event): events.append(event)
    bus.subscribe("*", capture)
    modules = {
        "rules": {"experience_per_level": 100},
        "professions": [
            {"key": "lumber_job", "name": "Coupeur", "required_item": "bronze_axe"},
            {"key": "tracking_job", "name": "Pisteur", "required_item": "short_bow"},
        ],
        "activities": [{
            "key": "old_grove", "name": "Bosquet ancien", "profession": "lumber_job",
            "tool": "bronze_axe", "tool_max_durability": 20, "required_level": 1,
            "duration_seconds": 10, "energy_cost": 7, "durability_cost": 2,
            "activity_limit": {"scope": "building", "max_active": 1, "category": "gathering"},
            "outcomes": [
                {"key": "ordinary", "weight": 80, "effects": [{"type": "reward", "resource": "wood", "amount": [1, 2]}]},
                {"key": "rare", "weight": 20, "effects": [
                    {"type": "message", "text": "Une essence rare apparaît."},
                    {"type": "reward", "resource": "wood", "amount": [2, 3]},
                    {"type": "reward", "resource": "precious_wood", "amount": 1},
                    {"type": "profession", "profession": "lumber_job", "experience": 35, "experience_per_level": 100},
                    {"type": "state", "key": "rare_finds", "operation": "increment", "value": 1},
                    {"type": "emit", "event": "activity.rare_result", "payload": {"rarity": "rare"}},
                ]},
            ],
        }],
        "products": [], "recipes": [], "deliveries": [], "upgrades": [],
    }
    from import_v1 import actions_from_modules
    actions = actions_from_modules("wildlands", modules)
    assert {action["key"] for action in actions} >= {"join_lumber_job", "join_tracking_job", "old_grove", "claim_old_grove"}
    random_effect = next(effect for action in actions if action["key"] == "old_grove" for effect in action["effects"] if effect["type"] == "schedule")["effects"][0]
    assert random_effect["type"] == "random_result"
    assert len(random_effect["outcomes"]) == 2
    assert len(random_effect["outcomes"][1]["effects"]) == 6

    draft = store.save("building", "wildlands", {"name": "Terres sauvages", "action_mode": "generated", "modules": modules, "actions": []})
    store.publish("building", "wildlands", draft["version"])
    engine = GameEngine(store, bus=bus, rng=OutcomeRng("rare"))
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,updated_at) VALUES('42','now')")
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42','bronze_axe',1)")

    asyncio.run(engine.execute("42", "wildlands", "join_lumber_job", "join-lumber"))
    try:
        asyncio.run(engine.execute("42", "wildlands", "join_tracking_job", "join-tracker"))
    except ValidationError as error:
        assert "déjà" in str(error)
    else:
        raise AssertionError("Un second métier actif aurait dû être refusé")

    started = asyncio.run(engine.execute("42", "wildlands", "old_grove", "start-grove"))
    assert started["player"]["energy"] == 93
    assert started["player"]["tools"]["bronze_axe"]["durability"] == 18
    with store.connection() as db: db.execute("UPDATE scheduled_actions SET ready_at=0")
    claimed = asyncio.run(engine.execute("42", "wildlands", "claim_old_grove", "claim-grove"))
    assert claimed["player"]["inventory"] == {"bronze_axe": 1, "precious_wood": 1, "wood": 3}
    assert claimed["player"]["professions"]["lumber_job"]["experience"] == 35
    assert claimed["player"]["state"]["rare_finds"] == 1
    assert "Une essence rare apparaît." in claimed["messages"]
    assert any(event.type == "activity.rare_result" for event in events)
    with store.connection() as db:
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('42','short_bow',1)")
    asyncio.run(engine.execute("42", "wildlands", "leave_lumber_job", "leave-lumber"))
    changed_job = asyncio.run(engine.execute("42", "wildlands", "join_tracking_job", "join-tracker-after-leave"))
    assert set(changed_job["player"]["professions"]) == {"tracking_job"}
    with store.connection() as db:
        old_job = db.execute("SELECT experience,active FROM player_professions WHERE discord_id='42' AND profession_key='lumber_job'").fetchone()
    assert tuple(old_job) == (35, 0)


def test_activity_access_checks_profession_level_and_required_tool(tmp_path):
    store = ContentStore(tmp_path / "activity-access.db"); store.initialize()
    modules = {
        "rules": {"experience_per_level": 100},
        "professions": [{"key": "scout_job", "name": "Éclaireur", "required_item": "field_bow"}],
        "activities": [{"key": "deep_zone", "name": "Zone profonde", "profession": "scout_job", "tool": "field_bow", "required_level": 2, "outcomes": [{"key": "seen", "weight": 1, "effects": [{"type": "reward", "resource": "herbs", "amount": 1}]}]}],
        "products": [], "recipes": [], "deliveries": [], "upgrades": [],
    }
    draft = store.save("building", "wild_area", {"name": "Zone sauvage", "action_mode": "generated", "modules": modules, "actions": []}); store.publish("building", "wild_area", draft["version"])
    engine = GameEngine(store)
    try: asyncio.run(engine.execute("7", "wild_area", "join_scout_job", "join-no-tool"))
    except ValidationError as error: assert "field_bow" in str(error)
    else: raise AssertionError("Le prérequis d'outil aurait dû bloquer le recrutement")
    with store.connection() as db:
        db.execute("INSERT OR IGNORE INTO players(discord_id,updated_at) VALUES('7','now')")
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('7','field_bow',1)")
    asyncio.run(engine.execute("7", "wild_area", "join_scout_job", "join-with-tool"))
    try: asyncio.run(engine.execute("7", "wild_area", "deep_zone", "too-low"))
    except ValidationError as error: assert "Niveau insuffisant" in str(error)
    else: raise AssertionError("Le niveau du métier aurait dû bloquer la zone")

