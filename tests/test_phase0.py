import asyncio
import json
import sqlite3

import pytest

from KingdomData import ContentStore, ValidationError
from kingdomCore import GameEngine
from kingdomEvent import EventBus


class CountingRng:
    def __init__(self):
        self.choices_count = 0

    def choices(self, population, weights=None, k=1):
        self.choices_count += 1
        return [population[-1]]

    def randint(self, minimum, maximum):
        return maximum


def publish_building(store, key, actions):
    draft = store.save("building", key, {"name": key, "actions": actions})
    store.publish("building", key, draft["version"])


def seed_reference(store, entity_type, key):
    draft = store.save(entity_type, key, {"name": key, **({"trigger": {"type": "manual"}, "effects": []} if entity_type == "event" else {})})
    store.publish(entity_type, key, draft["version"])


def test_interface_purchase_option_requires_an_item_reference():
    from KingdomData.schemas import _validate_interaction

    _validate_interaction({"type": "purchase", "item_key": "beer_blonde"})
    with pytest.raises(ValidationError, match="référencer un objet"):
        _validate_interaction({"type": "purchase", "item_key": ""})


def test_phase0_schema_migration_preserves_legacy_activity_table(tmp_path):
    path = tmp_path / "legacy-schema.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE scheduled_actions(id INTEGER PRIMARY KEY,discord_id TEXT,building_key TEXT,action_key TEXT,ready_at REAL,effects_json TEXT,status TEXT,created_at TEXT,completed_at TEXT)")
    store = ContentStore(path); store.initialize()
    with store.connection() as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(scheduled_actions)")}
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"category", "limit_scope", "result_json", "claim_hooks_json"} <= columns
    assert "collective_contributions" in tables


def test_profession_primitives_keep_progress_and_tools(tmp_path):
    store = ContentStore(tmp_path / "professions.db"); store.initialize()
    seed_reference(store, "item", "kit")
    publish_building(store, "guild_hall", [
        {"key": "join_alpha", "name": "Rejoindre", "conditions": {"type": "no_active_profession"}, "effects": [
            {"type": "profession_join", "profession": "alpha"},
            {"type": "tool_grant", "tool": "kit", "durability": 8, "max_durability": 10, "level": 2},
            {"type": "profession_experience", "profession": "alpha", "amount": 120, "experience_per_level": 100},
        ]},
        {"key": "join_beta", "name": "Deuxième", "effects": [{"type": "profession_join", "profession": "beta"}]},
        {"key": "leave_alpha", "name": "Quitter", "conditions": {"type": "profession_active", "profession": "alpha"}, "effects": [{"type": "profession_leave", "profession": "alpha"}]},
    ])
    engine = GameEngine(store)
    joined = asyncio.run(engine.execute("1", "guild_hall", "join_alpha", "join"))
    assert joined["player"]["professions"]["alpha"] == {"level": 2, "experience": 120}
    with pytest.raises(ValidationError): asyncio.run(engine.execute("1", "guild_hall", "join_beta", "second"))
    left = asyncio.run(engine.execute("1", "guild_hall", "leave_alpha", "leave"))
    assert left["player"]["professions"] == {}
    assert left["player"]["tools"]["kit"]["durability"] == 8
    asyncio.run(engine.execute("1", "guild_hall", "join_alpha", "rejoin"))
    assert engine.player("1")["professions"]["alpha"] == {"level": 3, "experience": 240}


def test_combined_conditions_tools_context_and_state(tmp_path):
    store = ContentStore(tmp_path / "conditions.db"); store.initialize()
    conditions = {"all": [
        {"type": "resource", "resource": "energy", "operator": ">=", "value": 20},
        {"any": [{"type": "discord_role", "role": "Artisan"}, {"type": "state", "key": "permit", "operator": "=", "value": 1}]},
        {"not": {"type": "item_present", "item": "ban", "value": 1}},
        {"type": "voice_presence", "operator": "=", "value": True},
        {"type": "tool_durability", "tool": "hammer", "operator": ">=", "value": 4},
    ]}
    publish_building(store, "workshop", [{"key": "work", "name": "Travail", "conditions": conditions, "effects": [{"type": "message", "text": "ok"}]}])
    engine = GameEngine(store)
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,updated_at) VALUES('2','now')")
        db.execute("INSERT INTO player_tools(discord_id,tool_key,durability,max_durability) VALUES('2','hammer',4,10)")
    assert asyncio.run(engine.execute("2", "workshop", "work", "work-ok", {"roles": ["Artisan"], "voice_channel_id": 9}))["messages"] == ["ok"]
    with pytest.raises(ValidationError): asyncio.run(engine.execute("2", "workshop", "work", "work-no-role", {"roles": [], "voice_channel_id": 9}))


def test_failure_hook_emits_generic_event(tmp_path):
    store = ContentStore(tmp_path / "failure-hook.db"); store.initialize(); bus = EventBus(); events = []
    seed_reference(store, "event", "action_denied")
    async def capture(event): events.append(event)
    bus.subscribe("*", capture)
    publish_building(store, "locked_site", [{"key": "locked", "name": "Fermé", "conditions": {"type": "item_present", "item": "permit"}, "hooks": {"on_failure": {"event": "action_denied", "payload": {"audio": "denied"}}}, "effects": []}])
    with pytest.raises(ValidationError): asyncio.run(GameEngine(store, bus).execute("9", "locked_site", "locked", "denied"))
    event = next(event for event in events if event.type == "action_denied")
    assert event.payload["audio"] == "denied"


