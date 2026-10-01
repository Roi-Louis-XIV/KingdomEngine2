import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from KingdomVoice.bot_manager import ManagedVoiceBot, VoiceBotManager
from KingdomVoice.pool import VoicePresence, VoiceWorkerPool, VoiceWorkerState


def test_ten_workers_keep_one_presence_and_release_before_reallocation():
    async def scenario():
        manager = VoiceBotManager.__new__(VoiceBotManager)
        manager.store = object()
        manager.world_quotas = {}
        manager._presence_stores = {}
        occupied = {"farm"}
        target = ["farm"]
        presence = VoicePresence("agathe", "Agathe", scene_key="farm_audio", release_timeout_seconds=1,
                                 metadata={"guild_id": "1"})
        manager._published_presences = lambda: {presence.key: presence}
        manager._presence_target = lambda p: (target[0], target[0])
        manager._channel_has_humans = lambda guild, channel: channel in occupied
        manager._publish_runtime_status = lambda: None
        manager.pool = VoiceWorkerPool([VoiceWorkerState(str(i)) for i in range(10)])
        manager.clients = {}

        class Client:
            def __init__(self, key):
                self.key = key
                self.config = {"auto_join": False}
                self.voice_clients = []
                self._connection_lock = asyncio.Lock()
                self.apply_presence_identity = AsyncMock()
                self._applied_identity = ""

            def get_guild(self, guild):
                return object()

            async def ensure_connected(self):
                if not self.voice_clients:
                    async def disconnect(**kwargs):
                        # L'ancienne affectation est déjà désarmée à cet instant.
                        assert self.config["presence_key"] == ""
                        await asyncio.sleep(0)
                        self.voice_clients.clear()
                    self.voice_clients.append(SimpleNamespace(
                        channel=SimpleNamespace(id=self.config["voice_channel_id"]), guild=SimpleNamespace(id=1),
                        is_connected=lambda: True, stop=lambda: None, disconnect=disconnect))

        manager.clients = {str(i): Client(str(i)) for i in range(10)}
        for _ in range(12):
            for worker in manager.pool.workers.values():
                worker.last_activity = "2000-01-01T00:00:00+00:00"
            await manager._sync_automatic_presences()
            assert sum(len(c.voice_clients) for c in manager.clients.values()) == 1
        occupied.clear()
        await manager._sync_automatic_presences()
        assert not any(c.voice_clients for c in manager.clients.values())
        assert all(w.free for w in manager.pool.workers.values())
        occupied.add("farm")
        await asyncio.gather(*(manager.assign_presence(presence, guild_id="1", channel_id="farm", building_key="farm") for _ in range(10)))
        assert sum(len(c.voice_clients) for c in manager.clients.values()) == 1
        for destination in ("mine", "camp", "farm", "mine", "camp"):
            occupied.clear()
            occupied.add(destination)
            target[0] = destination
            await asyncio.gather(*(manager._sync_automatic_presences() for _ in range(5)))
            voices = [voice for c in manager.clients.values() for voice in c.voice_clients]
            assert len(voices) == 1
            assert voices[0].channel.id == destination
        occupied.clear()
        await manager._sync_automatic_presences()
        assert not any(c.voice_clients for c in manager.clients.values())

    asyncio.run(scenario())


def test_failed_disconnect_keeps_worker_reserved():
    async def scenario():
        manager = VoiceBotManager.__new__(VoiceBotManager)
        manager.pool = VoiceWorkerPool([VoiceWorkerState("worker")])
        presence = VoicePresence("sylvain", "Sylvain")
        manager.pool.allocate(presence, guild_id="1", channel_id="10")
        voice = SimpleNamespace(stop=lambda: None,
                                disconnect=AsyncMock(side_effect=RuntimeError("disconnect failed")))
        client = SimpleNamespace(config={"presence_key": presence.key}, current_group_key="forest",
                                 _connection_lock=asyncio.Lock(), voice_clients=[voice])
        manager.clients = {"worker": client}
        try:
            await manager.release_presence(presence.key)
        except RuntimeError:
            pass
        else:
            raise AssertionError("disconnect should fail")
        assert manager.pool.workers["worker"].presence_key == "sylvain"
        assert not manager.pool.workers["worker"].free
        assert client.config["presence_key"] == ""
        assert client.current_group_key == ""
    asyncio.run(scenario())


