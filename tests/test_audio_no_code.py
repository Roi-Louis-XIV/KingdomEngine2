import asyncio
import io

from KingdomData import ContentStore
from KingdomData import audio_storage
from kingdomCore import GameEngine
from kingdomEvent import EventBus


def publish(store, entity_type, key, payload):
    draft = store.save(entity_type, key, payload, "test")
    return store.publish(entity_type, key, draft["version"], "test")


def test_audio_file_is_centralized_and_versioned(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_storage, "DATA_ROOT", tmp_path / "KingdomData")
    monkeypatch.setattr(audio_storage, "AUDIO_ROOT", audio_storage.DATA_ROOT / "assets" / "audio")
    metadata = audio_storage.store_audio_file(io.BytesIO(b"fake mp3"), "coupe_bois", "hache.mp3")
    assert metadata["storage_path"].endswith("assets/audio/coupe_bois/source.mp3")
    assert (audio_storage.AUDIO_ROOT / "coupe_bois" / "source.mp3").read_bytes() == b"fake mp3"


def test_action_queues_sound_for_building(tmp_path):
    store = ContentStore(tmp_path / "kingdom.db")
    store.initialize()
    publish(store, "audio", "coup_hache", {"name": "Coup de hache", "storage_path": "assets/audio/coup_hache/source.mp3", "audio_type": "sfx", "volume": 0.5})
    publish(store, "building", "foret_test", {
        "name": "Forêt test", "modules": {"professions": [], "activities": [], "products": [], "recipes": [], "deliveries": [], "upgrades": [], "games": {}, "audio": {"groups": []}},
        "actions": [{"key": "couper_bois", "name": "Couper", "effects": [{"type": "play_audio", "audio_key": "coup_hache"}]}],
    })
    result = asyncio.run(GameEngine(store, EventBus()).execute("42", "foret_test", "couper_bois", "audio-action", {}))
    command = store.pending_audio()[0]
    assert result["ok"] is True
    assert command["building_key"] == "foret_test"
    assert command["audio_key"] == "coup_hache"


def test_event_route_queues_group_change(tmp_path):
    store = ContentStore(tmp_path / "kingdom.db")
    store.initialize()
    publish(store, "event", "orage_foret", {"name": "Orage", "trigger": {"type": "manual"}})
    publish(store, "building", "foret_orage", {
        "name": "Forêt orageuse",
        "modules": {"professions": [], "activities": [], "products": [], "recipes": [], "deliveries": [], "upgrades": [], "games": {}, "audio": {"default_group_key": "foret_calme", "groups": [{"key": "foret_calme", "name": "Calme", "tracks": {"music": [], "ambience": [], "sfx": [], "voice": []}}, {"key": "foret_orage", "name": "Orage", "tracks": {"music": [], "ambience": [], "sfx": [], "voice": []}}], "event_routes": [{"event": "orage_foret", "group_key": "foret_orage"}]}},
        "actions": [{"key": "declencher_orage", "name": "Orage", "effects": [{"type": "emit", "event": "orage_foret"}]}],
    })
    asyncio.run(GameEngine(store, EventBus()).execute("42", "foret_orage", "declencher_orage", "audio-event", {}))
    command = store.pending_audio()[0]
    assert command["command"] == "set_group"
    assert command["group_key"] == "foret_orage"
