import asyncio
from types import SimpleNamespace

from KingdomVoice.bot_manager import ManagedVoiceBot, VoiceBotManager, _normalized_name
from KingdomVoice.configuration import discover_platform_workers


def test_provisioned_voice_channel_matches_building_name():
    assert _normalized_name("🔊 Place du village") == _normalized_name("Place du village")
    assert _normalized_name("🔊 Forêt Royale") == _normalized_name("Forêt Royale")


def test_stale_voice_channel_id_falls_back_to_configured_name():
    guild = SimpleNamespace(voice_channels=[])
    target = SimpleNamespace(name="🔊 Forêt Royale", guild=guild)
    guild.voice_channels = [target]

    class FakeBot:
        key = "voice_sylvain"
        channel_id = 999
        config = {"voice_channel_name": "Forêt Royale", "building_key": "forest"}
        guilds = [guild]

        @staticmethod
        def get_channel(_channel_id):
            return None

        @staticmethod
        def get_guild(_guild_id):
            return None

    assert ManagedVoiceBot.target_channel(FakeBot()) is target


def test_legacy_audio_folder_is_resolved_with_or_without_assets_prefix(tmp_path):
    folder = tmp_path / "assets" / "village" / "ambience"
    folder.mkdir(parents=True)
    track = folder / "village.mp3"
    track.write_bytes(b"audio-test")
    fake = SimpleNamespace(assets_root=tmp_path)
    assert ManagedVoiceBot._tracks(fake, "village/ambience") == [track]
    assert ManagedVoiceBot._tracks(fake, "assets/village/ambience") == [track]


def test_voice_worker_applies_configured_server_identity():
    class FakeMember:
        def __init__(self):
            self.edited = None

        async def edit(self, **kwargs):
            self.edited = kwargs

    member = FakeMember()
    fake = SimpleNamespace(
        config={"name": "Voice Worker 1", "server_nickname": "Barde de Valbrume", "server_bio": "Ambiance de la taverne"},
        guilds=[SimpleNamespace(me=member)],
    )

    asyncio.run(ManagedVoiceBot.apply_configured_identity(fake))

    assert member.edited["nick"] == "Barde de Valbrume"
    assert "bio" not in member.edited


def test_historical_platform_workers_are_discovered_without_exposing_tokens():
    workers = discover_platform_workers({
        "EDGAR_BOT_TOKEN": "secret-edgar",
        "VOICE_WORKER_3_TOKEN": "secret-three",
        "VOICE_WORKER_3_APPLICATION_ID": "123",
    })
    assert [worker["key"] for worker in workers] == ["voice_edgar", "voice_roland"]
    assert workers[0]["token_env"] == "EDGAR_BOT_TOKEN"
    assert workers[1]["token_env"] == "VOICE_WORKER_3_TOKEN"
    assert "secret-edgar" not in repr(workers)
    assert all(worker["worker_kind"] == "platform" for worker in workers)


def test_configured_enables_historical_worker_from_environment(monkeypatch):
    monkeypatch.setenv("EDGAR_BOT_TOKEN", "secret")
    store = SimpleNamespace(list=lambda *_args, **_kwargs: [{
        "entity_key": "voice_edgar",
        "payload": {"bot_type": "voice", "enabled": False, "building_key": "tavern"},
    }])
    configured = VoiceBotManager.configured(SimpleNamespace(store=store))
    assert configured[0]["payload"]["enabled"] is True
    assert configured[0]["payload"]["building_key"] == "tavern"


def test_automatic_presence_resolves_its_only_building_and_channel():
    store = SimpleNamespace(
        list=lambda entity_type, **_kwargs: [{"entity_key": "camp", "payload": {"location_key": "forest"}}] if entity_type == "building" else [],
        building_channels=lambda key: {"voice_channel_id": "456"} if key == "camp" else {},
    )
    manager = SimpleNamespace(store=store)
    presence = __import__("KingdomVoice.pool", fromlist=["VoicePresence"]).VoicePresence(
        "forest_sound", "Forêt", "ambience", location_key="forest"
    )
    assert VoiceBotManager._presence_target(manager, presence) == ("camp", "456")