def test_old_channel_callback_cannot_resume_audio_after_reassignment():
    client = SimpleNamespace(config={"auto_join": False, "presence_key": "roland",
                                    "voice_channel_id": "20", "guild_id": "1"})
    old_voice = SimpleNamespace(channel=SimpleNamespace(id=10), guild=SimpleNamespace(id=1))
    client._voice_matches_assignment = lambda voice: ManagedVoiceBot._voice_matches_assignment(client, voice)
    # No playback methods are supplied: accessing them would expose a stale callback.
    ManagedVoiceBot._resume_background(client, old_voice)


def test_pool_does_not_guess_a_channel_when_provisioned_id_is_missing():
    guild = SimpleNamespace(voice_channels=[SimpleNamespace(name="farm")])
    client = SimpleNamespace(key="worker", config={"auto_join": False, "building_key": "farm"},
                             channel_id=999, guilds=[guild], get_channel=lambda _: None)
    assert ManagedVoiceBot.target_channel(client) is None


def test_managed_worker_ignores_discord_events_after_release():
    async def scenario():
        client = SimpleNamespace(config={"auto_join": False}, ensure_connected=AsyncMock(),
                                 target_channel=lambda: (_ for _ in ()).throw(AssertionError("stale target")))
        await ManagedVoiceBot.on_voice_state_update(client, None, None, None)
        client.ensure_connected.assert_not_called()
    asyncio.run(scenario())


def test_missing_audio_does_not_fail_or_duplicate_the_connection():
    async def scenario():
        guild = SimpleNamespace(me=object(), voice_client=None, id=1)
        calls = []
        voice = SimpleNamespace(is_connected=lambda: True)
        async def connect(**kwargs):
            calls.append(kwargs)
            await asyncio.sleep(0)
            guild.voice_client = voice
            return voice
        channel = SimpleNamespace(id=10, name="farm", guild=guild,
            members=[SimpleNamespace(bot=False)], connect=connect,
            permissions_for=lambda member: SimpleNamespace(connect=True, speak=True))
        voice.channel = channel
        def missing(*args):
            raise FileNotFoundError("missing ambience")
        client = SimpleNamespace(key="worker", config={"auto_join": False, "presence_key": "agathe"},
            _connection_lock=asyncio.Lock(), target_channel=lambda: channel,
            current_group_key="ambience", _start_group_background=missing)
        client._ensure_connected_locked = lambda: ManagedVoiceBot._ensure_connected_locked(client)
        await asyncio.gather(*(ManagedVoiceBot.ensure_connected(client) for _ in range(10)))
        assert len(calls) == 1
    asyncio.run(scenario())


def test_departure_during_connection_does_not_start_old_ambience():
    async def scenario():
        guild = SimpleNamespace(me=object(), voice_client=None, id=1)
        voice = SimpleNamespace(disconnect=AsyncMock())
        async def connect(**kwargs):
            channel.members.clear()
            return voice
        channel = SimpleNamespace(id=10, name="farm", guild=guild,
            members=[SimpleNamespace(bot=False)], connect=connect,
            permissions_for=lambda member: SimpleNamespace(connect=True, speak=True))
        client = SimpleNamespace(key="worker", config={"auto_join": False, "presence_key": "agathe"},
            target_channel=lambda: channel, current_group_key="ambience")
        assert await ManagedVoiceBot._ensure_connected_locked(client) is None
        voice.disconnect.assert_awaited_once_with(force=True)
    asyncio.run(scenario())
