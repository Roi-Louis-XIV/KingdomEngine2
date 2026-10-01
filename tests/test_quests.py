import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor

import discord
import pytest

from KingdomData import ContentStore, ValidationError
from kingdomCore.discord_bot import QuestBoardView
from kingdomCore.engine import GameEngine
from kingdomCore.world import WorldEngine


def publish(store, kind, key, payload):
    draft = store.save(kind, key, payload)
    return store.publish(kind, key, draft["version"])


def quest(store, key, objectives, **extra):
    return publish(store, "quest", key, {
        "name": key.replace("_", " ").title(), "description": "Une tâche personnelle.",
        "reward_xp": 50, "objectives": objectives, **extra,
    })


def test_quest_definition_requires_observable_positive_objectives(tmp_path):
    store = ContentStore(tmp_path / "validation.db")
    store.initialize()
    with pytest.raises(ValidationError):
        quest(store, "empty_quest", [])
    with pytest.raises(ValidationError):
        quest(store, "bad_delivery", [{"key": "bring_wood", "type": "delivery", "item_key": "wood", "destination_building_key": "workshop", "quantity": 0}])
    with pytest.raises(ValidationError):
        quest(store, "bad_window", [{"key": "visit_hall", "type": "visit", "building_key": "town_hall"}], available_from_minute=120, available_until_minute=90)
    with pytest.raises(ValidationError):
        quest(store, "bad_availability", [{"key": "visit_hall", "type": "visit", "building_key": "town_hall"}],
              available_conditions={"type": "unknown_condition"})


def test_personal_quest_action_delivery_and_explicit_single_claim_survive_restart(tmp_path):
    store = ContentStore(tmp_path / "quest.db")
    store.initialize()
    publish(store, "item", "raw_stone", {"name": "Pierre"})
    publish(store, "building", "quarry", {"name": "Carrière", "actions": [
        {"key": "extract_stone", "name": "Extraire", "effects": [{"type": "reward", "resource": "raw_stone", "amount": 4}]},
    ]})
    publish(store, "building", "church", {"name": "Église", "modules": {"deliveries": [
        {"item_key": "raw_stone", "target_building_key": "church", "minimum_quantity": 1},
    ]}, "actions": []})
    quest(store, "stone_report", [
        {"key": "extract", "type": "action", "building_key": "quarry", "action_key": "extract_stone"},
        {"key": "deliver", "type": "delivery", "item_key": "raw_stone", "destination_building_key": "church", "quantity": 4},
    ])
    engine = GameEngine(store)
    accepted = engine.accept_quest("42", "stone_report", "accept-1")
    assert accepted == engine.accept_quest("42", "stone_report", "accept-1")
    with pytest.raises(ValidationError):
        engine.accept_quest("42", "stone_report", "accept-2")

    first = asyncio.run(engine.execute("42", "quarry", "extract_stone", "extract-1"))
    assert first["quest"]["objectives"][0]["progress"] == 1
    assert first == asyncio.run(engine.execute("42", "quarry", "extract_stone", "extract-1"))
    assert engine.quest_board("42")["active"]["status"] == "accepted"
    delivery = asyncio.run(engine.execute_delivery("42", "church", "delivery-1", {"raw_stone": 4}))
    assert delivery["quest"]["status"] == "ready"
    assert delivery == asyncio.run(engine.execute_delivery("42", "church", "delivery-1", {"raw_stone": 4}))

    restarted = GameEngine(ContentStore(store.path))
    assert restarted.quest_board("42")["active"]["status"] == "ready"
    assert restarted.quest_board("42")["offers"] == []
    assert restarted.player("42")["quest_experience"] == 0
    claim = restarted.claim_quest("42", "stone_report", "claim-1")
    assert claim == restarted.claim_quest("42", "stone_report", "claim-1")
    assert restarted.player("42")["quest_experience"] == 50
    assert restarted.quest_board("42")["active"] is None
    assert restarted.quest_board("42")["offers"] == []
    with pytest.raises(ValidationError):
        restarted.claim_quest("42", "stone_report", "claim-2")
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='church' AND item_key='raw_stone'").fetchone()[0] == 4
        assert db.execute("SELECT COUNT(*) FROM delivery_log").fetchone()[0] == 1


