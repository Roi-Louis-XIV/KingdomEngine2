from datetime import datetime, timedelta, timezone

import pytest

from KingdomVoice.pool import VoicePresence, VoiceProfile, VoiceWorkerPool, VoiceWorkerState


def test_worker_pool_allocates_reuses_and_releases_without_binding_npc_to_bot():
    pool = VoiceWorkerPool([VoiceWorkerState("worker_01"), VoiceWorkerState("worker_02")], max_concurrent_voice_presences=2)
    edgar = VoicePresence("edgar", "Edgar", "npc", location_key="tavern")
    forest = VoicePresence("forest_ambience", "Forêt d'Alenor", "ambience", scene_key="forest")
    first = pool.allocate(edgar, guild_id="guild", channel_id="tavern-channel")
    assert first.key == "worker_01"
    assert pool.allocate(edgar, channel_id="square-channel") is first
    second = pool.allocate(forest, channel_id="forest-channel")
    assert second.key == "worker_02"
    pool.release(presence_key="edgar")
    radio = VoicePresence("imperial_radio", "Radio impériale", "custom")
    assert pool.allocate(radio).key == "worker_01"


def test_worker_pool_quota_degrades_to_no_audio_instead_of_raising():
    pool = VoiceWorkerPool([VoiceWorkerState("worker_01"), VoiceWorkerState("worker_02")], max_concurrent_voice_presences=1)
    assert pool.allocate(VoicePresence("npc_a", "A", "npc")) is not None
    assert pool.allocate(VoicePresence("npc_b", "B", "npc")) is None
    assert pool.snapshot()["available"] == 0


def test_voice_presence_and_profile_are_generic():
    profile = VoiceProfile("radio_fr", provider="files", language="fr", categories={"alerts": ["clip_01"]})
    assert profile.provider == "files"
    with pytest.raises(ValueError):
        VoicePresence("invalid", "Invalid", "bot")


def test_pool_releases_timed_out_and_deleted_presences_without_blocking():
    worker = VoiceWorkerState("worker_01")
    pool = VoiceWorkerPool([worker], max_concurrent_voice_presences=1)
    presence = VoicePresence("guide", "Guide", release_timeout_seconds=10)
    pool.allocate(presence, guild_id="1", channel_id="2")
    worker.last_activity = (datetime.now(timezone.utc) - timedelta(seconds=11)).isoformat()
    assert pool.sweep({"guide": presence}) == ["worker_01"]
    assert worker.free is True
    pool.allocate(presence)
    assert pool.sweep({}) == ["worker_01"]


def test_pool_can_recover_a_worker_after_disconnect_error():
    pool = VoiceWorkerPool([VoiceWorkerState("worker_01")], max_concurrent_voice_presences=1)
    pool.fail("worker_01", "gateway disconnected")
    assert pool.allocate(VoicePresence("radio", "Radio")) is None
    recovered = pool.recover("worker_01")
    assert recovered.free is True
    assert pool.allocate(VoicePresence("radio", "Radio")).key == "worker_01"
