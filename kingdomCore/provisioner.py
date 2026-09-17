"""Provisionnement Discord idempotent et entièrement piloté par KingdomData."""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

import discord

from KingdomData import ContentStore, get_server_settings

ROLE_GAME_MASTER = "👑 Roi"
ROLE_PLAYER = "⚔️ Habitant du Royaume"
ROLE_BOT = "🤖 Bots du Royaume"
AUDIT_REASON = "Installation automatique de KingdomEngine 2"
OATH_CUSTOM_ID = "ke2:oath"


def building_role_name(settings: dict[str, Any], building_key: str, payload: dict[str, Any]) -> str:
    """Nom déterministe du rôle temporaire donnant accès au texte d'un bâtiment."""
    template = settings["discord"].get("building_role_template", "🏠 Accès · {name}")
    return str(template).format(
        name=payload["name"], key=building_key, emoji=payload.get("emoji", "🏰")
    ).strip()[:100]


def find_player_role(guild: discord.Guild, configured_name: str) -> discord.Role | None:
    """Retrouve le rôle joueur configuré ou son équivalent médiéval historique."""
    exact = discord.utils.get(guild.roles, name=configured_name)
    if exact is not None:
        return exact
    def normalized(value: str) -> str:
        ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().casefold()
        return " ".join(re.findall(r"[a-z0-9]+", ascii_value))
    configured_normalized = normalized(configured_name)
    equivalent = next((role for role in guild.roles if normalized(role.name) == configured_normalized), None)
    if equivalent is not None:
        return equivalent
    for name in (
        "Habitant du Royaume", "Habitants du Royaume", "Habitant", "Habitants",
        "⚔️ Habitant du Royaume", "⚔️ Habitants du Royaume", "⚔️ Habitants",
    ):
        role = discord.utils.get(guild.roles, name=name)
        if role is not None:
            return role
    return None


def message_is_oath(message: discord.Message, onboarding: dict[str, Any]) -> bool:
    """Reconnaît aussi les anciens messages dont le bouton avait un ID aléatoire."""
    return (
        any(getattr(child, "custom_id", None) == OATH_CUSTOM_ID for row in message.components for child in row.children)
        or any(getattr(embed, "title", None) == onboarding["title"] for embed in message.embeds)
        or any(getattr(child, "label", None) == onboarding["button_label"] for row in message.components for child in row.children)
    )


@dataclass(slots=True)
class ProvisionReport:
    created_roles: list[str]
    created_channels: list[str]
    assigned_roles: int = 0
    skipped_members: int = 0


@dataclass(slots=True)
class UninstallReport:
    removed_voice_bots: list[str]
    removed_channels: list[str]
    removed_roles: list[str]
    preserved_channels: list[str]


def channel_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", normalized)).strip("-")[:80] or "royaume"


def game_master_permissions() -> discord.Permissions:
    return discord.Permissions(
        manage_channels=True, manage_roles=True, manage_messages=True,
        view_channel=True, send_messages=True, read_message_history=True,
        connect=True, speak=True,
    )


def player_permissions() -> discord.Permissions:
    return discord.Permissions(
        view_channel=True, send_messages=True, read_message_history=True, add_reactions=True,
        use_application_commands=False, connect=True, speak=True, stream=True,
    )


def managed_bot_permissions() -> discord.Permissions:
    return discord.Permissions(
        view_channel=True, send_messages=True, read_message_history=True, embed_links=True,
        attach_files=True, manage_messages=True, use_application_commands=False, connect=True,
        speak=True, use_voice_activation=True, change_nickname=True,
    )


def required_bot_permissions() -> discord.Permissions:
    value = game_master_permissions().value | player_permissions().value | managed_bot_permissions().value
    permissions = discord.Permissions(value)
    permissions.kick_members = True
    return permissions