def test_action_deposit_counts_only_items_actually_consumed(tmp_path):
    store = ContentStore(tmp_path / "contribution.db")
    store.initialize()
    publish(store, "building", "worksite", {"name": "Chantier", "actions": [
        {"key": "bring_wood", "name": "Déposer", "effects": [
            {"type": "cost", "resource": "wood", "amount": 3},
            {"type": "contribution", "objective": "worksite_materials", "resource": "wood", "amount": 5},
        ]},
    ]})
    quest(store, "bring_timber", [{"key": "wood", "type": "delivery", "item_key": "wood", "destination_building_key": "worksite", "quantity": 3}])
    engine = GameEngine(store)
    engine.accept_quest("7", "bring_timber", "accept")
    with store.connection() as db:
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('7','wood',4)")
    first = asyncio.run(engine.execute("7", "worksite", "bring_wood", "deposit"))
    assert first["quest"]["status"] == "ready"
    assert first["quest"]["objectives"][0]["progress"] == 3
    assert asyncio.run(engine.execute("7", "worksite", "bring_wood", "deposit")) == first
    assert engine.player("7")["inventory"]["wood"] == 1


def test_stock_reward_delivery_uses_target_building_without_collective_counter(tmp_path):
    store = ContentStore(tmp_path / "stock-delivery.db")
    store.initialize()
    publish(store, "building", "forge", {"name": "Forge", "actions": [
        {"key": "deliver_ore", "name": "Livrer le minerai", "effects": [
            {"type": "cost", "resource": "iron_ore", "amount": 4},
            {"type": "stock_reward", "item": "iron_ore", "building": "forge", "amount": 4},
        ]},
    ]})
    quest(store, "ore_delivery", [{"key": "ore", "type": "delivery", "item_key": "iron_ore",
                                  "destination_building_key": "forge", "quantity": 4}])
    engine = GameEngine(store)
    engine.accept_quest("4", "ore_delivery", "accept")
    with store.connection() as db:
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('4','iron_ore',4)")
    result = asyncio.run(engine.execute("4", "forge", "deliver_ore", "deliver"))
    assert result["quest"]["status"] == "ready"
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='forge' AND item_key='iron_ore'").fetchone()[0] == 4
        assert db.execute("SELECT COUNT(*) FROM collective_contributions").fetchone()[0] == 0


def test_timed_action_progresses_when_output_is_claimed(tmp_path):
    store = ContentStore(tmp_path / "timed.db")
    store.initialize()
    publish(store, "building", "grove", {"name": "Bosquet", "actions": [
        {"key": "gather", "name": "Récolter", "effects": [{"type": "schedule", "action": "gather", "duration_seconds": 60, "effects": [{"type": "reward", "resource": "wood", "amount": 1}]}]},
        {"key": "claim_gather", "name": "Récupérer", "effects": [{"type": "claim_scheduled", "action": "gather"}]},
    ]})
    quest(store, "gather_wood", [{"key": "gather", "type": "action", "building_key": "grove", "action_key": "gather"}])
    engine = GameEngine(store)
    engine.accept_quest("1", "gather_wood", "accept")
    asyncio.run(engine.execute("1", "grove", "gather", "start"))
    assert engine.quest_board("1")["active"]["objectives"][0]["progress"] == 0
    with store.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0")
    asyncio.run(engine.execute("1", "grove", "claim_gather", "finish"))
    assert engine.quest_board("1")["active"]["status"] == "ready"


def test_consumption_progresses_only_after_item_is_spent(tmp_path):
    store = ContentStore(tmp_path / "meal.db")
    store.initialize()
    publish(store, "building", "tavern", {"name": "Taverne", "actions": []})
    publish(store, "item", "worker_meal", {"name": "Repas", "consumable": True,
                                            "consumption": {"effects": [{"type": "reward", "resource": "energy", "amount": 5}]}})
    quest(store, "eat_meal", [{"key": "eat", "type": "action", "building_key": "tavern", "action_key": "consume_worker_meal"}])
    engine = GameEngine(store)
    engine.accept_quest("11", "eat_meal", "accept")
    with store.connection() as db:
        db.execute("INSERT INTO inventory(discord_id,item_key,quantity) VALUES('11','worker_meal',1)")
    consumed = asyncio.run(engine.execute_consumption("11", "tavern", "eat", "worker_meal"))
    assert consumed["quest"]["status"] == "ready"
    assert asyncio.run(engine.execute_consumption("11", "tavern", "eat", "worker_meal")) == consumed
    assert engine.player("11")["inventory"] == {}


