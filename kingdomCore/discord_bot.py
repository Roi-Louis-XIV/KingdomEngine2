"""Bot Discord dont l'accueil, les accès et les interfaces viennent de KingdomData."""

from __future__ import annotations

import os
import logging
from typing import Any

import discord
from discord.ext import commands

from KingdomData import ContentStore, get_server_settings, interface_from_building
from kingdomEvent import EventBus
from import_v1 import import_v1
from seed import DEFINITIONS
from .engine import GameEngine
from .provisioner import OATH_CUSTOM_ID, channel_slug


logger = logging.getLogger(__name__)


class BuildingView(discord.ui.View):
    """Repli compatible pour les anciens bâtiments sans interface visuelle."""

    def __init__(self, engine: GameEngine, building_key: str, actions: list[dict[str, Any]]):
        super().__init__(timeout=180)
        self.engine, self.building_key, self.actions, self.page = engine, building_key, actions, 0
        self._render()

    def _render(self) -> None:
        self.clear_items()
        page_size = 23
        start = self.page * page_size
        for action in self.actions[start:start + page_size]:
            button = discord.ui.Button(
                label=str(action.get("name", action["key"]))[:80], emoji=action.get("emoji"),
                custom_id=f"ke2:{self.building_key}:{action['key']}", disabled=not action.get("enabled", True),
            )

            async def callback(interaction: discord.Interaction, key: str = action["key"]):
                await execute_action(self.engine, interaction, self.building_key, key)

            button.callback = callback
            self.add_item(button)
        pages = (len(self.actions) + page_size - 1) // page_size
        if pages > 1:
            previous = discord.ui.Button(label="Page précédente", emoji="◀️", disabled=self.page == 0, row=4)
            following = discord.ui.Button(label=f"Page {self.page + 1}/{pages}", emoji="▶️", disabled=self.page >= pages - 1, row=4)

            async def previous_callback(interaction: discord.Interaction):
                self.page -= 1
                self._render()
                await interaction.response.edit_message(view=self)

            async def following_callback(interaction: discord.Interaction):
                self.page += 1
                self._render()
                await interaction.response.edit_message(view=self)

            previous.callback, following.callback = previous_callback, following_callback
            self.add_item(previous)
            self.add_item(following)


def interaction_context(interaction: discord.Interaction) -> dict[str, Any]:
    member = interaction.user if isinstance(interaction.user, discord.Member) else None
    return {
        "roles": [role.name for role in member.roles] if member else [],
        "voice_channel_id": member.voice.channel.id if member and member.voice and member.voice.channel else None,
        "guild_id": interaction.guild_id,
    }


async def execute_action(engine: GameEngine, interaction: discord.Interaction, building: str, action: str) -> None:
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        result = await engine.execute(str(interaction.user.id), building, action, str(interaction.id), interaction_context(interaction))
        await interaction.followup.send("\n".join(result["messages"]) or "Action effectuée.", ephemeral=True)
    except Exception as exc:
        await interaction.followup.send(str(exc), ephemeral=True)