def test_scheduled_random_result_is_selected_once_and_claim_hooks_receive_it(tmp_path):
    store = ContentStore(tmp_path / "scheduled.db"); store.initialize(); rng = CountingRng(); bus = EventBus(); events = []
    seed_reference(store, "item", "wood"); seed_reference(store, "event", "activity_started"); seed_reference(store, "event", "activity_claimed")
    async def capture(event): events.append(event)
    bus.subscribe("*", capture)
    deferred = [{"type": "random_result", "outcomes": [
        {"key": "common", "weight": 9, "effects": [{"type": "production", "resource": "wood", "amount": 1, "destination": "player_inventory"}]},
        {"key": "rare", "weight": 1, "effects": [{"type": "production", "resource": "wood", "amount": 3, "destination": "player_inventory"}]},
    ]}]
    publish_building(store, "timed_site", [
        {"key": "start", "name": "Lancer", "hooks": {"on_start": {"event": "activity_started"}}, "effects": [{"type": "schedule", "action": "job", "duration_seconds": 30, "limit_scope": "player_building", "max_active": 1, "effects": deferred, "hooks": {"on_claim": [{"event": "activity_claimed", "payload": {"audio": True}}]}}]},
        {"key": "claim", "name": "Récupérer", "effects": [{"type": "claim_scheduled", "action": "job"}]},
    ])
    engine = GameEngine(store, bus, rng)
    asyncio.run(engine.execute("3", "timed_site", "start", "start"))
    assert rng.choices_count == 1
    with pytest.raises(ValidationError): asyncio.run(engine.execute("3", "timed_site", "start", "duplicate"))
    with store.connection() as db:
        row = db.execute("SELECT effects_json,result_json FROM scheduled_actions").fetchone()
        assert json.loads(row[0]) == [{"type": "production", "resource": "wood", "amount": 3, "destination": "player_inventory"}]
        assert json.loads(row[1])["selected_results"] == ["rare"]
        db.execute("UPDATE scheduled_actions SET ready_at=0")
    claimed = asyncio.run(engine.execute("3", "timed_site", "claim", "claim"))
    assert claimed["player"]["inventory"]["wood"] == 3
    assert rng.choices_count == 1
    claim_event = next(event for event in events if event.type == "activity_claimed")
    assert claim_event.payload["selected_results"] == ["rare"]


@pytest.mark.parametrize("scope,second_allowed", [
    ("player", False), ("player_building", True), ("player_action", True), ("category", False),
])
def test_activity_limits_support_multiple_scopes(tmp_path, scope, second_allowed):
    store = ContentStore(tmp_path / f"scope-{scope}.db"); store.initialize()
    schedule = lambda action: {"type": "schedule", "action": action, "duration_seconds": 60, "limit_scope": scope, "category": "shared", "max_active": 1, "effects": []}
    publish_building(store, "site_one", [{"key": "first", "name": "Première", "effects": [schedule("job_one")]}])
    publish_building(store, "site_two", [{"key": "second", "name": "Deuxième", "effects": [schedule("job_two")]}])
    engine = GameEngine(store)
    asyncio.run(engine.execute("5", "site_one", "first", f"first-{scope}"))
    if second_allowed:
        asyncio.run(engine.execute("5", "site_two", "second", f"second-{scope}"))
    else:
        with pytest.raises(ValidationError): asyncio.run(engine.execute("5", "site_two", "second", f"second-{scope}"))


def test_production_destinations_and_contribution_history(tmp_path):
    store = ContentStore(tmp_path / "production.db"); store.initialize()
    seed_reference(store, "item", "flour"); seed_reference(store, "item", "bran"); publish_building(store, "warehouse", [])
    publish_building(store, "mill", [{"key": "produce", "name": "Produire", "effects": [
        {"type": "production", "resource": "flour", "amount": 2, "destination": "player_inventory"},
        {"type": "production", "resource": "bran", "amount": 4, "destination": "building_stock", "building": "warehouse"},
        {"type": "contribution", "objective": "winter_supply", "resource": "flour", "amount": 2, "metadata": {"source": "mill"}},
    ]}])
    result = asyncio.run(GameEngine(store).execute("4", "mill", "produce", "produce"))
    assert result["player"]["inventory"]["flour"] == 2
    with store.connection() as db:
        assert db.execute("SELECT quantity FROM building_stock WHERE building_key='warehouse' AND item_key='bran'").fetchone()[0] == 4
        contribution = db.execute("SELECT discord_id,amount,metadata_json FROM collective_contributions").fetchone()
        assert tuple(contribution[:2]) == ("4", 2)
        assert json.loads(contribution[2]) == {"source": "mill"}


@pytest.mark.parametrize("action", [
    {"key": "bad_condition", "name": "X", "conditions": {"type": "unknown"}, "effects": []},
    {"key": "bad_destination", "name": "X", "effects": [{"type": "production", "resource": "wood", "destination": "moon"}]},
    {"key": "bad_hook", "name": "X", "hooks": {"on_start": {"payload": {}}}, "effects": []},
    {"key": "bad_scope", "name": "X", "effects": [{"type": "schedule", "action": "job", "limit_scope": "realm", "effects": []}]},
])
def test_invalid_generic_contract_is_rejected_before_publication(tmp_path, action):
    store = ContentStore(tmp_path / f"invalid-{action['key']}.db"); store.initialize()
    with pytest.raises(ValidationError): store.save("building", "invalid_building", {"name": "Invalide", "actions": [action]})
