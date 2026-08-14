import discord
from types import SimpleNamespace

from KingdomData import ContentStore
from kingdomCore.discord_bot import building_for_voice
from kingdomCore.provisioner import channel_slug, required_bot_permissions


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
