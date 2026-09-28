import discord
import asyncio
from types import SimpleNamespace

from KingdomData import ContentStore
from kingdomCore.discord_bot import building_for_voice, managed_store_for_guild, set_text_access
from kingdomCore.provisioner import (
    DiscordProvisioner,
    OATH_CUSTOM_ID,
    building_role_name,
    channel_slug,
    find_player_role,
    message_is_oath,
    required_bot_permissions,
)


def test_channel_slug_is_discord_safe():
    assert channel_slug("Forêt Royale") == "foret-royale"
    assert channel_slug("  La Forge Dorée ! ") == "la-forge-doree"
    assert channel_slug("🏰") == "royaume"


def test_legacy_oath_message_is_recognized_for_automatic_button_repair():
    onboarding = {"title": "Bienvenue dans la station", "button_label": "Rejoindre l'équipage"}
    legacy = SimpleNamespace(
        embeds=[SimpleNamespace(title="Bienvenue dans la station")],
        components=[SimpleNamespace(children=[SimpleNamespace(custom_id="ancien-id", label="Rejoindre l'équipage")])],
    )
    current = SimpleNamespace(
        embeds=[],
        components=[SimpleNamespace(children=[SimpleNamespace(custom_id=OATH_CUSTOM_ID, label="Continuer")])],
    )
    unrelated = SimpleNamespace(embeds=[], components=[])
    assert message_is_oath(legacy, onboarding)
    assert message_is_oath(current, onboarding)
    assert not message_is_oath(unrelated, onboarding)


def test_invited_bot_gets_only_required_management_permissions():
    permissions = required_bot_permissions()
    assert permissions.manage_roles
    assert permissions.manage_channels
    assert permissions.manage_messages
    assert permissions.embed_links and permissions.attach_files
    assert permissions.kick_members
    assert not permissions.ban_members
    assert not permissions.moderate_members
    assert permissions.connect and permissions.speak
    assert not permissions.use_application_commands
    assert not permissions.administrator
    assert not permissions.manage_webhooks


def test_historic_kingdom_resident_role_is_reused_for_oath():
    resident = SimpleNamespace(name="Habitant du Royaume")
    guild = SimpleNamespace(roles=[SimpleNamespace(name="@everyone"), resident])
    assert find_player_role(guild, "⚔️ Habitants") is resident


def test_unmanageable_historic_player_role_does_not_block_server_installation(tmp_path):
    class Role:
        def __init__(self, name, position): self.name, self.position = name, position
        def __ge__(self, other): return self.position >= other.position
        def __lt__(self, other): return self.position < other.position
        async def edit(self, **_kwargs): raise AssertionError("Le rôle historique protégé ne doit pas être modifié")

    class Guild:
        me = SimpleNamespace(top_role=Role("KingdomCore", 5))
        roles = [Role("Habitant du Royaume", 10)]
        async def create_role(self, **kwargs):
            role = Role(kwargs["name"], 1)
            self.roles.append(role)
            return role

    store = ContentStore(tmp_path / "protected-player-role.db")
    store.initialize()
    guild = Guild()
    provisioner = DiscordProvisioner(guild, store)
    report = SimpleNamespace(created_roles=[])

    player = asyncio.run(provisioner._ensure_player_role("👤 Participant", report))

    assert player.name == "👤 Participant"
    assert player.position < guild.me.top_role.position
    assert report.created_roles == ["👤 Participant"]


def test_configured_player_role_above_core_uses_a_separate_managed_role(tmp_path):
    class Role:
        def __init__(self, name, position): self.name, self.position = name, position
        def __ge__(self, other): return self.position >= other.position
        def __lt__(self, other): return self.position < other.position
        async def edit(self, **_kwargs): raise AssertionError("Le rôle protégé ne doit pas être modifié")

    class Guild:
        me = SimpleNamespace(top_role=Role("KingdomCore", 5))
        roles = [Role("Habitant du Royaume", 10)]
        async def create_role(self, **kwargs):
            role = Role(kwargs["name"], 1)
            self.roles.append(role)
            return role

    store = ContentStore(tmp_path / "same-name-protected-role.db")
    store.initialize()
    guild = Guild()
    provisioner = DiscordProvisioner(guild, store)
    report = SimpleNamespace(created_roles=[])

    player = asyncio.run(provisioner._ensure_player_role("Habitant du Royaume", report))

    assert player.name == "Habitant du Royaume · KingdomEngine"
    assert player.position < guild.me.top_role.position
    assert report.created_roles == [player.name]


def test_building_access_role_name_is_data_driven():
    settings = {"discord": {"building_role_template": "🔑 {name} · {key}"}}
    assert building_role_name(settings, "forge", {"name": "Forge Dorée", "emoji": "⚒️"}) == "🔑 Forge Dorée · forge"


