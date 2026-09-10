import asyncio
from types import SimpleNamespace

from KingdomData import ContentStore
from KingdomVoice.bot_manager import ManagedVoiceBot, VoiceBotManager, _normalized_name
from KingdomVoice.configuration import discover_platform_workers, migrate_bot_catalog
from KingdomVoice.pool import VoicePresence
from KingdomVoice.resolver import resolve_building_presences


def test_failed_worker_is_retried_without_crashing_voice_manager(monkeypatch, capsys):
    class BrokenClient:
        async def start(self, _token, *, reconnect=True):
            assert reconnect is True
            raise RuntimeError("application Discord refusée")

    async def stop_after_diagnostic(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", stop_after_diagnostic)
    manager = VoiceBotManager.__new__(VoiceBotManager)

    try:
        asyncio.run(manager._run_client("voice_worker_2", BrokenClient(), "secret-token"))
    except asyncio.CancelledError:
        pass

    output = capsys.readouterr().out
    assert "voice_worker_2 indisponible" in output
    assert "RuntimeError" in output
    assert "secret-token" not in output


def test_voice_service_stays_alive_when_no_worker_token_is_configured(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "voice-idle.db")
    store.initialize()
    manager = VoiceBotManager(store)
    monkeypatch.setattr(manager, "configured", lambda: [])

    calls = 0

    async def observe_then_stop(_seconds):
        nonlocal calls
        calls += 1
        raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", observe_then_stop)
    try:
        asyncio.run(manager.run())
    except asyncio.CancelledError:
        pass

    assert calls == 1
    assert manager.pool.snapshot()["quota"] == 0


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


def test_voice_worker_applies_the_incarnated_presence_portrait(tmp_path):
    portrait = tmp_path / "assets" / "presence-avatars" / "edgar.webp"
    portrait.parent.mkdir(parents=True)
    portrait.write_bytes(b"portrait-edgar")

    class FakeMember:
        nick = "Voice Worker 1"
        edited = None

        async def edit(self, **kwargs):
            self.edited = kwargs

    member = FakeMember()
    guild = SimpleNamespace(me=member)
    fake = SimpleNamespace(
        config={"guild_id": "123"},
        guilds=[guild],
        get_guild=lambda guild_id: guild if guild_id == 123 else None,
        assets_root=tmp_path,
        _applied_identity="",
        key="voice_worker_1",
    )

    asyncio.run(
        ManagedVoiceBot.apply_presence_identity(
            fake,
            VoicePresence(
                "presence_edgar",
                "Edgar Brassebarbe",
                "npc",
                avatar_url="assets/presence-avatars/edgar.webp",
            ),
        )
    )

    assert member.edited["nick"] == "Edgar Brassebarbe"
    assert member.edited["avatar"] == b"portrait-edgar"


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


def test_bot_catalog_migration_removes_legacy_duplicates_and_steward(tmp_path):
    store = ContentStore(tmp_path / "bots.db")
    store.initialize()
    definitions = [
        {
            "type": "bot", "key": "voice_edgar",
            "payload": {
                "name": "Voice Worker 1", "bot_type": "voice",
                "worker_kind": "platform", "token_env": "VOICE_WORKER_1_TOKEN",
                "legacy_token_env": "EDGAR_BOT_TOKEN", "voice_channel_env": "VOICE_WORKER_1_CHANNEL_ID",
            },
        },
        {
            "type": "bot", "key": "old_edgar_copy",
            "payload": {
                "name": "Voice Worker 1", "bot_type": "voice",
                "worker_kind": "custom", "token_env": "EDGAR_BOT_TOKEN",
                "voice_channel_env": "OLD_EDGAR_CHANNEL_ID",
            },
        },
        {
            "type": "bot", "key": "realm_steward",
            "payload": {
                "name": "Intendant du Royaume", "bot_type": "text",
                "token_env": "KINGDOM_CORE_TOKEN",
            },
        },
    ]
    store.seed(definitions)

    removed = migrate_bot_catalog(store)

    assert set(removed) == {"old_edgar_copy", "realm_steward"}
    assert [item["entity_key"] for item in store.list("bot")] == ["voice_edgar"]
    assert migrate_bot_catalog(store) == []


def test_configured_enables_historical_worker_from_environment(monkeypatch):
    monkeypatch.setenv("EDGAR_BOT_TOKEN", "secret")
    store = SimpleNamespace(list=lambda *_args, **_kwargs: [{
        "entity_key": "voice_edgar",
        "payload": {"bot_type": "voice", "enabled": False, "building_key": "tavern"},
    }])
    configured = VoiceBotManager.configured(SimpleNamespace(store=store))
    assert configured[0]["payload"]["enabled"] is True
    assert configured[0]["payload"]["auto_join"] is False
    assert "building_key" not in configured[0]["payload"]


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


def test_living_scene_prioritizes_primary_npc_and_keeps_other_npcs_visible():
    building = {
        "name": "Taverne d'Edgar",
        "modules": {"audio": {"default_group_key": "tavern", "primary_npc_key": "edgar"}},
    }
    npcs = [
        {"entity_key": "roland", "payload": {"name": "Roland", "building_key": "tavern", "voice_presence_key": "presence_roland"}},
        {"entity_key": "edgar", "payload": {"name": "Edgar", "building_key": "tavern", "voice_presence_key": "presence_edgar"}},
    ]

    scene = resolve_building_presences("tavern", building, npcs, {})

    assert [item["name"] for item in scene] == ["Edgar", "Roland"]
    assert [item["carries_ambience"] for item in scene] == [True, False]


def test_living_scene_falls_back_to_building_and_event_moves_npcs():
    building = {"name": "Taverne", "modules": {"audio": {"default_group_key": "quiet"}}}
    npcs = [{"entity_key": "edgar", "payload": {"name": "Edgar", "building_key": "tavern"}}]
    events = [{"priority": 50, "character_moves": [{"npc_key": "edgar", "building_key": "church"}]}]

    tavern = resolve_building_presences("tavern", building, npcs, {}, events=events)
    church = resolve_building_presences("church", {"name": "Église"}, npcs, {}, events=events)

    assert tavern[0] | {"avatar_path": "", "avatar_url": ""} == {"key": "building_tavern", "name": "Taverne", "presence_type": "ambience", "scene_key": "quiet", "priority": 0, "building_key": "tavern", "carries_ambience": True, "avatar_path": "", "avatar_url": ""}
    assert church[0]["name"] == "Edgar"


def test_living_scene_exposes_the_incarnated_character_or_building_portrait():
    npc_scene = resolve_building_presences(
        "tavern",
        {"name": "Taverne"},
        [{"entity_key": "edgar", "payload": {"name": "Edgar", "building_key": "tavern", "avatar_path": "avatars/edgar.png"}}],
        {},
    )
    building_scene = resolve_building_presences(
        "mine", {"name": "Mine", "image_path": "buildings/mine.webp"}, [], {},
    )

    assert npc_scene[0]["name"] == "Edgar"
    assert npc_scene[0]["avatar_path"] == "avatars/edgar.png"
    assert building_scene[0]["name"] == "Mine"
    assert building_scene[0]["avatar_path"] == "buildings/mine.webp"


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


def test_legacy_presence_source_metadata_is_exposed_to_worker(tmp_path):
    store = ContentStore(tmp_path / "world.db")
    store.initialize()
    building = store.save("building", "mine", {"name": "Mine"})
    store.publish("building", "mine", building["version"])
    presence = store.save(
        "voice_presence",
        "presence_roland",
        {
            "name": "Roland",
            "presence_type": "npc",
            "assignment_mode": "automatic",
            "metadata": {
                "building_key": "mine",
                "source_npc_key": "roland",
            },
        },
    )
    store.publish("voice_presence", "presence_roland", presence["version"])
    npc = store.save(
        "npc",
        "roland",
        {
            "name": "Roland",
            "building_key": "mine",
            "voice_presence_key": "presence_roland",
        },
    )
    store.publish("npc", "roland", npc["version"])

    manager = VoiceBotManager(store, worlds=[(store, "123")])
    resolved = manager._published_presences()["presence_roland"]

    assert resolved.source_key == "roland"


def test_zero_or_invalid_legacy_quota_uses_all_workers(monkeypatch):
    monkeypatch.setenv("KINGDOM_MAX_CONCURRENT_VOICE_PRESENCES", "0")
    assert VoiceBotManager.configured_quota(5) == 5

    monkeypatch.setenv("KINGDOM_MAX_CONCURRENT_VOICE_PRESENCES", "invalide")
    assert VoiceBotManager.configured_quota(5) == 5