class InterfaceView(discord.ui.View):
    """Rend les pages, boutons et menus produits par le constructeur KingdomWeb."""

    def __init__(
        self,
        engine: GameEngine,
        definition: dict[str, Any],
        page_key: str | None = None,
        owner_id: int | None = None,
    ):
        super().__init__(timeout=300)
        self.engine, self.definition = engine, definition
        self.page_key = page_key or definition["start_page"]
        self.owner_id = owner_id
        self.notice = ""
        self._render_interactions()

    @property
    def page(self) -> dict[str, Any]:
        return next(page for page in self.definition["pages"] if page["key"] == self.page_key)

    def embed(self) -> discord.Embed:
        theme = self.definition.get("theme", {})
        try:
            color = int(str(theme.get("color", "7a1f1f")).lstrip("#"), 16)
        except ValueError:
            color = 0x7A1F1F
        embed = discord.Embed(title=self.page.get("name", self.definition["name"]), color=color)
        descriptions: list[str] = []
        field_count = 0
        if self.notice:
            descriptions.append(f"**{self.notice}**")
        for component in self._visible_components():
            props = component.get("props", {})
            if component["type"] == "hero":
                embed.title = f"{props.get('emoji', '')} {props.get('title', '')}".strip()
                if props.get("subtitle"):
                    descriptions.append(str(props["subtitle"]))
            elif component["type"] == "text" and props.get("text"):
                descriptions.append(str(props["text"]))
            elif component["type"] in {"card", "stat"} and field_count < 25:
                embed.add_field(
                    name=str(props.get("title", props.get("label", "Information")))[:256],
                    value=str(props.get("text", props.get("value", "—")))[:1024],
                    inline=component["type"] == "stat",
                )
                field_count += 1
            elif component["type"] == "image" and props.get("url"):
                embed.set_image(url=str(props["url"]))
            elif component["type"] == "player_inventory" and self.owner_id is not None:
                self._add_inventory(embed, str(props.get("title") or "Inventaire"))
        embed.description = "\n\n".join(descriptions)[:4096] or None
        return embed

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if self.owner_id is None or interaction.user.id == self.owner_id:
            return True
        await interaction.response.send_message("Cette interface privée appartient à un autre joueur.", ephemeral=True)
        return False

    def _building_key(self) -> str:
        return str(self.definition.get("target_building_key") or "")

    def _visible_components(self) -> list[dict[str, Any]]:
        return [component for component in self.page.get("components", []) if self._is_visible(component)]

    def _is_visible(self, component: dict[str, Any]) -> bool:
        condition = component.get("visible_when", {})
        if not condition or self.owner_id is None:
            return True
        player = self.engine.player(str(self.owner_id))
        professions = set(player.get("professions", {}))
        if condition.get("profession") and str(condition["profession"]) not in professions:
            return False
        if set(condition.get("none_of_professions", [])).intersection(professions):
            return False
        pending_building = str(condition.get("no_pending_building") or self._building_key())
        pending = {item["action"] for item in self.engine.pending_actions(str(self.owner_id), pending_building)}
        if condition.get("no_pending_building") and pending:
            return False
        if condition.get("pending_action") and str(condition["pending_action"]) not in pending:
            return False
        return True

    def _item_name(self, key: str) -> str:
        try:
            return str(self.engine.store.get("item", key, published=True)["payload"].get("name") or key)
        except Exception:
            return key.replace("_", " ").capitalize()

    def _add_inventory(self, embed: discord.Embed, title: str) -> None:
        player = self.engine.player(str(self.owner_id))
        inventory = player.get("inventory", {})
        content = "\n".join(
            f"• **{self._item_name(key)}** × {quantity}"
            for key, quantity in sorted(inventory.items(), key=lambda item: self._item_name(item[0]))
        ) or "Le sac est vide."
        embed.add_field(name=title[:256], value=content[:1024], inline=False)
        embed.add_field(name="💰 Monnaie", value=str(player.get("money", 0)), inline=True)
        embed.add_field(name="⚡ Énergie", value=str(player.get("energy", 100)), inline=True)
        labels = self.definition.get("profession_labels", {})
        professions = player.get("professions", {})
        profession_text = "\n".join(
            f"**{labels.get(key, key)}** · niv. {value['level']} · {value['experience']} XP"
            for key, value in professions.items()
        ) or "Aucun métier."
        embed.add_field(name="📜 Métiers", value=profession_text[:1024], inline=False)

    def _render_interactions(self) -> None:
        self.clear_items()
        styles = {
            "primary": discord.ButtonStyle.primary, "secondary": discord.ButtonStyle.secondary,
            "success": discord.ButtonStyle.success, "danger": discord.ButtonStyle.danger,
        }
        interactive = [item for item in self._visible_components() if item.get("type") in {"button", "select"}]
        next_slot = 0
        for component in interactive:
            slot = int(component.get("slot", next_slot))
            next_slot = max(next_slot, slot + (5 if component.get("type") == "select" else 1))
            row = min(4, slot // 5)
            if component.get("type") == "select":
                self._add_select(component, row)
            else:
                self._add_button(component, row, styles)

    def _add_button(self, component: dict[str, Any], row: int, styles: dict[str, discord.ButtonStyle]) -> None:
        props, interaction = component.get("props", {}), component.get("interaction", {})
        button = discord.ui.Button(
            label=str(props.get("label", "Continuer"))[:80], emoji=props.get("emoji") or None,
            style=styles.get(props.get("style"), discord.ButtonStyle.secondary),
            custom_id=f"kei:{component['id']}"[:100], row=row,
        )
        if interaction.get("type") == "navigate":
            async def navigate_callback(discord_interaction: discord.Interaction, target: str = interaction.get("page")):
                self.page_key = target
                self._render_interactions()
                await discord_interaction.response.edit_message(embed=self.embed(), view=self)
            button.callback = navigate_callback
        elif interaction.get("type") == "action":
            async def action_callback(discord_interaction: discord.Interaction, target: dict[str, Any] = interaction):
                await self._execute_action(discord_interaction, target)
            button.callback = action_callback
        else:
            button.disabled = True
        self.add_item(button)

    def _add_select(self, component: dict[str, Any], row: int) -> None:
        props = component.get("props", {})
        option_map: dict[str, dict[str, Any]] = {}
        options: list[discord.SelectOption] = []
        for index, option in enumerate(component.get("options", [])[:25]):
            value = str(option.get("key") or f"option_{index}")[:100]
            option_map[value] = option.get("interaction", {})
            options.append(discord.SelectOption(
                label=str(option.get("label") or value)[:100], value=value,
                description=str(option.get("description") or "")[:100] or None,
                emoji=option.get("emoji") or None,
            ))
        select = discord.ui.Select(
            placeholder=str(props.get("placeholder") or "Choisir une option…")[:150],
            min_values=1, max_values=1, options=options,
            custom_id=f"kes:{component['id']}"[:100], row=row,
        )

        async def select_callback(discord_interaction: discord.Interaction):
            interaction = option_map.get(select.values[0], {})
            if interaction.get("type") == "navigate":
                self.page_key = str(interaction["page"])
                self._render_interactions()
                await discord_interaction.response.edit_message(embed=self.embed(), view=self)
            elif interaction.get("type") == "action":
                await self._execute_action(discord_interaction, interaction)
            else:
                await discord_interaction.response.send_message("Cette option n'est pas encore configurée.", ephemeral=True)

        select.callback = select_callback
        self.add_item(select)

    async def _execute_action(self, interaction: discord.Interaction, target: dict[str, Any]) -> None:
        await interaction.response.defer()
        try:
            result = await self.engine.execute(
                str(interaction.user.id), str(target["building"]), str(target["action"]), str(interaction.id), interaction_context(interaction)
            )
            self.notice = "\n".join(result["messages"]) or "Action effectuée."
            if target.get("on_success_page"):
                self.page_key = str(target["on_success_page"])
        except Exception as exc:
            self.notice = str(exc)
        self._render_interactions()
        await interaction.edit_original_response(embed=self.embed(), view=self)


class PrivateInterfaceLauncher(discord.ui.View):
    """Petit lanceur de salon : tout le parcours suivant est éphémère et privé."""

    def __init__(self, engine: GameEngine, definition: dict[str, Any], owner_id: int):
        super().__init__(timeout=None)
        self.engine, self.definition, self.owner_id = engine, definition, owner_id
        # L'identifiant déterministe permet au nouveau processus de reprendre les
        # boutons déjà envoyés après un redémarrage du Core.
        building_key = str(definition.get("target_building_key") or "building")
        custom_id = f"kel:{building_key}"[:100]
        button = discord.ui.Button(
            label="Ouvrir mon interface privée", emoji="🚪",
            style=discord.ButtonStyle.primary, custom_id=custom_id,
        )
        button.callback = self.open
        self.add_item(button)

    async def open(self, interaction: discord.Interaction) -> None:
        view = InterfaceView(self.engine, self.definition, owner_id=interaction.user.id)
        await interaction.response.send_message(embed=view.embed(), view=view, ephemeral=True)


class OathView(discord.ui.View):
    """Vue persistante : le clic au serment accorde le rôle configuré."""

    def __init__(self, store: ContentStore):
        super().__init__(timeout=None)
        self.store = store
        settings = get_server_settings(store)
        onboarding = settings["onboarding"]
        button = discord.ui.Button(
            label=str(onboarding["button_label"])[:80], emoji=onboarding.get("button_emoji") or None,
            style=discord.ButtonStyle.success, custom_id=OATH_CUSTOM_ID,
        )
        button.callback = self.accept_oath
        self.add_item(button)

    async def accept_oath(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        if not isinstance(interaction.user, discord.Member):
            await interaction.followup.send("Ce serment doit être prêté depuis le serveur.", ephemeral=True)
            return
        try:
            settings = get_server_settings(self.store)
            role = discord.utils.get(interaction.user.guild.roles, name=settings["roles"]["player"])
            if role is None:
                await interaction.followup.send("Le rôle du Royaume n'existe pas encore. Relancez le provisionnement.", ephemeral=True)
                return
            bot_member = interaction.user.guild.me
            if bot_member is None or role >= bot_member.top_role:
                logger.error(
                    "Serment refusé : le rôle %s (position %s) n'est pas sous le rôle de KingdomCore (position %s).",
                    role.name, role.position, bot_member.top_role.position if bot_member else "inconnue",
                )
                await interaction.followup.send(
                    f"Je ne peux pas attribuer **{role.name}** : dans les paramètres Discord, "
                    "place le rôle de KingdomCore au-dessus de ce rôle, puis réessaie.",
                    ephemeral=True,
                )
                return
            if role not in interaction.user.roles:
                await interaction.user.add_roles(role, reason="Serment de la Sainte Pelle")
            await interaction.followup.send(settings["onboarding"]["confirmation"], ephemeral=True)
        except discord.Forbidden:
            logger.exception("Discord a refusé l'attribution du rôle après le serment.")
            await interaction.followup.send(
                "Discord refuse l'attribution du rôle. Vérifie que KingdomCore possède « Gérer les rôles » "
                "et que son rôle est placé au-dessus du rôle joueur.", ephemeral=True,
            )
        except discord.HTTPException:
            logger.exception("Erreur Discord pendant le serment.")
            await interaction.followup.send("Discord n'a pas pu terminer le serment. Réessaie dans quelques secondes.", ephemeral=True)
        except Exception:
            logger.exception("Erreur inattendue pendant le serment.")
            await interaction.followup.send("Le serment a échoué. L'erreur a été enregistrée dans KingdomCore.", ephemeral=True)


def interface_for_building(store: ContentStore, payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("interface"):
        return payload["interface"]
    if payload.get("interface_key"):
        try:
            return store.get("interface", payload["interface_key"], published=True)["payload"]
        except Exception:
            return None
    return None


def building_for_voice(store: ContentStore, channel: discord.VoiceChannel | None) -> dict[str, Any] | None:
    if channel is None:
        return None
    settings = get_server_settings(store)["discord"]
    category_template = settings["building_category_template"]
    voice_template = settings["building_voice_channel_template"]
    for entity in store.list("building", published=True):
        payload = entity["payload"]
        variables = {"name": payload["name"], "key": entity["entity_key"], "emoji": payload.get("emoji", "🏰")}
        expected_category = category_template.format(**variables).strip()[:100]
        expected_voice = voice_template.format(**variables).strip()[:100]
        # Les premiers provisionnements plaçaient les vocaux dans la catégorie
        # générale. Le nom du vocal reste donc un identifiant de migration
        # valable, même si sa catégorie n'est pas encore la catégorie dédiée.
        if channel_slug(channel.name) == channel_slug(expected_voice) or (
            channel.category is not None and channel.category.name.strip() == expected_category
        ):
            return entity
    return None


async def update_building_access(store: ContentStore, engine: GameEngine, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState) -> None:
    previous = building_for_voice(store, before.channel if isinstance(before.channel, discord.VoiceChannel) else None)
    current = building_for_voice(store, after.channel if isinstance(after.channel, discord.VoiceChannel) else None)
    if previous and current and previous["entity_key"] == current["entity_key"]:
        return
    settings = get_server_settings(store)
    if previous:
        previous_category = before.channel.category if isinstance(before.channel, discord.VoiceChannel) else None
        await set_text_access(member, previous, settings, False, previous_category)
    if not current:
        return
    payload = current["payload"]
    required_roles = set(payload.get("access", {}).get("required_roles", []))
    if required_roles and not required_roles.intersection(role.name for role in member.roles):
        return
    current_category = after.channel.category if isinstance(after.channel, discord.VoiceChannel) else None
    await set_text_access(member, current, settings, True, current_category)
    if settings["discord"].get("entry_message_enabled", True):
        await send_building_entry(store, engine, member, current, settings, current_category)


async def set_text_access(
    member: discord.Member, entity: dict[str, Any], settings: dict[str, Any], allowed: bool,
    voice_category: discord.CategoryChannel | None = None,
) -> None:
    temporary = entity["payload"].get("access", {}).get(
        "temporary_text", settings["discord"].get("temporary_text_access", True)
    )
    if not temporary:
        return
    category_name = settings["discord"]["building_category_template"].format(
        name=entity["payload"]["name"], key=entity["entity_key"], emoji=entity["payload"].get("emoji", "🏰")
    ).strip()[:100]
    category = next((item for item in member.guild.categories if item.name.strip() == category_name), None) or voice_category
    if category is None:
        logger.warning("Accès bâtiment impossible pour %s : catégorie %s introuvable.", entity["entity_key"], category_name)
        return
    text_name = channel_slug(settings["discord"]["building_text_channel"].format(
        name=entity["payload"]["name"], key=entity["entity_key"]
    ))
    channel = discord.utils.get(category.text_channels, name=text_name)
    if channel is not None:
        overwrite = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True) if allowed else None
        await channel.set_permissions(member, overwrite=overwrite, reason="Présence dans le bâtiment KingdomEngine")
    else:
        logger.warning("Accès bâtiment impossible pour %s : #%s absent de %s.", entity["entity_key"], text_name, category.name)


async def send_building_entry(
    store: ContentStore, engine: GameEngine, member: discord.Member, entity: dict[str, Any],
    settings: dict[str, Any], voice_category: discord.CategoryChannel | None = None,
) -> None:
    payload = entity["payload"]
    category_name = settings["discord"]["building_category_template"].format(
        name=payload["name"], key=entity["entity_key"], emoji=payload.get("emoji", "🏰")
    ).strip()[:100]
    category = next((item for item in member.guild.categories if item.name.strip() == category_name), None) or voice_category
    if category is None:
        logger.warning("Entrée non envoyée pour %s : catégorie %s introuvable.", entity["entity_key"], category_name)
        return
    text_name = channel_slug(settings["discord"]["building_text_channel"].format(name=payload["name"], key=entity["entity_key"]))
    channel = discord.utils.get(category.text_channels, name=text_name)
    if channel is None:
        legacy_channel = next((item for item in category.text_channels if channel_slug(item.name) == "entree"), None)
        if legacy_channel is not None:
            legacy_name = legacy_channel.name
            channel = await legacy_channel.edit(
                name=text_name, topic=payload.get("description"),
                reason="Migration du salon d'entrée KingdomEngine",
            )
            logger.warning("Salon #%s renommé en #%s dans %s.", legacy_name, text_name, category.name)
        else:
            channel = await member.guild.create_text_channel(
                text_name, category=category, topic=payload.get("description"),
                reason="Réparation automatique de l'entrée KingdomEngine",
            )
            logger.warning("Salon #%s créé automatiquement dans %s pour %s.", text_name, category.name, entity["entity_key"])
    await channel.set_permissions(
        member,
        overwrite=discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
        reason="Présence dans le bâtiment KingdomEngine",
    )
    definition = interface_for_building(store, payload) or interface_from_building(
        entity["entity_key"], payload, payload.get("actions", [])
    )
    launcher = PrivateInterfaceLauncher(engine, definition, member.id)
    content = f"🚪 Une entrée privée vers **{payload['name']}** est prête."
    # Répare le portail déjà publié : un portail est commun au bâtiment, puis
    # chaque clic ouvre une interface éphémère appartenant au joueur.
    try:
        async for old_message in channel.history(limit=30):
            if old_message.author.id == member.guild.me.id and old_message.content.startswith("🚪 Une entrée privée vers"):
                await old_message.edit(content=content, view=launcher)
                logger.info("Entrée de %s réparée dans #%s.", entity["entity_key"], channel.name)
                return
    except discord.HTTPException:
        logger.warning("Nettoyage des anciennes entrées impossible dans #%s.", channel.name)
    await channel.send(
        content=content,
        view=launcher,
        silent=True,
        allowed_mentions=discord.AllowedMentions.none(),
    )
    logger.info("Entrée de %s envoyée à %s dans #%s.", entity["entity_key"], member.id, channel.name)


def create_bot(store: ContentStore | None = None) -> commands.Bot:
    store = store or ContentStore()
    store.initialize()
    store.seed(DEFINITIONS)
    import_v1(store)
    engine = GameEngine(store, EventBus())
    intents = discord.Intents.default()
    intents.members = True
    intents.voice_states = True
    # Le moteur est piloté par composants Discord et non par commandes préfixées.
    # when_mentioned évite donc de demander l'intent privilégié message_content.
    bot = commands.Bot(command_prefix=commands.when_mentioned, intents=intents)
    oath_view = OathView(store)
    bot.add_view(oath_view)
    registered_oath_messages: set[int] = set()
    access_reconciled = False
    logger.info(
        "Vue persistante du serment enregistrée : %s.",
        [getattr(item, "custom_id", None) for item in oath_view.children],
    )

    async def bind_oath_messages() -> None:
        """Lie aussi la vue au message exact pour fiabiliser les anciens messages."""
        channel_name = get_server_settings(store)["onboarding"]["channel_name"]
        configured_guild_id = int(os.getenv("KINGDOM_GUILD_ID", "0") or 0)
        guilds = [guild for guild in bot.guilds if not configured_guild_id or guild.id == configured_guild_id]
        if not guilds:
            logger.error("Le serveur Discord configuré %s n'est pas accessible à KingdomCore.", configured_guild_id)
        for guild in guilds:
            channel = discord.utils.get(guild.text_channels, name=channel_name)
            if channel is None:
                try:
                    fetched_channels = await guild.fetch_channels()
                    channel = next(
                        (candidate for candidate in fetched_channels if getattr(candidate, "name", None) == channel_name),
                        None,
                    )
                except discord.HTTPException:
                    logger.exception("Impossible de récupérer les salons Discord de %s.", guild.name)
            if channel is None:
                logger.error("Salon du serment introuvable sur %s : #%s.", guild.name, channel_name)
                continue
            try:
                async for message in channel.history(limit=50):
                    has_oath = any(
                        getattr(child, "custom_id", None) == OATH_CUSTOM_ID
                        for row in message.components for child in row.children
                    )
                    if not has_oath or message.id in registered_oath_messages:
                        continue
                    bot.add_view(OathView(store), message_id=message.id)
                    registered_oath_messages.add(message.id)
                    logger.warning("Vue du serment liée au message %s sur %s dans #%s.", message.id, guild.name, channel.name)
                    break
            except discord.HTTPException:
                logger.exception("Impossible de rechercher le message du serment dans #%s.", channel.name)

    async def reconcile_building_access() -> None:
        """Restaure les accès temporaires après chaque démarrage complet du Core."""
        configured_guild_id = int(os.getenv("KINGDOM_GUILD_ID", "0") or 0)
        guilds = [guild for guild in bot.guilds if not configured_guild_id or guild.id == configured_guild_id]
        for guild in guilds:
            occupants: dict[str, dict[int, discord.Member]] = {}
            entities: dict[str, dict[str, Any]] = {}
            voice_categories: dict[str, discord.CategoryChannel | None] = {}
            for voice_channel in guild.voice_channels:
                entity = building_for_voice(store, voice_channel)
                if entity is None:
                    continue
                key = entity["entity_key"]
                entities[key] = entity
                voice_categories[key] = voice_channel.category
                occupants.setdefault(key, {}).update({member.id: member for member in voice_channel.members if not member.bot})
            settings = get_server_settings(store)
            for key, entity in entities.items():
                present = occupants.get(key, {})
                payload = entity["payload"]
                required_roles = set(payload.get("access", {}).get("required_roles", []))
                for member in present.values():
                    if required_roles and not required_roles.intersection(role.name for role in member.roles):
                        continue
                    try:
                        await set_text_access(member, entity, settings, True, voice_categories.get(key))
                        if settings["discord"].get("entry_message_enabled", True):
                            await send_building_entry(store, engine, member, entity, settings, voice_categories.get(key))
                    except discord.DiscordException:
                        logger.exception("Réconciliation impossible pour %s dans %s.", member.id, key)
                logger.info("Accès réconcilié pour %s : %s joueur(s) présent(s).", key, len(present))

    @bot.event
    async def on_member_join(member: discord.Member):
        """Les humains doivent prêter serment ; seuls les bots sont autorisés immédiatement."""
        if not member.bot:
            return
        role_name = get_server_settings(store)["roles"]["bot"]
        role = discord.utils.get(member.guild.roles, name=role_name)
        if role is not None and member.guild.me is not None and role < member.guild.me.top_role:
            await member.add_roles(role, reason="Accès bot KingdomEngine 2")

    @bot.event
    async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if not member.bot:
            try:
                await update_building_access(store, engine, member, before, after)
            except discord.DiscordException:
                logger.exception("Impossible de mettre à jour l'accès bâtiment de %s.", member.id)

    @bot.event
    async def on_interaction(interaction: discord.Interaction):
        component_id = None
        if interaction.data:
            component_id = interaction.data.get("custom_id")
        logger.warning(
            "Interaction reçue : type=%s custom_id=%s utilisateur=%s.",
            interaction.type, component_id, interaction.user.id,
        )

    @bot.event
    async def on_ready():
        nonlocal access_reconciled
        await bind_oath_messages()
        # La navigation du joueur passe exclusivement par les boutons et menus
        # des bâtiments. Une synchronisation vide retire les anciennes commandes
        # globales comme /royaume de l'application Discord.
        bot.tree.clear_commands(guild=None)
        await bot.tree.sync()
        if not access_reconciled:
            access_reconciled = True
            await reconcile_building_access()
        logger.warning("KingdomCore prêt : %s ; %s vue(s) persistante(s).", bot.user, len(bot.persistent_views))

    return bot


if __name__ == "__main__":
    create_bot().run(os.environ["KINGDOM_CORE_TOKEN"])
