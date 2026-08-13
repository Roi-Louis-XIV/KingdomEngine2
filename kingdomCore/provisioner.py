"""Provisionnement idempotent des rôles, catégories et salons Discord."""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

import discord

from KingdomData import ContentStore

CATEGORY_NAME = "🏰 KINGDOM ENGINE"
ROLE_GAME_MASTER = "👑 Maître du Royaume"
ROLE_PLAYER = "⚔️ Aventurier"
ROLE_BOT = "🤖 Bots du Royaume"
AUDIT_REASON = "Installation automatique de KingdomEngine 2"


@dataclass(slots=True)
class ProvisionReport:
    created_roles: list[str]
    created_channels: list[str]
    assigned_roles: int = 0
    skipped_members: int = 0


def channel_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", normalized)).strip("-")[:80] or "royaume"


def game_master_permissions() -> discord.Permissions:
    return discord.Permissions(
        manage_channels=True, manage_roles=True, manage_messages=True,
        view_channel=True, send_messages=True,
        read_message_history=True, connect=True, speak=True,
    )


def player_permissions() -> discord.Permissions:
    return discord.Permissions(
        view_channel=True, send_messages=True, read_message_history=True, add_reactions=True,
        use_application_commands=True, connect=True, speak=True, stream=True,
    )


def managed_bot_permissions() -> discord.Permissions:
    return discord.Permissions(
        view_channel=True, send_messages=True, read_message_history=True, embed_links=True,
        attach_files=True, manage_messages=True, use_application_commands=True, connect=True,
        speak=True, use_voice_activation=True,
    )


def required_bot_permissions() -> discord.Permissions:
    value = game_master_permissions().value | player_permissions().value | managed_bot_permissions().value
    return discord.Permissions(value)