class DiscordProvisioner:
    def __init__(self, guild: discord.Guild, store: ContentStore) -> None:
        self.guild, self.store = guild, store
        self.settings = get_server_settings(store)

    async def provision(self) -> ProvisionReport:
        me = self.guild.me
        if me is None:
            raise RuntimeError("Le membre représentant le bot est introuvable dans ce serveur.")
        missing = [name for name, enabled in required_bot_permissions() if enabled and not getattr(me.guild_permissions, name)]
        if missing:
            raise PermissionError(
                "Permissions Discord manquantes pour le bot : " + ", ".join(missing)
                + ". Générez puis ouvrez de nouveau le lien avec `python run.py invite-url`."
            )

        report = ProvisionReport([], [])
        role_names = self.settings["roles"]
        master = await self._ensure_role(role_names["game_master"], discord.Colour.gold(), game_master_permissions(), report)
        player = find_player_role(self.guild, role_names["player"])
        if player is None:
            player = await self._ensure_role(
                role_names["player"], discord.Colour.dark_red(), player_permissions(), report
            )
        else:
            if player >= me.top_role:
                raise PermissionError(
                    f"Le rôle `{player.name}` doit être placé sous le rôle principal du bot."
                )
            # Conserve le nom choisi sur un serveur historique, notamment
            # « Habitant du Royaume », tout en synchronisant ses permissions.
            await player.edit(
                colour=discord.Colour.dark_red(),
                permissions=player_permissions(),
                hoist=True,
                reason=AUDIT_REASON,
            )
        bot_role = await self._ensure_role(role_names["bot"], discord.Colour.green(), managed_bot_permissions(), report)

        general_overwrites = self._general_overwrites(master, player, bot_role, me)
        discord_settings = self.settings["discord"]
        general = await self._ensure_category(discord_settings["general_category"][:100], general_overwrites, report)

        welcome_overwrites = dict(general_overwrites)
        welcome_overwrites[self.guild.default_role] = discord.PermissionOverwrite(view_channel=True, send_messages=False, read_message_history=True)
        await self._ensure_text(discord_settings["welcome_channel"], general, welcome_overwrites, report, "Bienvenue dans le Royaume.")
        await self._ensure_text(discord_settings["commands_channel"], general, general_overwrites, report, "Commandes et interactions de KingdomEngine.")
        admin_overwrites = dict(general_overwrites)
        admin_overwrites[player] = discord.PermissionOverwrite(view_channel=False)
        await self._ensure_text(discord_settings["administration_channel"], general, admin_overwrites, report, "Salon privé des Maîtres du Royaume et des bots.")
        if self.settings["onboarding"].get("enabled", True):
            await self._provision_oath(general, master, player, bot_role, me, report)

        for entity in self.store.list("building", published=True):
            if entity["payload"].get("is_reference"):
                # Nettoie aussi les salons créés par les anciennes versions où
                # l'Atelier-école était encore considéré comme un vrai lieu.
                await self.remove_building_channels(entity["entity_key"], entity["payload"])
                continue
            await self._provision_building(entity, master, player, bot_role, me, report)

        assigned, skipped = await self._assign_privileged_roles(master, bot_role)
        report.assigned_roles += assigned
        report.skipped_members += skipped
        return report

    async def uninstall(self) -> UninstallReport:
        """Retire uniquement les ressources déterministes gérées par KingdomEngine."""
        me = self.guild.me
        if me is None:
            raise RuntimeError("Le membre représentant KingdomCore est introuvable.")
        required = ("manage_channels", "manage_roles", "kick_members")
        missing = [name for name in required if not getattr(me.guild_permissions, name, False)]
        if missing:
            raise PermissionError("Permissions Discord manquantes pour la désinstallation : " + ", ".join(missing))

        report = UninstallReport([], [], [], [])
        voice_application_ids: set[int] = set()
        for entity in self.store.list("bot", published=True):
            configuration = entity["payload"]
            if configuration.get("bot_type") != "voice":
                continue
            variable = str(configuration.get("application_id_env", "")).strip()
            if not variable:
                token_variable = str(configuration.get("token_env", ""))
                variable = token_variable.removesuffix("_BOT_TOKEN") + "_APPLICATION_ID" if token_variable.endswith("_BOT_TOKEN") else ""
            application_id = str(os.getenv(variable, configuration.get("application_id", ""))).strip()
            if application_id.isdigit():
                voice_application_ids.add(int(application_id))

        for member in list(self.guild.members):
            if member.id not in voice_application_ids:
                continue
            await member.kick(reason="Désinstallation de KingdomEngine 2")
            report.removed_voice_bots.append(str(member))

        for entity in self.store.list("building", published=True):
            report.removed_channels.extend(await self.remove_building_channels(entity["entity_key"], entity["payload"]))

        discord_settings = self.settings["discord"]
        general = discord.utils.get(self.guild.categories, name=discord_settings["general_category"][:100])
        if general is not None:
            managed_names = {
                channel_slug(discord_settings["welcome_channel"]),
                channel_slug(discord_settings["commands_channel"]),
                channel_slug(discord_settings["administration_channel"]),
                channel_slug(self.settings["onboarding"]["channel_name"]),
            }
            for channel in list(general.channels):
                if channel.name in managed_names:
                    await channel.delete(reason="Désinstallation de KingdomEngine 2")
                    report.removed_channels.append(channel.name)
                else:
                    report.preserved_channels.append(channel.name)
            if not report.preserved_channels:
                await general.delete(reason="Désinstallation de KingdomEngine 2")
                report.removed_channels.append(general.name)

        for role_name in dict.fromkeys(self.settings["roles"].values()):
            role = discord.utils.get(self.guild.roles, name=role_name)
            if role is None:
                continue
            if role >= me.top_role:
                raise PermissionError(f"Le rôle `{role_name}` doit être placé sous KingdomCore avant la désinstallation.")
            await role.delete(reason="Désinstallation de KingdomEngine 2")
            report.removed_roles.append(role.name)
        return report

    async def remove_building_channels(self, building_key: str, payload: dict[str, Any]) -> list[str]:
        """Supprime uniquement les salons déterministes gérés pour un bâtiment supprimé."""
        template = self.settings["discord"]["building_category_template"]
        category_name = template.format(name=payload["name"], key=building_key, emoji=payload.get("emoji", "🏰")).strip()[:100]
        category = discord.utils.get(self.guild.categories, name=category_name)
        building_role = discord.utils.get(
            getattr(self.guild, "roles", []),
            name=building_role_name(self.settings, building_key, payload),
        )
        guild_member = getattr(self.guild, "me", None)
        if building_role is not None and guild_member is not None and building_role < guild_member.top_role:
            await building_role.delete(reason=f"Suppression du bâtiment KingdomEngine : {building_key}")
        if category is None:
            with self.store.connection() as db:
                db.execute("DELETE FROM building_discord_channels WHERE building_key=?", (building_key,))
            return []
        text_name = channel_slug(self.settings["discord"]["building_text_channel"].format(name=payload["name"], key=building_key))
        voice_name = self.settings["discord"]["building_voice_channel_template"].format(name=payload["name"], key=building_key).strip()[:100]
        removed: list[str] = []
        managed = [
            next((channel for channel in category.text_channels if channel.name == text_name), None),
            next((channel for channel in category.voice_channels if channel.name == voice_name), None),
        ]
        removed_ids = set()
        for channel in managed:
            if channel is None:
                continue
            removed_ids.add(channel.id)
            removed.append(channel.name)
            await channel.delete(reason=f"Suppression du bâtiment KingdomEngine : {building_key}")
        # Une catégorie contenant un salon ajouté manuellement est conservée.
        remaining = [channel for channel in category.channels if channel.id not in removed_ids]
        if not remaining:
            await category.delete(reason=f"Suppression du bâtiment KingdomEngine : {building_key}")
            removed.append(category.name)
        with self.store.connection() as db:
            db.execute("DELETE FROM building_discord_channels WHERE building_key=?", (building_key,))
        return removed

    async def remove_mapped_building_channels(self, building_key: str) -> list[str]:
        """Retire un bâtiment déjà supprimé en s'appuyant sur ses IDs gérés."""
        with self.store.connection() as db:
            mapping = db.execute(
                "SELECT category_id,text_channel_id,voice_channel_id FROM building_discord_channels WHERE building_key=?",
                (building_key,),
            ).fetchone()
        if not mapping:
            return []
        removed: list[str] = []
        category = self.guild.get_channel(int(mapping["category_id"])) if str(mapping["category_id"]).isdigit() else None
        managed_ids = {int(mapping[field]) for field in ("text_channel_id", "voice_channel_id") if str(mapping[field]).isdigit()}
        category_can_be_removed = category is not None and not any(channel.id not in managed_ids for channel in category.channels)
        for field in ("text_channel_id", "voice_channel_id"):
            channel = self.guild.get_channel(int(mapping[field])) if str(mapping[field]).isdigit() else None
            if channel is not None:
                removed.append(channel.name)
                await channel.delete(reason=f"Suppression du bâtiment KingdomEngine : {building_key}")
        if category_can_be_removed:
            removed.append(category.name)
            await category.delete(reason=f"Suppression du bâtiment KingdomEngine : {building_key}")
        with self.store.connection() as db:
            db.execute("DELETE FROM building_discord_channels WHERE building_key=?", (building_key,))
        return removed

    def _general_overwrites(self, master: discord.Role, player: discord.Role, bot_role: discord.Role, me: discord.Member) -> dict[Any, discord.PermissionOverwrite]:
        return {
            self.guild.default_role: discord.PermissionOverwrite(view_channel=False),
            master: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            player: discord.PermissionOverwrite(
                view_channel=True, send_messages=True, connect=True, speak=True,
                use_application_commands=False,
            ),
            bot_role: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            me: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
        }

    async def _provision_oath(self, category: discord.CategoryChannel, master: discord.Role, player: discord.Role, bot_role: discord.Role, me: discord.Member, report: ProvisionReport) -> None:
        onboarding = self.settings["onboarding"]
        overwrites = {
            self.guild.default_role: discord.PermissionOverwrite(view_channel=True, send_messages=False, read_message_history=True),
            master: discord.PermissionOverwrite(view_channel=True, send_messages=True),
            player: discord.PermissionOverwrite(view_channel=True, send_messages=False),
            bot_role: discord.PermissionOverwrite(view_channel=True, send_messages=True),
            me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
        }
        channel = await self._ensure_text(onboarding["channel_name"], category, overwrites, report, onboarding["title"])
        oath_message: discord.Message | None = None
        try:
            async for message in channel.history(limit=50):
                if message_is_oath(message, onboarding):
                    oath_message = message
                    break
        except discord.HTTPException:
            pass
        embed = discord.Embed(
            title=onboarding["title"], description=onboarding["rules_text"],
            color=int(self.settings["theme"]["primary_color"].lstrip("#"), 16),
        )
        view = discord.ui.View(timeout=None)
        view.add_item(discord.ui.Button(
            label=str(onboarding["button_label"])[:80], emoji=onboarding.get("button_emoji") or None,
            style=discord.ButtonStyle.success, custom_id=OATH_CUSTOM_ID,
        ))
        if oath_message is None:
            await channel.send(embed=embed, view=view)
        else:
            await oath_message.edit(embed=embed, view=view)

    async def _provision_building(self, entity: dict[str, Any], master: discord.Role, player: discord.Role, bot_role: discord.Role, me: discord.Member, report: ProvisionReport) -> None:
        payload = entity["payload"]
        access = payload.get("access", {})
        if access.get("visible", True) is False:
            return
        required_roles = [str(name).strip() for name in access.get("required_roles", []) if str(name).strip()]
        allowed_roles = [role for name in required_roles if (role := discord.utils.get(self.guild.roles, name=name))]
        building_role = await self._ensure_role(
            building_role_name(self.settings, entity["entity_key"], payload),
            discord.Colour.dark_green(), discord.Permissions.none(), report, hoist=False,
        )
        base_access = not required_roles
        category_overwrites: dict[Any, discord.PermissionOverwrite] = {
            self.guild.default_role: discord.PermissionOverwrite(view_channel=False),
            master: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            player: discord.PermissionOverwrite(
                view_channel=base_access, connect=base_access, speak=base_access,
                use_application_commands=False,
            ),
            bot_role: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            me: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            building_role: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True),
        }
        for role in allowed_roles:
            category_overwrites[role] = discord.PermissionOverwrite(view_channel=True, connect=True, speak=True)
        template = self.settings["discord"]["building_category_template"]
        category_name = template.format(
            name=payload["name"], key=entity["entity_key"], emoji=payload.get("emoji", "🏰")
        ).strip()[:100]
        category = await self._ensure_category(category_name, category_overwrites, report)

        text_overwrites = dict(category_overwrites)
        temporary_text = access.get("temporary_text", self.settings["discord"].get("temporary_text_access", True))
        text_overwrites[player] = discord.PermissionOverwrite(
            view_channel=base_access and not temporary_text,
            send_messages=base_access and not temporary_text,
            read_message_history=base_access and not temporary_text,
            use_application_commands=False,
        )
        text_overwrites[building_role] = discord.PermissionOverwrite(
            view_channel=True, send_messages=True, read_message_history=True,
            use_application_commands=False,
        )
        for role in allowed_roles:
            text_overwrites[role] = discord.PermissionOverwrite(
                view_channel=not temporary_text, send_messages=not temporary_text,
                read_message_history=not temporary_text,
            )
        text_name = self.settings["discord"]["building_text_channel"].format(name=payload["name"], key=entity["entity_key"])
        text_channel = await self._ensure_text(text_name, category, text_overwrites, report, payload.get("description"))
        voice_name = self.settings["discord"]["building_voice_channel_template"].format(
            name=payload["name"], key=entity["entity_key"]
        ).strip()
        voice_channel = await self._ensure_voice(voice_name[:100], category, category_overwrites, report)
        with self.store.connection() as db:
            db.execute(
                "INSERT INTO building_discord_channels(building_key,category_id,text_channel_id,voice_channel_id,updated_at) VALUES(?,?,?,?,datetime('now')) "
                "ON CONFLICT(building_key) DO UPDATE SET category_id=excluded.category_id,text_channel_id=excluded.text_channel_id,voice_channel_id=excluded.voice_channel_id,updated_at=excluded.updated_at",
                (entity["entity_key"], str(category.id), str(text_channel.id), str(voice_channel.id)),
            )

    async def _ensure_role(self, name: str, colour: discord.Colour, permissions: discord.Permissions, report: ProvisionReport, *, hoist: bool = True) -> discord.Role:
        role = discord.utils.get(self.guild.roles, name=name)
        if role is None:
            role = await self.guild.create_role(name=name, colour=colour, permissions=permissions, hoist=hoist, reason=AUDIT_REASON)
            report.created_roles.append(name)
        else:
            if role >= self.guild.me.top_role:
                raise PermissionError(f"Le rôle `{name}` doit être placé sous le rôle principal du bot.")
            await role.edit(colour=colour, permissions=permissions, hoist=hoist, reason=AUDIT_REASON)
        return role

    async def _ensure_category(self, name: str, overwrites: dict[Any, discord.PermissionOverwrite], report: ProvisionReport) -> discord.CategoryChannel:
        category = discord.utils.get(self.guild.categories, name=name)
        if category is None:
            category = await self.guild.create_category(name, overwrites=overwrites, reason=AUDIT_REASON)
            report.created_channels.append(name)
        else:
            await category.edit(overwrites=overwrites, reason=AUDIT_REASON)
        return category

    async def _ensure_text(self, name: str, category: discord.CategoryChannel, overwrites: dict[Any, discord.PermissionOverwrite], report: ProvisionReport, topic: str | None = None) -> discord.TextChannel:
        slug = channel_slug(name)
        channel = discord.utils.get(category.text_channels, name=slug)
        if channel is None:
            channel = await self.guild.create_text_channel(slug, category=category, overwrites=overwrites, topic=topic, reason=AUDIT_REASON)
            report.created_channels.append(f"#{slug}")
        else:
            await channel.edit(overwrites=overwrites, topic=topic, sync_permissions=False, reason=AUDIT_REASON)
        return channel

    async def _ensure_voice(self, name: str, category: discord.CategoryChannel, overwrites: dict[Any, discord.PermissionOverwrite], report: ProvisionReport) -> discord.VoiceChannel:
        channel = discord.utils.get(category.voice_channels, name=name)
        if channel is None:
            channel = await self.guild.create_voice_channel(name, category=category, overwrites=overwrites, reason=AUDIT_REASON)
            report.created_channels.append(name)
        else:
            await channel.edit(overwrites=overwrites, sync_permissions=False, reason=AUDIT_REASON)
        return channel

    async def _assign_privileged_roles(self, master: discord.Role, bot_role: discord.Role) -> tuple[int, int]:
        """Le rôle joueur n'est jamais automatique : il est accordé par le serment."""
        assigned, skipped = 0, 0
        members = self.guild.members
        if self.guild.chunked is False:
            try:
                members = [member async for member in self.guild.fetch_members(limit=None)]
            except discord.HTTPException:
                members = self.guild.members
        for member in members:
            roles: list[discord.Role] = []
            if member.bot:
                roles.append(bot_role)
            if member.id == self.guild.owner_id:
                roles.append(master)
            missing = [role for role in roles if role not in member.roles]
            if not missing:
                continue
            try:
                await member.add_roles(*missing, reason=AUDIT_REASON)
                assigned += len(missing)
            except discord.Forbidden:
                skipped += 1
        return assigned, skipped