def test_voice_presence_grants_then_removes_building_role():
    role = SimpleNamespace(name="🏠 Accès · Forge Dorée")
    overwrites = []

    class TextChannel:
        name = "forge-doree"

        async def set_permissions(self, member, overwrite=None, reason=None):
            overwrites.append(overwrite)

    category = SimpleNamespace(name="🏰 Forge Dorée", text_channels=[TextChannel()])

    class Member:
        def __init__(self):
            self.roles = []
            self.guild = SimpleNamespace(roles=[role], categories=[category])

        async def add_roles(self, selected, reason=None):
            self.roles.append(selected)

        async def remove_roles(self, selected, reason=None):
            self.roles.remove(selected)

    member = Member()
    settings = {
        "discord": {
            "building_role_template": "🏠 Accès · {name}",
            "building_category_template": "🏰 {name}",
            "building_text_channel": "{name}",
            "temporary_text_access": True,
        }
    }
    entity = {"entity_key": "forge", "payload": {"name": "Forge Dorée", "emoji": "⚒️", "access": {}}}

    asyncio.run(set_text_access(member, entity, settings, True, category))
    assert member.roles == [role]
    assert overwrites[-1] is None

    asyncio.run(set_text_access(member, entity, settings, False, category))
    assert member.roles == []
    assert overwrites[-1] is None


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


def test_provisioned_voice_channel_is_linked_by_persisted_id_after_rename(tmp_path):
    store = ContentStore(tmp_path / "mapped-voice.db")
    store.initialize()
    draft = store.save("building", "forge", {"name": "Forge", "emoji": "⚒️", "actions": []})
    store.publish("building", "forge", draft["version"])
    with store.connection() as database:
        database.execute(
            "INSERT INTO building_discord_channels VALUES('forge','10','11','42',datetime('now'))"
        )
    renamed_channel = SimpleNamespace(
        id=42,
        name="atelier-renomme-manuellement",
        category=SimpleNamespace(name="Catégorie personnalisée"),
    )

    assert building_for_voice(store, renamed_channel)["entity_key"] == "forge"


def test_discord_event_uses_the_database_owned_by_its_guild(tmp_path):
    primary = ContentStore(tmp_path / "kingdom.db")
    world = ContentStore(tmp_path / "servers" / "second-world.db")
    primary.initialize()
    world.initialize()
    with primary.connection() as database:
        database.execute(
            "CREATE TABLE managed_servers(slug TEXT,name TEXT,guild_id TEXT,database_path TEXT,"
            "bot_installed INTEGER,active INTEGER,created_at TEXT)"
        )
        database.execute(
            "INSERT INTO managed_servers(slug,name,guild_id,database_path,bot_installed,active,created_at) "
            "VALUES(?,?,?,?,1,1,datetime('now'))",
            ("second-world", "Second World", "9876", str(world.path)),
        )

    selected = managed_store_for_guild(primary, 9876)

    assert selected.path.resolve() == world.path.resolve()
    assert managed_store_for_guild(primary, 1234) is primary


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


def test_deleted_definition_is_removed_from_discord_using_persisted_channel_ids(tmp_path):
    deleted = []
    class Channel:
        def __init__(self, channel_id, name): self.id, self.name, self.channels = channel_id, name, []
        async def delete(self, reason=None): deleted.append(self.name)
    text, voice, category = Channel(11, "forge"), Channel(12, "Forge"), Channel(10, "⚒️ Forge")
    category.channels = [text, voice]
    channels = {10: category, 11: text, 12: voice}
    guild = SimpleNamespace(get_channel=lambda channel_id: channels.get(channel_id))
    store = ContentStore(tmp_path / "mapped-cleanup.db"); store.initialize()
    with store.connection() as database:
        database.execute("INSERT INTO building_discord_channels VALUES('forge','10','11','12',datetime('now'))")

    removed = asyncio.run(DiscordProvisioner(guild, store).remove_mapped_building_channels("forge"))

    assert removed == ["forge", "Forge", "⚒️ Forge"]
    assert deleted == removed
    assert store.building_channels("forge") == {}


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


def test_discord_uninstall_uses_the_persistent_provision_queue(tmp_path):
    store = ContentStore(tmp_path / "discord-uninstall.db")
    store.initialize()
    request_id = store.request_discord_provision("uninstall", requested_by="test")
    claimed = store.pending_discord_provision()
    assert claimed[0]["id"] == request_id
    assert claimed[0]["scope"] == "uninstall"
    store.finish_discord_provision(request_id, report="Discord désinstallé")
    assert store.discord_provision_status()["report"] == "Discord désinstallé"


def test_uninstall_kicks_platform_voice_workers_even_when_world_catalog_is_incomplete(tmp_path, monkeypatch):
    store = ContentStore(tmp_path / "uninstall-workers.db")
    store.initialize()
    kicked = []

    class Member:
        def __init__(self, member_id): self.id, self.member_id = member_id, member_id
        async def kick(self, reason=None): kicked.append((self.member_id, reason))
        def __str__(self): return f"worker-{self.id}"

    class BotMember:
        guild_permissions = SimpleNamespace(manage_channels=True, manage_roles=True, kick_members=True)
        top_role = SimpleNamespace()

    monkeypatch.setenv("VOICE_WORKER_1_APPLICATION_ID", "501")
    monkeypatch.setenv("VOICE_WORKER_2_APPLICATION_ID", "502")
    monkeypatch.setenv("EDGAR_APPLICATION_ID", "501")
    guild = SimpleNamespace(
        me=BotMember(), members=[Member(501), Member(502), Member(999)],
        categories=[], roles=[],
    )

    report = asyncio.run(DiscordProvisioner(guild, store).uninstall())

    assert [member_id for member_id, _reason in kicked] == [501, 502]
    assert report.removed_voice_bots == ["worker-501", "worker-502"]
