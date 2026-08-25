import discord
import asyncio
from types import SimpleNamespace

from KingdomData import ContentStore
from kingdomCore.discord_bot import building_for_voice
from kingdomCore.provisioner import DiscordProvisioner, channel_slug, required_bot_permissions


def test_channel_slug_is_discord_safe():
    assert channel_slug("Forêt Royale") == "foret-royale"
    assert channel_slug("  La Forge Dorée ! ") == "la-forge-doree"
    assert channel_slug("🏰") == "royaume"


def test_invited_bot_gets_only_required_management_permissions():
    permissions = required_bot_permissions()
    assert permissions.manage_roles
    assert permissions.manage_channels
    assert permissions.manage_messages
    assert permissions.embed_links and permissions.attach_files
    assert not permissions.kick_members
    assert not permissions.ban_members
    assert not permissions.moderate_members
    assert permissions.connect and permissions.speak
    assert not permissions.use_application_commands
    assert not permissions.administrator
    assert not permissions.manage_webhooks


def test_legacy_voice_channel_is_linked_by_name_even_outside_building_category(tmp_path):
    store = ContentStore(tmp_path / "legacy-voice.db")
    store.initialize()
    draft = store.save("building", "forest_camp", {"name": "Camp forestier", "emoji": "🌲", "actions": []})
    store.publish("building", "forest_camp", draft["version"])
    legacy_channel = SimpleNamespace(
        name="🎙️ Camp forestier",
        category=SimpleNamespace(name="🏰 KINGDOM ENGINE"),
    )

    assert building_for_voice(store, legacy_channel)["entity_key"] == "forest_camp"


def test_deleted_building_removes_only_its_managed_discord_channels(tmp_path):
    deleted = []
    class Channel:
        def __init__(self, channel_id, name): self.id, self.name = channel_id, name
        async def delete(self, reason=None): deleted.append((self.name, reason))
    class Category(Channel):
        def __init__(self):
            super().__init__(3, "🏰 La Forge")
            self.text_channels = [Channel(1, "la-forge")]
            self.voice_channels = [Channel(2, "🔊 La Forge")]
            self.channels = [*self.text_channels, *self.voice_channels]
    category = Category()
    guild = SimpleNamespace(categories=[category])
    store = ContentStore(tmp_path / "cleanup.db"); store.initialize()
    removed = asyncio.run(DiscordProvisioner(guild, store).remove_building_channels("forge", {"name": "La Forge", "emoji": "🏰"}))
    assert removed == ["la-forge", "🔊 La Forge", "🏰 La Forge"]
    assert len(deleted) == 3


def test_deleted_building_keeps_category_with_manual_channel(tmp_path):
    deleted = []
    class Channel:
        def __init__(self, channel_id, name): self.id, self.name = channel_id, name
        async def delete(self, reason=None): deleted.append(self.name)
    class Category(Channel):
        def __init__(self):
            super().__init__(4, "🏰 La Forge")
            self.text_channels = [Channel(1, "la-forge"), Channel(9, "discussion-artisans")]
            self.voice_channels = [Channel(2, "🔊 La Forge")]
            self.channels = [*self.text_channels, *self.voice_channels]
    category = Category(); store = ContentStore(tmp_path / "safe-cleanup.db"); store.initialize()
    asyncio.run(DiscordProvisioner(SimpleNamespace(categories=[category]), store).remove_building_channels("forge", {"name": "La Forge", "emoji": "🏰"}))
    assert deleted == ["la-forge", "🔊 La Forge"]


def test_discord_provision_queue_survives_and_recovers_a_core_restart(tmp_path):
    store = ContentStore(tmp_path / "discord-provision.db")
    store.initialize()

    request_id = store.request_discord_provision("server", requested_by="test")
    assert store.discord_provision_status()["status"] == "pending"

    claimed = store.pending_discord_provision()
    assert [job["id"] for job in claimed] == [request_id]
    assert store.discord_provision_status()["status"] == "processing"

    assert store.recover_discord_provision() == 1
    assert store.discord_provision_status()["status"] == "pending"

    claimed_again = store.pending_discord_provision()
    assert claimed_again[0]["attempts"] == 1
    store.finish_discord_provision(request_id, report="Discord synchronisé")
    status = store.discord_provision_status()
    assert status["status"] == "done"
    assert status["report"] == "Discord synchronisé"
