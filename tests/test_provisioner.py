import discord

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
    assert not permissions.administrator
    assert not permissions.manage_webhooks