def test_visit_objectives_follow_world_entry_and_time_windows(tmp_path):
    store = ContentStore(tmp_path / "visits.db")
    store.initialize()
    publish(store, "location", "village_square", {"name": "Place"})
    publish(store, "building", "town_hall", {"name": "Hôtel de ville", "location_key": "village_square", "actions": []})
    quest(store, "tour", [
        {"key": "square", "type": "visit", "location_key": "village_square"},
        {"key": "hall", "type": "visit", "building_key": "town_hall"},
    ], available_from_minute=90, available_until_minute=120)
    engine = GameEngine(store)
    with store.connection() as db:
        db.execute("INSERT INTO world_runtime(runtime_key,value_json,updated_at) VALUES('live_ops_scenario',?,'now')",
                   (json.dumps({"started_at": time.time() - 89 * 60}),))
    assert engine.quest_board("5")["offers"] == []
    with store.connection() as db:
        db.execute("UPDATE world_runtime SET value_json=? WHERE runtime_key='live_ops_scenario'",
                   (json.dumps({"started_at": time.time() - 91 * 60}),))
    assert [offer["key"] for offer in engine.quest_board("5")["offers"]] == ["tour"]
    engine.accept_quest("5", "tour", "accept")
    WorldEngine(store).enter_building("5", "town_hall")
    assert engine.quest_board("5")["active"]["status"] == "ready"
    with store.connection() as db:
        db.execute("UPDATE world_runtime SET value_json=? WHERE runtime_key='live_ops_scenario'",
                   (json.dumps({"started_at": time.time() - 121 * 60}),))
    assert engine.quest_board("5")["active"]["status"] == "ready"
    assert engine.quest_board("6")["offers"] == []


def test_scenario_elapsed_condition_and_abandon_confirmation(tmp_path):
    store = ContentStore(tmp_path / "conditions.db")
    store.initialize()
    publish(store, "building", "workshop", {"name": "Atelier", "actions": [
        {"key": "repair", "name": "Réparer", "conditions": {"type": "scenario_elapsed_minutes", "operator": ">=", "value": 105}, "effects": []},
    ]})
    quest(store, "repair_task", [{"key": "repair", "type": "action", "building_key": "workshop", "action_key": "repair"}])
    engine = GameEngine(store)
    assert not engine.condition_met("1", "workshop", "repair", {"type": "scenario_elapsed_minutes", "operator": "<=", "value": 105})
    with store.connection() as db:
        db.execute("INSERT INTO world_runtime(runtime_key,value_json,updated_at) VALUES('live_ops_scenario',?,'now')",
                   (json.dumps({"started_at": time.time() - 100 * 60}),))
    assert engine.condition_met("1", "workshop", "repair", {"type": "scenario_elapsed_minutes", "operator": "<=", "value": 105})
    assert not engine.condition_met("1", "workshop", "repair", {"type": "scenario_elapsed_minutes", "operator": ">=", "value": 105})
    engine.accept_quest("1", "repair_task", "accept")
    with pytest.raises(ValidationError):
        engine.abandon_quest("1", "repair_task", "abandon")
    assert engine.abandon_quest("1", "repair_task", "abandon", confirmed=True)["reward_xp"] == 0
    assert engine.player("1")["quest_experience"] == 0
    assert engine.quest_board("1")["active"] is None
    assert len(engine.quest_board("1")["offers"]) == 1


