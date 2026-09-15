from KingdomData.store import ContentStore
from kingdomEvent.lifecycle import EventLifecycle
from kingdomEvent.runtime import event_is_active
from kingdomCore.engine import GameEngine
from types import SimpleNamespace


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
