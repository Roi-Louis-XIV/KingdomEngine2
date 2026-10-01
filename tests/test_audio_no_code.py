import asyncio
import io

from KingdomData import ContentStore
from KingdomData import audio_storage
from import_v1 import _legacy_audio_definitions
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


def test_external_audio_storage_keeps_packaged_legacy_audio_as_fallback(tmp_path, monkeypatch):
    external = tmp_path / "hdd"
    packaged = tmp_path / "package" / "KingdomData"
    legacy = packaged / "assets" / "forest" / "axe.mp3"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"legacy")
    monkeypatch.setattr(audio_storage, "DATA_ROOT", external)
    monkeypatch.setattr(audio_storage, "AUDIO_ROOT", external / "assets" / "audio")
    monkeypatch.setattr(audio_storage, "PACKAGE_DATA_ROOT", packaged)

    assert audio_storage.safe_audio_path("assets/forest/axe.mp3") == legacy


def test_legacy_audio_files_become_no_code_catalog_entries(tmp_path):
    track = tmp_path / "forest" / "sfx" / "axe_01.mp3"
    track.parent.mkdir(parents=True)
    track.write_bytes(b"legacy")
    definitions = _legacy_audio_definitions(tmp_path)
    assert len(definitions) == 1
    payload = definitions[0]["payload"]
    assert payload["audio_type"] == "sfx"
    assert payload["speaker_bot_key"] == "voice_sylvain"
    assert payload["tags"][:3] == ["forest", "forêt", "v1"]


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


def test_reusable_ambience_group_and_audio_story_are_versioned(tmp_path):
    store = ContentStore(tmp_path / "kingdom.db")
    store.initialize()
    publish(store, "audio", "vent_foret", {"name": "Vent de forêt", "storage_path": "assets/audio/vent/source.ogg", "audio_type": "ambience", "volume": 0.5})
    group = publish(store, "audio_group", "foret_profonde", {
        "name": "Forêt profonde", "volume": 0.8,
        "layers": [{"audio_key": "vent_foret", "role": "ambience", "volume": 0.7, "loop": True}],
        "transitions": {"fade_in_seconds": 2, "fade_out_seconds": 1, "crossfade_seconds": 0},
    })
    story = publish(store, "audio_story", "depart_expedition", {
        "name": "Départ en expédition",
        "steps": [
            {"key": "intro", "name": "Le départ", "audio_key": "vent_foret", "delay_seconds": 0, "wait_for_end": True, "text": "Les portes s’ouvrent."},
            {"key": "silence", "name": "Au loin", "audio_key": "", "delay_seconds": 3, "wait_for_end": False, "text": "La forêt se rapproche."},
        ],
    })
    assert group["payload"]["layers"][0]["audio_key"] == "vent_foret"
    assert story["payload"]["steps"][1]["delay_seconds"] == 3
