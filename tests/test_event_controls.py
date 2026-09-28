from datetime import datetime, timezone
import time

from KingdomData.store import ContentStore
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.runtime import WorldClock, event_is_active
from kingdomCore.engine import GameEngine
from types import SimpleNamespace


def publish(store, kind, key, payload):
    draft = store.save(kind, key, payload, "test")
    store.publish(kind, key, draft["version"], "test")


def contribute(store, key, amount, *, building="church", resource="progress", at=None):
    stamp = datetime.fromtimestamp(at or time.time(), timezone.utc).isoformat()
    with store.connection() as db:
        db.execute(
            "INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) "
            "VALUES(?,?,?,?,?,'{}',?)",
            (key, "42", building, resource, amount, stamp),
        )


def test_enabled_definition_is_not_a_running_event():
    assert not event_is_active({"enabled": True, "trigger": {"type": "manual"}})
    assert not event_is_active({"enabled": True, "trigger": {"type": "scheduled"}})
    assert event_is_active({"enabled": True, "active": True, "trigger": {"type": "manual"}})
    assert not event_is_active({"enabled": False, "active": True})


def test_restart_reuses_occurrence_and_persists(tmp_path):
    store = ContentStore(tmp_path / "events.db")
    store.initialize()
    draft = store.save("event", "festival", {"name": "Festival", "duration_seconds": 180, "enabled": True}, "test")
    store.publish("event", "festival", draft["version"], "test")
    lifecycle = EventLifecycle(store)
    occurrence = lifecycle.activate("festival", now=1000)
    key = occurrence["occurrence_id"]
    assert lifecycle.pause(key, now=1010)["remaining_seconds"] == 170
    assert lifecycle.resume(key, now=1020)["ends_at"] == 1190
    restarted = lifecycle.restart(key, now=1030)
    assert restarted["ends_at"] == 1210
    assert len(lifecycle.list(now=1030)) == 1
    assert lifecycle.stop(key, now=1040)["status"] == "finished"
    restored = EventLifecycle(ContentStore(tmp_path / "events.db"))
    assert restored.get(key, now=1041)["status"] == "finished"


def test_delayed_schedule_keeps_original_window_after_restart(tmp_path):
    store = ContentStore(tmp_path / "schedule.db")
    store.initialize()
    publish(store, "event", "storm", {"name": "Tempête"})
    start = time.time() + 3600
    occurrence = EventLifecycle(store).schedule("storm", start, 15 * 60)
    restored = EventLifecycle(ContentStore(store.path))

    during = restored.get(occurrence["occurrence_id"], now=start + 5 * 60)
    assert during["status"] == "active"
    assert during["started_at"] == start
    assert during["ends_at"] == start + 15 * 60
    assert during["remaining_seconds"] == 10 * 60

    expired = restored.get(occurrence["occurrence_id"], now=start + 16 * 60)
    assert expired["status"] == "finished"
    assert expired["started_at"] == start
    assert expired["ends_at"] == start + 15 * 60


def test_schedule_first_observed_after_deadline_never_activates(tmp_path):
    store = ContentStore(tmp_path / "missed.db")
    store.initialize()
    publish(store, "event", "storm", {"name": "Tempête"})
    start = time.time() + 3600
    occurrence = EventLifecycle(store).schedule("storm", start, 15 * 60)
    expired = EventLifecycle(ContentStore(store.path)).get(occurrence["occurrence_id"], now=start + 16 * 60)
    assert expired["status"] == "finished"
    assert expired["started_at"] == start
    assert expired["ends_at"] == start + 15 * 60


def test_active_event_overrides_manual_weather_without_changing_base(tmp_path):
    store = ContentStore(tmp_path / "weather.db")
    store.initialize()
    publish(store, "environment", "world", {
        "name": "Monde", "mode": "manual", "weather": {"key": "clear", "name": "Beau"},
        "weather_options": [
            {"key": "clear", "name": "Beau", "emoji": "☀️"},
            {"key": "storm", "name": "Tempête", "emoji": "⛈️"},
        ],
    })
    publish(store, "event", "storm", {"name": "Tempête", "weather_key": "storm"})
    start = time.time() + 3600
    EventLifecycle(store).schedule("storm", start, 15 * 60)

    assert WorldClock(store).state(now=start - 1)["weather"]["key"] == "clear"
    during = WorldClock(ContentStore(store.path)).state(now=start + 5 * 60)
    assert during["weather"]["key"] == "storm"
    assert during["weather"]["name"] == "Tempête"
    assert WorldClock(ContentStore(store.path)).state(now=start + 16 * 60)["weather"]["key"] == "clear"