class DiscordProvisioner:
    def __init__(self, guild: discord.Guild, store: ContentStore) -> None:
        self.guild, self.store = guild, store

    async def provision(self) -> ProvisionReport:
        me = self.guild.me
        if me is None:
            raise RuntimeError("Le membre représentant le bot est introuvable dans ce serveur.")
        required = required_bot_permissions()
        missing = [name for name, enabled in required if enabled and not getattr(me.guild_permissions, name)]
        if missing:
            raise PermissionError(
                "Permissions Discord manquantes pour le bot : " + ", ".join(missing)
                + ". Générez puis ouvrez de nouveau le lien avec `python run.py invite-url`."
            )

        report = ProvisionReport([], [])
        master = await self._ensure_role(ROLE_GAME_MASTER, discord.Colour.gold(), game_master_permissions(), report)
        player = await self._ensure_role(ROLE_PLAYER, discord.Colour.blurple(), player_permissions(), report)
        bot_role = await self._ensure_role(ROLE_BOT, discord.Colour.green(), managed_bot_permissions(), report)

        private = {
            self.guild.default_role: discord.PermissionOverwrite(view_channel=False),
            master: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            player: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            bot_role: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
            me: discord.PermissionOverwrite(view_channel=True, send_messages=True, connect=True, speak=True),
        }
        category = discord.utils.get(self.guild.categories, name=CATEGORY_NAME)
        if category is None:
            category = await self.guild.create_category(CATEGORY_NAME, overwrites=private, reason=AUDIT_REASON)
            report.created_channels.append(CATEGORY_NAME)
        else:
            await category.edit(overwrites=private, reason=AUDIT_REASON)

        welcome_overwrites = dict(private)
        welcome_overwrites[self.guild.default_role] = discord.PermissionOverwrite(view_channel=True, send_messages=False, read_message_history=True)
        await self._ensure_text("bienvenue", category, welcome_overwrites, report, topic="Bienvenue dans le Royaume. Utilisez /royaume pour commencer.")
        await self._ensure_text("commandes-du-royaume", category, private, report, topic="Commandes et interactions de KingdomEngine.")
        admin_overwrites = dict(private)
        admin_overwrites[player] = discord.PermissionOverwrite(view_channel=False)
        await self._ensure_text("administration-royaume", category, admin_overwrites, report, topic="Salon privé des Maîtres du Royaume et des bots.")

        for entity in self.store.list("building", published=True):
            payload = entity["payload"]
            slug = channel_slug(payload["name"])
            await self._ensure_text(slug, category, private, report, topic=payload.get("description"))
            await self._ensure_voice(f"🔊 {payload['name']}"[:100], category, private, report)

        assigned, skipped = await self._assign_roles(master, player, bot_role)
        report.assigned_roles += assigned
        report.skipped_members += skipped
        return report

    async def _ensure_role(self, name: str, colour: discord.Colour, permissions: discord.Permissions, report: ProvisionReport) -> discord.Role:
        role = discord.utils.get(self.guild.roles, name=name)
        if role is None:
            role = await self.guild.create_role(name=name, colour=colour, permissions=permissions, hoist=True, reason=AUDIT_REASON)
            report.created_roles.append(name)
        else:
            if role >= self.guild.me.top_role:
                raise PermissionError(f"Le rôle `{name}` doit être placé sous le rôle principal du bot.")
            await role.edit(colour=colour, permissions=permissions, hoist=True, reason=AUDIT_REASON)
        return role

    async def _ensure_text(self, name: str, category: discord.CategoryChannel, overwrites: dict[Any, discord.PermissionOverwrite], report: ProvisionReport, topic: str | None = None) -> None:
        channel = discord.utils.get(category.text_channels, name=name)
        if channel is None:
            await self.guild.create_text_channel(name, category=category, overwrites=overwrites, topic=topic, reason=AUDIT_REASON)
            report.created_channels.append(f"#{name}")
        else:
            await channel.edit(overwrites=overwrites, topic=topic, sync_permissions=False, reason=AUDIT_REASON)

    async def _ensure_voice(self, name: str, category: discord.CategoryChannel, overwrites: dict[Any, discord.PermissionOverwrite], report: ProvisionReport) -> None:
        channel = discord.utils.get(category.voice_channels, name=name)
        if channel is None:
            await self.guild.create_voice_channel(name, category=category, overwrites=overwrites, reason=AUDIT_REASON)
            report.created_channels.append(name)
        else:
            await channel.edit(overwrites=overwrites, sync_permissions=False, reason=AUDIT_REASON)

    async def _assign_roles(self, master: discord.Role, player: discord.Role, bot_role: discord.Role) -> tuple[int, int]:
        assigned, skipped = 0, 0
        members = self.guild.members
        if self.guild.chunked is False:
            try: members = [member async for member in self.guild.fetch_members(limit=None)]
            except discord.HTTPException: members = self.guild.members
        for member in members:
            target = bot_role if member.bot else player
            roles = [target]
            if member.id == self.guild.owner_id: roles.append(master)
            missing = [role for role in roles if role not in member.roles]
            if missing:
                try:
                    await member.add_roles(*missing, reason=AUDIT_REASON)
                    assigned += len(missing)
                except discord.Forbidden:
                    # Discord protège notamment le propriétaire et les membres
                    # dont le rôle est supérieur à celui du bot.
                    skipped += 1
                    print(f"⚠️ Attribution ignorée pour {member} : hiérarchie Discord.")
        return assigned, skipped


class ProvisionClient(discord.Client):
    def __init__(self, store: ContentStore, guild_id: int) -> None:
        intents = discord.Intents.default(); intents.members = True
        super().__init__(intents=intents)
        self.store, self.guild_id = store, guild_id

    async def on_ready(self) -> None:
        try:
            guild = self.get_guild(self.guild_id)
            if guild is None: raise RuntimeError(f"Le bot n’est pas membre du serveur {self.guild_id}.")
            report = await DiscordProvisioner(guild, self.store).provision()
            print(f"✅ Provisionnement terminé : {len(report.created_roles)} rôle(s), {len(report.created_channels)} salon(s) créés, {report.assigned_roles} attribution(s), {report.skipped_members} membre(s) protégé(s).")
        except Exception as error:
            print(f"❌ Provisionnement impossible : {error}")
        finally:
            await self.close()


def run_provisioning(store: ContentStore) -> None:
    guild_id = int(os.getenv("KINGDOM_GUILD_ID", "0") or 0)
    token = os.getenv("KINGDOM_CORE_TOKEN", "")
    if not guild_id: raise RuntimeError("KINGDOM_GUILD_ID doit contenir l’identifiant du serveur Discord.")
    if not token: raise RuntimeError("KINGDOM_CORE_TOKEN est absent du fichier .env.")
    ProvisionClient(store, guild_id).run(token)