class ProvisionClient(discord.Client):
    def __init__(self, store: ContentStore, guild_id: int) -> None:
        intents = discord.Intents.default()
        intents.members = True
        super().__init__(intents=intents)
        self.store, self.guild_id = store, guild_id

    async def on_ready(self) -> None:
        try:
            guild = self.get_guild(self.guild_id)
            if guild is None:
                raise RuntimeError(f"Le bot n'est pas membre du serveur {self.guild_id}.")
            report = await DiscordProvisioner(guild, self.store).provision()
            print(f"✅ Provisionnement terminé : {len(report.created_roles)} rôle(s), {len(report.created_channels)} salon(s) créés, {report.assigned_roles} attribution(s), {report.skipped_members} membre(s) protégé(s).")
        except Exception as error:
            print(f"❌ Provisionnement impossible : {error}")
        finally:
            await self.close()


def run_provisioning(store: ContentStore) -> None:
    guild_id = int(os.getenv("KINGDOM_GUILD_ID", "0") or 0)
    token = os.getenv("KINGDOM_CORE_TOKEN", "")
    if not guild_id:
        raise RuntimeError("KINGDOM_GUILD_ID doit contenir l'identifiant du serveur Discord.")
    if not token:
        raise RuntimeError("KINGDOM_CORE_TOKEN est absent du fichier .env.")
    ProvisionClient(store, guild_id).run(token)
