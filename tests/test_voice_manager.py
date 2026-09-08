import asyncio
from types import SimpleNamespace

from KingdomData import ContentStore
from KingdomVoice.bot_manager import ManagedVoiceBot, VoiceBotManager, _normalized_name
from KingdomVoice.configuration import discover_platform_workers
from KingdomVoice.pool import VoicePresence


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


def test_voice_worker_reapplies_name_when_reallocated_between_buildings(tmp_path):
    class FakeMember:
        bot = True

        def __init__(self):
            self.nick = "Voice Worker 1"
            self.names = []

        async def edit(self, **kwargs):
            if "nick" in kwargs:
                self.nick = kwargs["nick"]
                self.names.append(kwargs["nick"])

    member = FakeMember()
    guild = SimpleNamespace(me=member)
    fake = SimpleNamespace(
        config={"guild_id": "123"},
        guilds=[guild],
        get_guild=lambda guild_id: guild if guild_id == 123 else None,
        assets_root=tmp_path,
        _applied_identity="",
        key="voice_edgar",
    )

    asyncio.run(ManagedVoiceBot.apply_presence_identity(
        fake, VoicePresence("mine", "Kevin", "npc")
    ))
    fake._applied_identity = ""  # équivaut à la libération de la capacité
    asyncio.run(ManagedVoiceBot.apply_presence_identity(
        fake, VoicePresence("castle", "Edgar", "npc")
    ))

    assert member.names == ["Kevin", "Edgar"]


def test_historical_platform_workers_are_discovered_without_exposing_tokens():
    workers = discover_platform_workers({
        "EDGAR_BOT_TOKEN": "secret-edgar",
        "VOICE_WORKER_3_TOKEN": "secret-three",
        "VOICE_WORKER_3_APPLICATION_ID": "123",
    })
    assert [worker["key"] for worker in workers] == [
        "voice_edgar", "voice_edouard", "voice_roland", "voice_sylvain", "voice_wagner"
    ]
    assert workers[0]["token_env"] == "EDGAR_BOT_TOKEN"
    assert workers[2]["token_env"] == "VOICE_WORKER_3_TOKEN"
    assert "secret-edgar" not in repr(workers)
    assert all(worker["worker_kind"] == "platform" for worker in workers)


def test_five_platform_workers_exist_before_tokens_are_configured():
    workers = discover_platform_workers({})
    assert len(workers) == 5
    assert [worker["name"] for worker in workers] == [
        "Voice Worker 1", "Voice Worker 2", "Voice Worker 3",
        "Voice Worker 4", "Voice Worker 5",
    ]
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


def test_direct_building_assignment_does_not_depend_on_location_guessing():
    store = SimpleNamespace(
        list=lambda entity_type, **_kwargs: [
            {"entity_key": "camp", "payload": {"location_key": "forest"}},
            {"entity_key": "lodge", "payload": {"location_key": "forest"}},
        ] if entity_type == "building" else [],
        building_channels=lambda key: {"voice_channel_id": "789"} if key == "lodge" else {},
    )
    manager = SimpleNamespace(store=store, _presence_stores={})
    presence = VoicePresence(
        "forest_sound",
        "Forêt",
        "ambience",
        location_key="forest",
        metadata={"building_key": "lodge"},
    )

    assert VoiceBotManager._presence_target(manager, presence) == ("lodge", "789")


def test_automatic_presences_are_loaded_from_every_managed_world(tmp_path):
    first = ContentStore(tmp_path / "first.db")
    second = ContentStore(tmp_path / "second.db")
    first.initialize()
    second.initialize()
    draft = second.save(
        "voice_presence",
        "forge_ambience",
        {
            "name": "Forge",
            "assignment_mode": "automatic",
            "metadata": {"building_key": "forge"},
        },
    )
    second.publish("voice_presence", "forge_ambience", draft["version"])

    manager = VoiceBotManager(first, worlds=[(first, "111"), (second, "222")])
    presences = manager._published_presences()

    assert list(presences) == ["222:forge_ambience"]
    assert presences["222:forge_ambience"].metadata["building_key"] == "forge"
    assert manager._presence_stores["222:forge_ambience"].path == second.path