def test_incident_finishes_when_its_filtered_collective_goal_is_met(tmp_path):
    store = ContentStore(tmp_path / "incident.db")
    store.initialize()
    publish(store, "event", "mine_incident", {
        "name": "Incident mine", "completion_objective": {
            "key": "mine_repair", "target": 3, "building_key": "deep_mine", "resource_key": "progress",
        },
    })
    start = time.time() + 3600
    occurrence = EventLifecycle(store).activate("mine_incident", duration_seconds=3600, now=start)
    contribute(store, "mine_repair", 5, building="church", at=start + 1)
    contribute(store, "mine_repair", 5, building="deep_mine", resource="wood", at=start + 2)
    contribute(store, "mine_repair", 2, building="deep_mine", at=start + 3)
    assert EventLifecycle(store).get(occurrence["occurrence_id"], now=start + 4)["status"] == "active"
    contribute(store, "mine_repair", 1, building="deep_mine", at=start + 5)
    finished = EventLifecycle(ContentStore(store.path)).get(occurrence["occurrence_id"], now=start + 6)
    assert finished["status"] == "finished"
    assert finished["ends_at"] == start + 6


def test_collective_finale_conditions_are_fixed_at_scheduled_time(tmp_path):
    store = ContentStore(tmp_path / "finale.db")
    store.initialize()
    start = time.time() + 3600
    choices = {
        "full": {"key": "work_done", "target": 2},
        "partial": {"all": [
            {"key": "work_done", "target": 1},
            {"not": {"key": "work_done", "target": 2}},
        ]},
        "deferred": {"not": {"key": "work_done", "target": 1}},
    }
    lifecycle = EventLifecycle(store)
    ids = {}
    for key, condition in choices.items():
        publish(store, "event", key, {"name": key, "activation_conditions": {"collective": condition}})
        ids[key] = lifecycle.schedule(key, start, 60)["occurrence_id"]
    contribute(store, "work_done", 1, at=start - 10)
    contribute(store, "work_done", 1, at=start + 10)

    first_seen = {item["event_key"]: item for item in EventLifecycle(ContentStore(store.path)).list(now=start + 20)}
    assert first_seen["partial"]["status"] == "active"
    assert first_seen["full"]["status"] == "disabled"
    assert first_seen["deferred"]["status"] == "disabled"
    assert EventLifecycle(store).get(ids["partial"], now=start + 120)["status"] == "finished"
    assert EventLifecycle(store).get(ids["full"], now=start + 120)["status"] == "disabled"


def test_collective_progress_caps_surplus_materials(tmp_path):
    store = ContentStore(tmp_path / "materials.db")
    store.initialize()
    start = time.time() + 3600
    objectives = [{"key": "wood_delivered", "target": 4}, {"key": "iron_delivered", "target": 2}]
    for key, ratio in (("mostly_ready", 0.6), ("not_ready", 0.7)):
        publish(store, "event", key, {
            "name": key,
            "activation_conditions": {"collective": {"progress": {
                "objectives": objectives, "minimum_ratio": ratio,
            }}},
        })
        EventLifecycle(store).schedule(key, start, 60)
    contribute(store, "wood_delivered", 100, at=start - 10)

    statuses = {item["event_key"]: item["status"] for item in EventLifecycle(store).list(now=start + 1)}
    assert statuses == {"mostly_ready": "active", "not_ready": "disabled"}


def test_gameplay_uses_running_occurrences_not_definition_flag():
    payload = {"active": True, "enabled": True, "modifiers": [
        {"target_type": "kingdom", "property": "production.quantity", "operator": "multiply", "value": 2}
    ]}
    engine = SimpleNamespace(
        _range=GameEngine._range,
        store=SimpleNamespace(list=lambda *args, **kwargs: [{"entity_key": "bonus", "payload": payload}]),
        _world_snapshot={"active_events": [], "event_occurrences": [], "weather": {}},
    )
    assert GameEngine._effective_range(engine, 10, "production.quantity", {}) == (10, 10)