def test_available_conditions_filter_worn_tool_and_keep_accepted_quest(tmp_path):
    store = ContentStore(tmp_path / "worn-tool.db")
    store.initialize()
    quest(store, "repair_tool", [{"key": "repair", "type": "action", "building_key": "forge", "action_key": "repair_pickaxe"}],
          available_conditions={"all": [
              {"type": "tool_present", "tool": "iron_pickaxe"},
              {"type": "tool_durability", "tool": "iron_pickaxe", "operator": "<", "value": 80},
          ]})
    engine = GameEngine(store)
    assert engine.quest_board("1")["offers"] == []
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,updated_at) VALUES('1','now')")
        db.execute("INSERT INTO player_tools(discord_id,tool_key,durability,max_durability) VALUES('1','iron_pickaxe',80,80)")
    assert engine.quest_board("1")["offers"] == []
    with store.connection() as db:
        db.execute("UPDATE player_tools SET durability=30 WHERE discord_id='1' AND tool_key='iron_pickaxe'")
    assert [offer["key"] for offer in engine.quest_board("1")["offers"]] == ["repair_tool"]
    engine.accept_quest("1", "repair_tool", "accept-worn")
    with store.connection() as db:
        db.execute("UPDATE player_tools SET durability=80 WHERE discord_id='1' AND tool_key='iron_pickaxe'")
    assert engine.quest_board("1")["active"]["key"] == "repair_tool"
    assert engine.quest_board("1")["offers"] == []


def test_available_conditions_recheck_collective_progress_at_acceptance(tmp_path):
    store = ContentStore(tmp_path / "collective-availability.db")
    store.initialize()
    quest(store, "repair_mine", [{"key": "assist", "type": "action", "building_key": "mine", "action_key": "assist_repair"}],
          available_conditions={"type": "collective_progress", "objective": "mine_repair",
                                "building": "mine", "resource": "repair", "operator": "<", "value": 1})
    engine = GameEngine(store)
    assert [offer["key"] for offer in engine.quest_board("1")["offers"]] == ["repair_mine"]
    engine.accept_quest("1", "repair_mine", "accept-before-repair")
    with store.connection() as db:
        db.execute("INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,created_at) VALUES('mine_repair','1','mine','repair',1,'now')")
    assert engine.quest_board("1")["active"]["key"] == "repair_mine"
    assert engine.quest_board("2")["offers"] == []
    with pytest.raises(ValidationError, match="pas disponible"):
        engine.accept_quest("2", "repair_mine", "late-accept")


def test_concurrent_accept_keeps_one_personal_slot(tmp_path):
    store = ContentStore(tmp_path / "concurrent.db")
    store.initialize()
    for key in ("first_quest", "second_quest"):
        quest(store, key, [{"key": "visit_hall", "type": "visit", "building_key": "town_hall"}])

    def accept(args):
        key, interaction = args
        try:
            return GameEngine(ContentStore(store.path)).accept_quest("8", key, interaction)["quest"]["key"]
        except ValidationError:
            return "blocked"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, [("first_quest", "first"), ("second_quest", "second")]))
    assert results.count("blocked") == 1
    assert len([result for result in results if result != "blocked"]) == 1
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM player_quests WHERE discord_id='8' AND status IN ('accepted','ready')").fetchone()[0] == 1


def test_old_visit_interaction_cannot_complete_a_new_quest_run(tmp_path):
    store = ContentStore(tmp_path / "visit-replay.db")
    store.initialize()
    quest(store, "repeat_visit", [{"key": "hall", "type": "visit", "building_key": "town_hall"}], repeatable=True)
    engine = GameEngine(store)
    engine.accept_quest("9", "repeat_visit", "accept-first")
    engine.record_quest_visit("9", "visit-first", building_key="town_hall")
    engine.claim_quest("9", "repeat_visit", "claim-first")
    engine.accept_quest("9", "repeat_visit", "accept-second")
    engine.record_quest_visit("9", "visit-first", building_key="town_hall")
    assert engine.quest_board("9")["active"]["status"] == "accepted"
    engine.record_quest_visit("9", "visit-second", building_key="town_hall")
    assert engine.quest_board("9")["active"]["status"] == "ready"


def test_discord_board_exposes_offer_and_private_claim(tmp_path):
    store = ContentStore(tmp_path / "board.db")
    store.initialize()
    quest(store, "look_around", [{"key": "hall", "type": "visit", "building_key": "town_hall"}])
    engine = GameEngine(store)
    view = QuestBoardView(engine, 42, "town_hall")
    assert any(isinstance(item, discord.ui.Select) for item in view.children)
    engine.accept_quest("42", "look_around", "accept")
    engine.record_quest_visit("42", "visit", building_key="town_hall")
    ready_view = QuestBoardView(engine, 42, "town_hall")
    assert any(isinstance(item, discord.ui.Button) and item.label == "Récupérer la récompense" for item in ready_view.children)
