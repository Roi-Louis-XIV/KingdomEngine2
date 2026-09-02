"""Bot Discord dont l'accueil, les accès et les interfaces viennent de KingdomData."""

from __future__ import annotations

import os
import logging
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import discord
from discord.ext import commands

from KingdomData import ContentStore, get_server_settings, interface_from_building
from kingdomEvent import EventBus
from import_v1 import import_v1
from seed import DEFINITIONS
from .engine import GameEngine
from .world import WorldEngine, WorldError
from .provisioner import DiscordProvisioner, OATH_CUSTOM_ID, building_role_name, channel_slug, find_player_role, message_is_oath


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
        "display_name": interaction.user.display_name,
        "avatar_url": str(interaction.user.display_avatar.url),
    }


async def execute_action(engine: GameEngine, interaction: discord.Interaction, building: str, action: str) -> None:
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        result = await engine.execute(str(interaction.user.id), building, action, str(interaction.id), interaction_context(interaction))
        await interaction.followup.send("\n".join(result["messages"]) or "Action effectuée.", ephemeral=True)
    except Exception as exc:
        await interaction.followup.send(str(exc), ephemeral=True)


class WorldExplorerView(discord.ui.View):
    """Interface éphémère générique construite depuis l'état réel du monde."""

    def __init__(self, engine: GameEngine, owner_id: int, notice: str = ""):
        super().__init__(timeout=900)
        self.engine, self.owner_id, self.notice = engine, owner_id, notice
        self._render()

    def snapshot(self) -> dict[str, Any]:
        world = WorldEngine(self.engine.store); player_id = str(self.owner_id)
        state, travel = world.player_state(player_id), world.get_travel_state(player_id)
        locations = world.locations(); clock = self.engine.world_clock.state()
        return {"world": world, "state": state, "travel": travel, "locations": locations, "clock": clock,
                "location": locations.get(state.get("location_key", ""), {})}

    def embed(self) -> discord.Embed:
        data = self.snapshot(); travel, clock = data["travel"], data["clock"]
        weather = clock.get("weather", {}); period = {"morning": "Matin", "day": "Jour", "evening": "Soir", "night": "Nuit"}.get(clock.get("time_of_day"), clock.get("time_of_day", ""))
        if travel:
            origin=data["locations"].get(travel["origin_key"],{}).get("name",travel["origin_key"]); destination=data["locations"].get(travel["destination_key"],{}).get("name",travel["destination_key"])
            embed=discord.Embed(title="🚶 EN VOYAGE",description=f"**{origin}** → **{destination}**\n\nArrivée dans **{travel['remaining_seconds']} seconde(s)**.",color=0xD99B32)
        else:
            location=data["location"]; embed=discord.Embed(title=f"{location.get('emoji','📍')} {location.get('name','Position inconnue')}",description=str(location.get("description") or "Choisissez votre prochaine action."),color=0x2F9E64)
            routes=data["world"].available_routes(str(self.owner_id)); activities=data["world"].local_activities(str(self.owner_id)); buildings=data["world"].local_buildings(str(self.owner_id))
            embed.add_field(name="🧭 Destinations",value="\n".join(f"• {route['destination_name']} · {route['duration_seconds']} s" for route in routes)[:1024] or "Aucun chemin accessible.",inline=False)
            embed.add_field(name="⚙️ Activités",value="\n".join(f"• {'🔒' if not self.engine.action_available(item['building_key'],item['key']) else item.get('emoji','⚙️')} {item.get('name',item['key'])}" for item in activities)[:1024] or "Aucune activité ici.",inline=True)
            embed.add_field(name="🏰 Bâtiments",value="\n".join(f"• {item.get('emoji','🏰')} {item['name']}" for item in buildings)[:1024] or "Aucun bâtiment ici.",inline=True)
        embed.add_field(name="🌍 Monde",value=f"Jour {clock['day']} · {clock['hour']:02d}:{clock['minute']:02d}\n{weather.get('emoji','☀️')} {weather.get('name','Beau')} · {period}",inline=False)
        if self.notice: embed.set_footer(text=self.notice[:2048])
        return embed

    def _render(self) -> None:
        self.clear_items(); data=self.snapshot(); travel=data["travel"]
        if travel:
            refresh=discord.ui.Button(label=f"Actualiser · {travel['remaining_seconds']} s",emoji="🔄",style=discord.ButtonStyle.secondary)
            async def refresh_callback(interaction: discord.Interaction):
                self.notice=""; self._render(); await interaction.response.edit_message(embed=self.embed(),view=self)
            refresh.callback=refresh_callback; self.add_item(refresh); return
        player_id=str(self.owner_id)
        for route in data["world"].available_routes(player_id)[:10]:
            button=discord.ui.Button(label=str(route["destination_name"])[:80],emoji="🧭",style=discord.ButtonStyle.primary)
            async def travel_callback(interaction: discord.Interaction,destination: str=route["destination"]):
                try:
                    result=WorldEngine(self.engine.store).travel(player_id,destination); travel_state=result.get("travel")
                    self.notice="Voyage commencé." if travel_state else "Vous êtes arrivé."
                except WorldError as exc: self.notice=str(exc)
                self._render(); await interaction.response.edit_message(embed=self.embed(),view=self)
            button.callback=travel_callback; self.add_item(button)
        for item in data["world"].local_activities(player_id)[:8]:
            available=self.engine.action_available(item["building_key"],item["key"])
            button=discord.ui.Button(label=str(item.get("name",item["key"]))[:80],emoji=item.get("emoji","⚙️"),style=discord.ButtonStyle.success,disabled=not available)
            async def activity_callback(interaction: discord.Interaction,building: str=item["building_key"],action: str=item["key"]):
                await interaction.response.defer()
                try:
                    result=await self.engine.execute_local_activity(player_id,building,action,str(interaction.id),interaction_context(interaction)); self.notice=" ".join(result.get("messages",[])) or "Activité lancée."
                except Exception as exc: self.notice=str(exc)
                self._render(); await interaction.edit_original_response(embed=self.embed(),view=self)
            button.callback=activity_callback; self.add_item(button)
        for item in data["world"].local_buildings(player_id)[:5]:
            button=discord.ui.Button(label=str(item["name"])[:80],emoji=item.get("emoji","🏰"),style=discord.ButtonStyle.secondary)
            async def building_callback(interaction: discord.Interaction,building_key: str=item["key"]):
                try:
                    WorldEngine(self.engine.store).enter_building(player_id,building_key)
                    payload=self.engine.building(building_key)["payload"]; definition=interface_for_building(self.engine.store,payload) or interface_from_building(building_key,payload,payload.get("actions",[])); view=InterfaceView(self.engine,definition,page_key=definition.get("entry_page") or definition["start_page"],owner_id=self.owner_id)
                    await interaction.response.edit_message(embed=view.embed(),view=view)
                except Exception as exc:
                    self.notice=str(exc); self._render(); await interaction.response.edit_message(embed=self.embed(),view=self)
            button.callback=building_callback; self.add_item(button)
        refresh=discord.ui.Button(label="Actualiser",emoji="🔄",style=discord.ButtonStyle.secondary)
        async def refresh_callback(interaction: discord.Interaction): self._render(); await interaction.response.edit_message(embed=self.embed(),view=self)
        refresh.callback=refresh_callback
        if len(self.children)<25:self.add_item(refresh)


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
        self.page_started_at = time.time()
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
            elif component["type"] == "sequence":
                text = self._sequence_text(component)
                if text:
                    descriptions.append(text)
            elif component["type"] in {"card", "stat"} and field_count < 25:
                locked = not self._access_condition_met(component.get("access_when", {}))
                title = str(props.get("title", props.get("label", "Information")))
                text = str(props.get("text", props.get("value", "—")))
                if locked:
                    requirement = component.get("access_when", {}).get("profession_level", {})
                    locked_label = str(props.get("locked_label", "Niveau {level} requis")).format(level=int(requirement.get("minimum", 1)))
                    title = f"{title} · 🔒 {locked_label}"
                embed.add_field(
                    name=title[:256],
                    value=text[:1024],
                    inline=component["type"] == "stat" or bool(props.get("inline")),
                )
                field_count += 1
            elif component["type"] == "image" and props.get("url"):
                embed.set_image(url=str(props["url"]))
            elif component["type"] == "player_inventory" and self.owner_id is not None:
                self._add_inventory(embed, str(props.get("title") or "Inventaire"))
            elif component["type"] == "building_inventory":
                self._add_building_inventory(embed, str(props.get("building") or self._building_key()), str(props.get("title") or "Stock commun"))
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
        if self.owner_id is None:
            return True
        player = self.engine.player(str(self.owner_id)) if hasattr(self.engine, "player") else {"professions": {}}
        professions = set(player.get("professions", {}))
        if condition.get("profession") and str(condition["profession"]) not in professions:
            return False
        if set(condition.get("none_of_professions", [])).intersection(professions):
            return False
        if condition:
            pending_building = str(condition.get("no_pending_building") or self._building_key())
            pending = {item["action"] for item in self.engine.pending_actions(str(self.owner_id), pending_building)}
            if condition.get("no_pending_building") and pending:
                return False
            if condition.get("pending_action") and str(condition["pending_action"]) not in pending:
                return False
        interaction = component.get("interaction", {})
        generic_condition = component.get("visibility_conditions")
        if interaction.get("type") == "action" and interaction.get("inherit_action_conditions", True):
            try:
                building_key = str(interaction.get("building") or self._building_key())
                action = next(
                    item for item in self.engine.building(building_key)["payload"].get("actions", [])
                    if str(item.get("key")) == str(interaction.get("action"))
                )
                generic_condition = generic_condition or action.get("conditions")
                effects = action.get("effects", [])
                profession_join = next((effect.get("profession") for effect in effects if effect.get("type") in {"profession_join", "profession"} and effect.get("operation", "join") == "join"), None)
                profession_leave = next((effect.get("profession") for effect in effects if effect.get("type") in {"profession_leave", "profession"} and effect.get("operation") == "leave"), None)
                if profession_join and str(profession_join) in professions:
                    return False
                if profession_leave and str(profession_leave) not in professions:
                    return False
            except (StopIteration, KeyError, AttributeError):
                pass
        if generic_condition and hasattr(self.engine, "condition_met") and not self.engine.condition_met(
            str(self.owner_id), str(interaction.get("building") or self._building_key()),
            str(interaction.get("action") or component.get("id", "visibility")), generic_condition,
        ):
            return False
        return True

    def _item_name(self, key: str) -> str:
        try:
            return str(self.engine.store.get("item", key, published=True)["payload"].get("name") or key)
        except Exception:
            return key.replace("_", " ").capitalize()

    def _access_condition_met(self, condition: dict[str, Any]) -> bool:
        """Évalue les conditions d'affichage interactif sans masquer l'aide visuelle."""
        if not condition or self.owner_id is None:
            return True
        player = self.engine.player(str(self.owner_id))
        level_rule = condition.get("profession_level")
        if level_rule:
            profession = str(level_rule.get("profession", ""))
            level = int(player.get("professions", {}).get(profession, {}).get("level", 0))
            if level < int(level_rule.get("minimum", 1)):
                return False
        return True

    def _sequence_text(self, component: dict[str, Any]) -> str:
        elapsed = max(0, time.time() - self.page_started_at)
        visible = [step for step in component.get("props", {}).get("steps", []) if self._access_condition_met(step.get("visible_when", {}))]
        if not visible:
            return ""
        cursor, selected = 0.0, visible[0]
        for step in visible:
            cursor += max(0.0, float(step.get("delay_seconds", 0)))
            if elapsed >= cursor:
                selected = step
            else:
                break
        return str(selected.get("text", ""))

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

    def _add_building_inventory(self, embed: discord.Embed, building_key: str, title: str) -> None:
        with self.engine.store.connection() as db:
            rows = db.execute("SELECT item_key,quantity FROM building_stock WHERE building_key=? ORDER BY item_key", (building_key,)).fetchall()
        content = "\n".join(f"• **{self._item_name(str(row[0]))}** : **{int(row[1])}**" for row in rows) or "Aucune matière enregistrée."
        embed.add_field(name=title[:256], value=content[:1024], inline=False)

    def _render_interactions(self) -> None:
        self.clear_items()
        styles = {
            "primary": discord.ButtonStyle.primary, "secondary": discord.ButtonStyle.secondary,
            "success": discord.ButtonStyle.success, "danger": discord.ButtonStyle.danger,
        }
        dynamic_types = {"dynamic_inventory_selector", "dynamic_product_selector", "dynamic_consumable_selector", "dynamic_game_selector"}
        interactive = [item for item in self._visible_components() if item.get("type") in {"button", "select", *dynamic_types}]
        next_slot = 0
        used_width = [0, 0, 0, 0, 0]
        for component in interactive:
            slot = int(component.get("slot", next_slot))
            full_width = component.get("type") == "select" or component.get("type") in dynamic_types
            width = 5 if full_width else 1
            next_slot = max(next_slot, slot + width)
            preferred = min(4, max(0, slot // 5))
            candidates = list(range(preferred, 5)) + list(range(0, preferred))
            row = next((candidate for candidate in candidates if used_width[candidate] == 0), None) if full_width else next((candidate for candidate in candidates if used_width[candidate] < 5), None)
            if row is None:
                print(f"[KingdomCore] composant ignoré faute de place sur 5 lignes : {component.get('id', 'sans-id')}")
                continue
            used_width[row] = 5 if full_width else used_width[row] + 1
            if component.get("type") == "dynamic_inventory_selector":
                self._add_dynamic_delivery(component, row)
            elif component.get("type") == "dynamic_product_selector":
                self._add_dynamic_product(component, row)
            elif component.get("type") == "dynamic_consumable_selector":
                self._add_dynamic_consumable(component, row)
            elif component.get("type") == "dynamic_game_selector":
                self._add_dynamic_game(component, row)
            elif component.get("type") == "select":
                self._add_select(component, row)
            else:
                self._add_button(component, row, styles)

    def _add_button(self, component: dict[str, Any], row: int, styles: dict[str, discord.ButtonStyle]) -> None:
        props, interaction = component.get("props", {}), component.get("interaction", {})
        label = str(props.get("label", "Continuer"))[:80]
        style = styles.get(props.get("style"), discord.ButtonStyle.secondary)
        disabled = False
        if interaction.get("type") == "action" and str(interaction.get("action", "")).startswith("claim_") and self.owner_id is not None:
            activity_key = str(interaction["action"])[len("claim_"):]
            pending = next((item for item in self.engine.pending_actions(str(self.owner_id), str(interaction.get("building", self._building_key()))) if item["action"] == activity_key), None)
            if pending:
                remaining = max(0, int(float(pending["ready_at"]) - time.time()))
                if remaining > 0:
                    label, style, disabled = f"Expédition en cours · {remaining} s", discord.ButtonStyle.secondary, True
        elif interaction.get("type") == "action" and self.owner_id is not None and (int(interaction.get("cooldown_seconds", 0)) > 0 or int(interaction.get("global_cooldown_seconds", 0)) > 0):
            remaining = self.engine.cooldown_remaining(str(self.owner_id), str(interaction.get("building", self._building_key())), str(interaction.get("action", "")))
            if remaining > 0:
                label, style, disabled = f"Disponible dans {remaining} s", discord.ButtonStyle.secondary, True
        button = discord.ui.Button(
            label=label, emoji=props.get("emoji") or None, style=style, disabled=disabled,
            custom_id=f"kei:{component['id']}"[:100], row=row,
        )
        if interaction.get("type") == "navigate":
            async def navigate_callback(discord_interaction: discord.Interaction, target: str = interaction.get("page")):
                self.page_key = target
                self.page_started_at = time.time()
                self._render_interactions()
                await discord_interaction.response.edit_message(embed=self.embed(), view=self)
                asyncio.create_task(self._refresh_text_sequence(discord_interaction, target))
            button.callback = navigate_callback
        elif interaction.get("type") == "action":
            async def action_callback(discord_interaction: discord.Interaction, target: dict[str, Any] = interaction):
                if target.get("confirm"):
                    confirmation = discord.ui.View(timeout=300)
                    confirm = discord.ui.Button(label="Confirmer", emoji="✅", style=discord.ButtonStyle.success)
                    async def confirm_callback(confirm_interaction: discord.Interaction):
                        await self._execute_action(confirm_interaction, target)
                    confirm.callback = confirm_callback; confirmation.add_item(confirm)
                    await discord_interaction.response.send_message(str(target["confirm"]), view=confirmation, ephemeral=True)
                else:
                    await self._execute_action(discord_interaction, target)
            button.callback = action_callback
        elif interaction.get("type") == "refresh":
            async def refresh_callback(discord_interaction: discord.Interaction):
                self.notice = ""
                self._render_interactions()
                await discord_interaction.response.edit_message(embed=self.embed(), view=self)
            button.callback = refresh_callback
        elif interaction.get("type") == "world_state":
            async def world_state_callback(discord_interaction: discord.Interaction):
                view = WorldExplorerView(self.engine, discord_interaction.user.id)
                await discord_interaction.response.send_message(embed=view.embed(), view=view, ephemeral=True)
            button.callback = world_state_callback
        elif interaction.get("type") == "world_travel":
            async def world_travel_callback(discord_interaction: discord.Interaction, target: str = str(interaction.get("destination", ""))):
                try:
                    result = WorldEngine(self.engine.store).travel(str(discord_interaction.user.id), target)
                    view = WorldExplorerView(self.engine, discord_interaction.user.id, "Voyage commencé." if result.get("travel") else "Vous êtes arrivé.")
                    await discord_interaction.response.send_message(embed=view.embed(), view=view, ephemeral=True)
                except WorldError as exc:
                    await discord_interaction.response.send_message(f"🚫 {exc}", ephemeral=True)
            button.callback = world_travel_callback
        elif interaction.get("type") == "close":
            async def close_callback(discord_interaction: discord.Interaction):
                await discord_interaction.response.defer()
                await discord_interaction.delete_original_response()
            button.callback = close_callback
        elif interaction.get("type") == "deliver_all":
            async def deliver_all_callback(discord_interaction: discord.Interaction):
                options = self.engine.delivery_options(str(discord_interaction.user.id), self._building_key())
                await discord_interaction.response.defer()
                try:
                    result = await self.engine.execute_delivery(str(discord_interaction.user.id), self._building_key(), str(discord_interaction.id), {item["resource"]: item["quantity"] for item in options})
                    self.notice = self._delivery_notice(result)
                except Exception as exc: self.notice = str(exc)
                self._render_interactions(); await discord_interaction.edit_original_response(embed=self.embed(), view=self)
            button.callback = deliver_all_callback
        else:
            button.disabled = True
        self.add_item(button)

    def _delivery_notice(self, result: dict[str, Any]) -> str:
        lines = " · ".join(f"{line['quantity']} × {line.get('resource_name') or self.engine._item_name(line['resource'])}" for line in result.get("delivery", []))
        payments = " · ".join(f"{amount} {'écus' if currency == 'money' else self.engine._item_name(currency)}" for currency, amount in result.get("payments", {}).items())
        return f"Livraison effectuée : {lines}." + (f" Paiement : **{payments}**." if payments else "")

    def _add_dynamic_delivery(self, component: dict[str, Any], row: int) -> None:
        options_data = self.engine.delivery_options(str(self.owner_id), self._building_key()) if self.owner_id is not None else []
        if not options_data: return
        select = discord.ui.Select(placeholder=str(component.get("props", {}).get("placeholder", "Choisir une ressource à livrer…"))[:150], options=[discord.SelectOption(label=str(item["name"])[:100], value=item["resource"][:100], description=f"x{item['quantity']} · {item.get('unit_price', 0)} /u → {item.get('destination_name', 'destination')}"[:100]) for item in options_data[:25]], row=row)
        async def choose(interaction: discord.Interaction):
            resource = select.values[0]; selected = next(item for item in options_data if item["resource"] == resource)
            parent = self
            class QuantityModal(discord.ui.Modal, title="Quantité à livrer"):
                quantity = discord.ui.TextInput(label="Quantité", placeholder=f"1 à {selected['quantity']}", required=True, max_length=10)
                async def on_submit(modal_self, modal_interaction: discord.Interaction):
                    try:
                        amount = int(str(modal_self.quantity)); price = amount * int(selected.get("unit_price", 0)); destination = selected.get("destination_name", "destination")
                        confirmation = discord.ui.View(timeout=300); confirm = discord.ui.Button(label="Confirmer la livraison", emoji="✅", style=discord.ButtonStyle.success); cancel = discord.ui.Button(label="Annuler", emoji="✖️", style=discord.ButtonStyle.secondary)
                        async def confirm_delivery(confirm_interaction: discord.Interaction):
                            try: result = await parent.engine.execute_delivery(str(confirm_interaction.user.id), parent._building_key(), str(confirm_interaction.id), {resource: amount}); parent.notice = parent._delivery_notice(result)
                            except Exception as exc: parent.notice = str(exc)
                            parent._render_interactions(); await confirm_interaction.response.edit_message(content=None, embed=parent.embed(), view=parent)
                        async def cancel_delivery(cancel_interaction: discord.Interaction): await cancel_interaction.response.edit_message(content="Livraison annulée.", view=None)
                        confirm.callback = confirm_delivery; cancel.callback = cancel_delivery; confirmation.add_item(confirm); confirmation.add_item(cancel)
                        await modal_interaction.response.send_message(f"**Récapitulatif**\n{amount} × {selected['name']}\n→ {destination}\n→ **{price} {selected.get('payment_resource', 'money')}**", view=confirmation, ephemeral=True)
                    except Exception as exc: await modal_interaction.response.send_message(str(exc), ephemeral=True)
            await interaction.response.send_modal(QuantityModal())
        select.callback = choose; self.add_item(select)

    def _add_dynamic_product(self, component: dict[str, Any], row: int) -> None:
        products = [item for item in self.engine.commerce_options(self._building_key()) if int(item.get("quantity", 0)) > 0]
        if not products: return
        select = discord.ui.Select(placeholder=str(component.get("props", {}).get("placeholder", "Choisir un produit…"))[:150], options=[discord.SelectOption(label=str(item["name"])[:100], value=item["item_key"][:100], description=f"{item.get('price', 0)} écus · stock {item.get('quantity', 0)}"[:100], emoji=item.get("emoji") or None) for item in products[:25]], row=row)
        async def choose(interaction: discord.Interaction):
            await self._show_purchase_modal(interaction, select.values[0])
        select.callback = choose; self.add_item(select)

    async def _show_purchase_modal(self, interaction: discord.Interaction, item_key: str) -> None:
        """Commande un produit choisi par un menu dynamique ou no-code."""
        product = next((item for item in self.engine.commerce_options(self._building_key()) if item["item_key"] == item_key), None)
        if not product:
            await interaction.response.send_message("Cet objet doit d’abord être ajouté aux Produits du bâtiment avec un prix et un stock.", ephemeral=True)
            return
        parent = self
        class PurchaseModal(discord.ui.Modal, title="Commander"):
            quantity = discord.ui.TextInput(label="Quantité", default="1", required=True, max_length=3)
            async def on_submit(modal_self, modal_interaction: discord.Interaction):
                try:
                    amount = int(str(modal_self.quantity)); result = await parent.engine.execute_purchase(str(modal_interaction.user.id), parent._building_key(), str(modal_interaction.id), item_key, amount)
                    parent.notice = f"Commande servie : {amount} × {product['name']} · **{result['purchase']['total']} écus**."
                except Exception as exc: parent.notice = str(exc)
                parent._render_interactions(); await modal_interaction.response.edit_message(embed=parent.embed(), view=parent)
        await interaction.response.send_modal(PurchaseModal())

    def _add_dynamic_consumable(self, component: dict[str, Any], row: int) -> None:
        if self.owner_id is None: return
        with self.engine.store.connection() as db:
            rows = db.execute("SELECT item_key,quantity FROM inventory WHERE discord_id=? AND quantity>0", (str(self.owner_id),)).fetchall()
        items = []
        for item_key, quantity in rows:
            try:
                payload = self.engine.store.get("item", str(item_key), published=True)["payload"]
                if payload.get("consumable") and payload.get("consumption", {}).get("effects"): items.append((str(item_key), int(quantity), payload))
            except Exception: continue
        if not items: return
        select = discord.ui.Select(placeholder=str(component.get("props", {}).get("placeholder", "Choisir quoi consommer…"))[:150], options=[discord.SelectOption(label=str(payload.get("name", key))[:100], value=key[:100], description=f"Dans le sac : {quantity}"[:100], emoji=payload.get("emoji") or None) for key, quantity, payload in items[:25]], row=row)
        async def choose(interaction: discord.Interaction):
            key = select.values[0]
            try:
                result = await self.engine.execute_consumption(str(interaction.user.id), self._building_key(), str(interaction.id), key)
                self.notice = "\n".join(result.get("messages", [])) or f"{result['consumption']['name']} consommé."
            except Exception as exc: self.notice = str(exc)
            self._render_interactions(); await interaction.response.edit_message(embed=self.embed(), view=self)
        select.callback = choose; self.add_item(select)

    def _add_dynamic_game(self, component: dict[str, Any], row: int) -> None:
        modules = self.engine.building(self._building_key())["payload"].get("modules", {})
        games = modules.get("games", {}); game_list = list(games.values()) if isinstance(games, dict) else list(games)
        options = [(game, choice) for game in game_list for choice in game.get("choices", game.get("bets", []))]
        if not options: return
        select = discord.ui.Select(placeholder=str(component.get("props", {}).get("placeholder", "Choisir un pari…"))[:150], options=[discord.SelectOption(label=str(choice.get("name", choice["key"]))[:100], value=f"{game.get('key')}:{choice['key']}"[:100], description=f"Mise {choice.get('stake', game.get('stake', 0))} · ×{choice.get('multiplier', 1)}"[:100]) for game, choice in options[:25]], row=row)
        async def choose(interaction: discord.Interaction):
            game_key, choice_key = select.values[0].split(":", 1); prepared = self.engine.prepare_game(str(interaction.user.id), self._building_key(), game_key, choice_key)
            confirmation = discord.ui.View(timeout=300); confirm = discord.ui.Button(label="Lancer", emoji="🎲", style=discord.ButtonStyle.success); cancel = discord.ui.Button(label="Annuler", style=discord.ButtonStyle.secondary)
            async def confirm_game(confirm_interaction: discord.Interaction):
                try:
                    result = await self.engine.confirm_game(str(confirm_interaction.user.id), prepared["session_key"], str(confirm_interaction.id)); self.notice = f"Le résultat est **{result['outcome']}**. " + (f"Victoire : **{result['payout']} écus** !" if result["won"] else f"Mise perdue : **{result['stake']} écus**.")
                except Exception as exc: self.notice = str(exc)
                self._render_interactions(); await confirm_interaction.response.edit_message(content=None, embed=self.embed(), view=self)
            async def cancel_game(cancel_interaction: discord.Interaction): self.engine.cancel_game(str(cancel_interaction.user.id), prepared["session_key"]); await cancel_interaction.response.edit_message(content="Partie annulée.", view=None)
            confirm.callback = confirm_game; cancel.callback = cancel_game; confirmation.add_item(confirm); confirmation.add_item(cancel)
            await interaction.response.send_message(f"**{prepared['choice'].get('name', choice_key)}**\nMise : **{prepared['stake']} écus**\nLe tirage aura lieu après confirmation.", view=confirmation, ephemeral=True)
        select.callback = choose; self.add_item(select)

    def _add_select(self, component: dict[str, Any], row: int) -> None:
        props = component.get("props", {})
        option_map: dict[str, dict[str, Any]] = {}
        options: list[discord.SelectOption] = []
        available_options = [option for option in component.get("options", []) if self._access_condition_met(option.get("access_when", {}))][:25]
        if not available_options:
            unavailable = discord.ui.Button(label="Aucune destination accessible", emoji="🔒", style=discord.ButtonStyle.secondary, disabled=True, row=row)
            self.add_item(unavailable)
            return
        for index, option in enumerate(available_options):
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
            elif interaction.get("type") == "purchase":
                await self._show_purchase_modal(discord_interaction, str(interaction.get("item_key", "")))
            else:
                await discord_interaction.response.send_message("Cette option n'est pas encore configurée.", ephemeral=True)

        select.callback = select_callback
        self.add_item(select)

    async def _execute_action(self, interaction: discord.Interaction, target: dict[str, Any]) -> None:
        await interaction.response.defer()
        try:
            context = interaction_context(interaction)
            context["interface_timing"] = {
                "cooldown_seconds": int(target.get("cooldown_seconds", 0)),
                "global_cooldown_seconds": int(target.get("global_cooldown_seconds", 0)),
            }
            result = await self.engine.execute(
                str(interaction.user.id), str(target["building"]), str(target["action"]), str(interaction.id), context
            )
            self.notice = "\n".join(result["messages"]) or "Action effectuée."
            if target.get("on_success_page"):
                self.page_key = str(target["on_success_page"])
                self.page_started_at = time.time()
        except Exception as exc:
            self.notice = str(exc)
        self._render_interactions()
        await interaction.edit_original_response(embed=self.embed(), view=self)
        action_key = str(target.get("action", ""))
        if not action_key.startswith("claim_") and any(item["action"] == action_key for item in self.engine.pending_actions(str(interaction.user.id), str(target.get("building", self._building_key())))):
            asyncio.create_task(self._refresh_activity_countdown(interaction, action_key, self.page_key))
        elif int(target.get("cooldown_seconds", 0)) > 0 or int(target.get("global_cooldown_seconds", 0)) > 0:
            asyncio.create_task(self._refresh_activity_countdown(interaction, action_key, self.page_key))

    async def _refresh_text_sequence(self, interaction: discord.Interaction, page_key: str) -> None:
        steps = [step for component in self.page.get("components", []) if component.get("type") == "sequence" for step in component.get("props", {}).get("steps", [])]
        duration = sum(max(0.0, float(step.get("delay_seconds", 0))) for step in steps)
        while self.page_key == page_key and time.time() - self.page_started_at <= duration + 1:
            try:
                await interaction.edit_original_response(embed=self.embed(), view=self)
            except (discord.NotFound, discord.HTTPException):
                return
            await asyncio.sleep(1)

    async def _refresh_activity_countdown(self, interaction: discord.Interaction, action_key: str, page_key: str) -> None:
        """Actualise seulement le message privé de l'expédition active."""
        while self.page_key == page_key:
            pending = next((item for item in self.engine.pending_actions(str(interaction.user.id), self._building_key()) if item["action"] == action_key), None)
            remaining = max(0, int(float(pending["ready_at"]) - time.time())) if pending else self.engine.cooldown_remaining(str(interaction.user.id), self._building_key(), action_key)
            self._render_interactions()
            try:
                await interaction.edit_original_response(embed=self.embed(), view=self)
            except (discord.NotFound, discord.HTTPException):
                return
            if remaining <= 0:
                return
            await asyncio.sleep(min(1, remaining))


class PrivateInterfaceLauncher(discord.ui.View):
    """Porte d'entrée directe d'un bâtiment, puis parcours joueur éphémère."""

    def __init__(self, engine: GameEngine, definition: dict[str, Any], owner_id: int):
        super().__init__(timeout=None)
        self.engine, self.definition, self.owner_id = engine, definition, owner_id
        # L'identifiant déterministe permet au nouveau processus de reprendre les
        # boutons déjà envoyés après un redémarrage du Core.
        building_key = str(definition.get("target_building_key") or "building")
        custom_id = f"kel:{building_key}"[:100]
        fallback_name = str(definition.get("name", building_key)).removeprefix("Interface - ")
        button = discord.ui.Button(
            label=str(definition.get("entry_label") or f"Entrer dans {fallback_name}")[:80], emoji="🚪",
            style=discord.ButtonStyle.primary, custom_id=custom_id,
        )
        button.callback = self.open
        self.add_item(button)

    async def open(self, interaction: discord.Interaction) -> None:
        entry_page = str(self.definition.get("entry_page") or self.definition.get("start_page", "home"))
        view = InterfaceView(self.engine, self.definition, page_key=entry_page, owner_id=interaction.user.id)
        await interaction.response.send_message(embed=view.embed(), view=view, ephemeral=True)


class OathView(discord.ui.View):
    """Vue persistante : le clic au serment accorde le rôle configuré."""

    def __init__(self, store: ContentStore, handled_interactions: set[int] | None = None):
        super().__init__(timeout=None)
        self.store = store
        self.handled_interactions = handled_interactions if handled_interactions is not None else set()
        settings = get_server_settings(store)
        onboarding = settings["onboarding"]
        button = discord.ui.Button(
            label=str(onboarding["button_label"])[:80], emoji=onboarding.get("button_emoji") or None,
            style=discord.ButtonStyle.success, custom_id=OATH_CUSTOM_ID,
        )
        button.callback = self.accept_oath
        self.add_item(button)

    async def accept_oath(self, interaction: discord.Interaction) -> None:
        # Une vue liée au message et la vue persistante globale peuvent toutes
        # deux recevoir le même clic lors d'une reprise après migration. Le
        # marquage intervient avant le premier await pour garantir une seule
        # attribution et une seule réponse Discord.
        if interaction.id in self.handled_interactions:
            return
        self.handled_interactions.add(interaction.id)
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        settings = get_server_settings(self.store)
        action_name = str(settings["onboarding"].get("action_name", "validation d'arrivée"))
        if not isinstance(interaction.user, discord.Member):
            await interaction.followup.send(f"Cette {action_name} doit être effectuée depuis le serveur.", ephemeral=True)
            return
        try:
            role = find_player_role(interaction.user.guild, settings["roles"]["player"])
            if role is None:
                await interaction.followup.send("Le rôle d'accès au monde n'existe pas encore. Relancez la synchronisation Discord.", ephemeral=True)
                return
            bot_member = interaction.user.guild.me
            if bot_member is None or role >= bot_member.top_role:
                logger.error(
                    "%s refusée : le rôle %s (position %s) n'est pas sous le rôle de KingdomCore (position %s).",
                    action_name.capitalize(),
                    role.name, role.position, bot_member.top_role.position if bot_member else "inconnue",
                )
                await interaction.followup.send(
                    f"Je ne peux pas attribuer **{role.name}** : dans les paramètres Discord, "
                    "place le rôle de KingdomCore au-dessus de ce rôle, puis réessaie.",
                    ephemeral=True,
                )
                return
            if role not in interaction.user.roles:
                await interaction.user.add_roles(role, reason=action_name[:512])
            granted = grant_oath_reward(self.store, interaction.user)
            confirmation = settings["onboarding"]["confirmation"]
            if granted:
                amount = int(settings["onboarding"].get("starting_money", 100))
                currency_label = str(settings["onboarding"].get("currency_label", "unités"))
                confirmation += f"\n\n🪙 **{amount} {currency_label}** ont été ajoutés à ton compte pour commencer."
            await interaction.followup.send(confirmation, ephemeral=True)
        except discord.Forbidden:
            logger.exception("Discord a refusé l'attribution du rôle après la validation d'arrivée.")
            await interaction.followup.send(
                "Discord refuse l'attribution du rôle. Vérifie que KingdomCore possède « Gérer les rôles » "
                "et que son rôle est placé au-dessus du rôle joueur.", ephemeral=True,
            )
        except discord.HTTPException:
            logger.exception("Erreur Discord pendant la validation d'arrivée.")
            await interaction.followup.send(f"Discord n'a pas pu terminer la {action_name}. Réessaie dans quelques secondes.", ephemeral=True)
        except Exception:
            logger.exception("Erreur inattendue pendant la validation d'arrivée.")
            await interaction.followup.send(f"La {action_name} a échoué. L'erreur a été enregistrée dans KingdomCore.", ephemeral=True)


def interface_for_building(store: ContentStore, payload: dict[str, Any]) -> dict[str, Any] | None:
    if payload.get("interface"):
        return payload["interface"]
    if payload.get("interface_key"):
        try:
            return store.get("interface", payload["interface_key"], published=True)["payload"]
        except Exception:
            return None
    return None


def building_entry_menu(
    engine: GameEngine,
    definition: dict[str, Any],
    member_id: int,
    building_name: str,
) -> tuple[str, "InterfaceView"]:
    """Construit le menu personnel affiché dès l'entrée dans le vocal."""
    page_key = definition.get("entry_page") or definition.get("start_page")
    menu = InterfaceView(engine, definition, page_key=page_key, owner_id=member_id)
    marker = f"🏰 <@{member_id}> — **{building_name}**"
    return f"{marker}\nLe menu du bâtiment est prêt.", menu


def building_for_voice(store: ContentStore, channel: discord.VoiceChannel | None) -> dict[str, Any] | None:
    if channel is None:
        return None
    # L'identifiant persisté lors du provisionnement reste fiable même si un
    # administrateur renomme ensuite le salon ou sa catégorie dans Discord.
    for entity in store.list("building", published=True):
        if entity["payload"].get("is_reference"):
            continue
        mapping = store.building_channels(entity["entity_key"])
        if str(mapping.get("voice_channel_id", "")) and str(mapping["voice_channel_id"]) == str(getattr(channel, "id", "")):
            return entity
    settings = get_server_settings(store)["discord"]
    category_template = settings["building_category_template"]
    voice_template = settings["building_voice_channel_template"]
    for entity in store.list("building", published=True):
        payload = entity["payload"]
        if payload.get("is_reference"):
            continue
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


def managed_store_for_guild(primary_store: ContentStore, guild_id: int) -> ContentStore:
    """Retourne la base du monde associé au serveur Discord courant."""
    with primary_store.connection() as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        row = db.execute(
            "SELECT database_path FROM managed_servers WHERE active=1 AND guild_id=? LIMIT 1",
            (str(guild_id),),
        ).fetchone() if "managed_servers" in tables else None
    if not row:
        return primary_store
    path = Path(str(row[0])).resolve()
    if path == primary_store.path.resolve():
        return primary_store
    target = ContentStore(path)
    target.initialize()
    return target


def persist_player_presence(store: ContentStore, member: discord.Member, channel: discord.VoiceChannel | None) -> None:
    """Conserve un snapshot léger pour KingdomWeb, sans appeler Discord depuis le web."""
    building = building_for_voice(store, channel)
    now = datetime.now(timezone.utc).isoformat()
    with store.connection() as db:
        db.execute(
            "INSERT OR IGNORE INTO players(discord_id,updated_at,created_at,display_name,avatar_url) VALUES(?,?,?,?,?)",
            (str(member.id), now, now, member.display_name, str(member.display_avatar.url)),
        )
        db.execute(
            "UPDATE players SET display_name=?,avatar_url=?,updated_at=? WHERE discord_id=?",
            (member.display_name, str(member.display_avatar.url), now, str(member.id)),
        )
        db.execute(
            "INSERT INTO player_presence(discord_id,online,voice_channel_id,voice_channel_name,building_key,updated_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(discord_id) DO UPDATE SET online=excluded.online,voice_channel_id=excluded.voice_channel_id,voice_channel_name=excluded.voice_channel_name,building_key=excluded.building_key,updated_at=excluded.updated_at",
            (str(member.id), int(channel is not None), str(channel.id) if channel else "", channel.name if channel else "", building["entity_key"] if building else "", now),
        )


def grant_oath_reward(store: ContentStore, member: discord.Member) -> bool:
    """Crée le joueur et verse une seule fois la dotation configurée."""
    now = datetime.now(timezone.utc).isoformat()
    amount = max(0, int(get_server_settings(store)["onboarding"].get("starting_money", 100)))
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "INSERT OR IGNORE INTO players(discord_id,updated_at,created_at,display_name,avatar_url) VALUES(?,?,?,?,?)",
            (str(member.id), now, now, member.display_name, str(member.display_avatar.url)),
        )
        db.execute(
            "UPDATE players SET display_name=?,avatar_url=?,updated_at=? WHERE discord_id=?",
            (member.display_name, str(member.display_avatar.url), now, str(member.id)),
        )
        granted = db.execute(
            "INSERT OR IGNORE INTO onboarding_grants(discord_id,amount,granted_at) VALUES(?,?,?)",
            (str(member.id), amount, now),
        ).rowcount
        if granted:
            db.execute("UPDATE players SET money=money+? WHERE discord_id=?", (amount, str(member.id)))
    return bool(granted)


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
    role_name = building_role_name(settings, entity["entity_key"], entity["payload"])
    building_role = discord.utils.get(member.guild.roles, name=role_name)
    if building_role is not None:
        bot_member = getattr(member.guild, "me", None)
        if bot_member is not None and building_role >= bot_member.top_role:
            raise PermissionError(
                f"Le rôle bâtiment `{building_role.name}` doit être placé sous le rôle de KingdomCore."
            )
        if allowed and building_role not in member.roles:
            await member.add_roles(building_role, reason="Présence dans le bâtiment KingdomEngine")
            logger.info(
                "Rôle bâtiment %s attribué à %s sur %s.",
                building_role.name, getattr(member, "id", "inconnu"), getattr(member.guild, "name", "serveur"),
            )
        elif not allowed and building_role in member.roles:
            await member.remove_roles(building_role, reason="Sortie du bâtiment KingdomEngine")
            logger.info(
                "Rôle bâtiment %s retiré à %s sur %s.",
                building_role.name, getattr(member, "id", "inconnu"), getattr(member.guild, "name", "serveur"),
            )
    else:
        logger.warning(
            "Rôle bâtiment absent pour %s (%s) : lancez la synchronisation Discord.",
            entity["entity_key"], role_name,
        )
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
        overwrite = None if building_role is not None else (
            discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True) if allowed else None
        )
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
    role_name = building_role_name(settings, entity["entity_key"], payload)
    if discord.utils.get(member.guild.roles, name=role_name) is None:
        # Compatibilité avec les serveurs pas encore resynchronisés : leur
        # ancien accès individuel reste fonctionnel jusqu'au prochain provisionnement.
        await channel.set_permissions(
            member,
            overwrite=discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
            reason="Présence dans le bâtiment KingdomEngine",
        )
    definition = interface_for_building(store, payload) or interface_from_building(
        entity["entity_key"], payload, payload.get("actions", [])
    )
    content, menu = building_entry_menu(engine, definition, member.id, payload["name"])
    marker = f"🏰 <@{member.id}> — **{payload['name']}**"

    # Les anciens serveurs peuvent encore contenir le portail générique. On
    # le laisse utilisable, mais l'entrée vocale affiche désormais directement
    # le menu personnel du joueur, sans lui imposer un second clic.
    try:
        async for old_message in channel.history(limit=30):
            if old_message.author.id == member.guild.me.id and old_message.content.startswith(marker):
                await old_message.edit(content=content, embed=menu.embed(), view=menu)
                logger.info("Menu de %s actualisé pour %s dans #%s.", entity["entity_key"], member.id, channel.name)
                return
    except discord.HTTPException:
        logger.warning("Recherche de l'ancien menu impossible dans #%s.", channel.name)
    await channel.send(
        content=content,
        embed=menu.embed(),
        view=menu,
        silent=True,
        allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False),
    )
    logger.info("Menu de %s envoyé à %s dans #%s.", entity["entity_key"], member.id, channel.name)


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
    handled_oath_interactions: set[int] = set()
    oath_view = OathView(store, handled_oath_interactions)
    bot.add_view(oath_view)
    registered_oath_messages: set[int] = set()
    access_reconciled = False
    deleted_buildings_processed: set[tuple[str, int]] = set()
    deletion_watcher: asyncio.Task | None = None
    provisioning_watcher: asyncio.Task | None = None
    recovered_provision_stores: set[str] = set()
    logger.info(
        "Vue persistante du serment enregistrée : %s.",
        [getattr(item, "custom_id", None) for item in oath_view.children],
    )

    async def bind_oath_messages() -> None:
        """Lie aussi la vue au message exact pour fiabiliser les anciens messages."""
        onboarding = get_server_settings(store)["onboarding"]
        channel_name = onboarding["channel_name"]
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
                    has_current_oath = any(
                        getattr(child, "custom_id", None) == OATH_CUSTOM_ID
                        for row in message.components for child in row.children
                    )
                    if not message_is_oath(message, onboarding) or message.id in registered_oath_messages:
                        continue
                    bound_view = OathView(store, handled_oath_interactions)
                    if not has_current_oath:
                        await message.edit(view=bound_view)
                        logger.warning("Ancien bouton du serment réparé sur le message %s.", message.id)
                    bot.add_view(bound_view, message_id=message.id)
                    registered_oath_messages.add(message.id)
                    logger.warning("Vue du serment liée au message %s sur %s dans #%s.", message.id, guild.name, channel.name)
            except discord.HTTPException:
                logger.exception("Impossible de rechercher le message du serment dans #%s.", channel.name)

    async def reconcile_building_access() -> None:
        """Restaure les accès temporaires après chaque démarrage complet du Core."""
        # Le Core est multi-serveur : KINGDOM_GUILD_ID reste un repli historique,
        # mais ne doit pas empêcher la réconciliation des mondes administrés.
        for guild in bot.guilds:
            guild_store = managed_store_for_guild(store, guild.id)
            guild_engine = GameEngine(guild_store, EventBus())
            occupants: dict[str, dict[int, discord.Member]] = {}
            entities: dict[str, dict[str, Any]] = {}
            voice_categories: dict[str, discord.CategoryChannel | None] = {}
            for voice_channel in guild.voice_channels:
                entity = building_for_voice(guild_store, voice_channel)
                if entity is None:
                    continue
                key = entity["entity_key"]
                entities[key] = entity
                voice_categories[key] = voice_channel.category
                occupants.setdefault(key, {}).update({member.id: member for member in voice_channel.members if not member.bot})
            settings = get_server_settings(guild_store)
            for key, entity in entities.items():
                present = occupants.get(key, {})
                payload = entity["payload"]
                required_roles = set(payload.get("access", {}).get("required_roles", []))
                for member in present.values():
                    persist_player_presence(guild_store, member, member.voice.channel if member.voice and isinstance(member.voice.channel, discord.VoiceChannel) else None)
                    if required_roles and not required_roles.intersection(role.name for role in member.roles):
                        continue
                    try:
                        await set_text_access(member, entity, settings, True, voice_categories.get(key))
                        if settings["discord"].get("entry_message_enabled", True):
                            await send_building_entry(guild_store, guild_engine, member, entity, settings, voice_categories.get(key))
                    except (discord.DiscordException, PermissionError, RuntimeError):
                        logger.exception("Réconciliation impossible pour %s dans %s.", member.id, key)
                logger.info("Accès réconcilié pour %s : %s joueur(s) présent(s).", key, len(present))

    async def watch_deleted_buildings() -> None:
        """Répercute dans Discord les suppressions publiées depuis KingdomWeb."""
        while not bot.is_closed():
            try:
                with store.connection() as db:
                    rows = db.execute(
                        "SELECT entity_key,version,payload_json FROM content c WHERE entity_type='building' AND status='deleted' "
                        "AND version=(SELECT MAX(version) FROM content WHERE entity_type='building' AND entity_key=c.entity_key)"
                    ).fetchall()
                for row in rows:
                    marker = (str(row[0]), int(row[1]))
                    if marker in deleted_buildings_processed:
                        continue
                    payload = json.loads(row[2])
                    for guild in bot.guilds:
                        removed = await DiscordProvisioner(guild, store).remove_building_channels(marker[0], payload)
                        if removed:
                            logger.warning("Bâtiment %s supprimé de Discord : %s.", marker[0], ", ".join(removed))
                    deleted_buildings_processed.add(marker)
            except (discord.DiscordException, OSError, ValueError):
                logger.exception("Impossible de réconcilier les bâtiments supprimés avec Discord.")
            await asyncio.sleep(5)

    def managed_provision_targets() -> list[tuple[discord.Guild, ContentStore]]:
        """Associe chaque serveur Discord à sa base KingdomData indépendante."""
        with store.connection() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            rows = db.execute("SELECT guild_id,database_path FROM managed_servers WHERE active=1 AND guild_id<>''").fetchall() if "managed_servers" in tables else []
        targets: list[tuple[discord.Guild, ContentStore]] = []
        for guild_id, database_path in rows:
            guild = bot.get_guild(int(guild_id)) if str(guild_id).isdigit() else None
            if guild is None:
                continue
            path = Path(str(database_path)).resolve()
            target_store = store if path == store.path.resolve() else ContentStore(path)
            target_store.initialize()
            targets.append((guild, target_store))
        if not targets:
            configured = int(os.getenv("KINGDOM_GUILD_ID", "0") or 0)
            targets = [(guild, store) for guild in bot.guilds if not configured or guild.id == configured]
        return targets

    async def watch_discord_provisioning() -> None:
        """Exécute les installations demandées par KingdomWeb avec le Core connecté."""
        while not bot.is_closed():
            try:
                for guild, target_store in managed_provision_targets():
                    store_key = str(target_store.path.resolve())
                    if store_key not in recovered_provision_stores:
                        recovered = target_store.recover_discord_provision()
                        recovered_provision_stores.add(store_key)
                        if recovered:
                            logger.warning("%s installation(s) Discord interrompue(s) remise(s) en attente pour %s.", recovered, guild.name)
                    for request in target_store.pending_discord_provision():
                        try:
                            provisioner = DiscordProvisioner(guild, target_store)
                            if request["scope"] == "uninstall":
                                report = await provisioner.uninstall()
                                summary = (
                                    f"{len(report.removed_voice_bots)} bot(s) vocal(aux), "
                                    f"{len(report.removed_channels)} salon(s) et {len(report.removed_roles)} rôle(s) retirés"
                                )
                            elif request["scope"] == "building" and not any(
                                item["entity_key"] == request["building_key"]
                                for item in target_store.list("building", published=True)
                            ):
                                removed = await provisioner.remove_mapped_building_channels(request["building_key"])
                                target_store.finish_discord_provision(request["id"], report=f"{len(removed)} salon(s) du bâtiment retiré(s)")
                                logger.warning("Suppression Discord du bâtiment %s terminée : %s", request["building_key"], ", ".join(removed) or "aucun salon restant")
                                continue
                            else:
                                report = await provisioner.provision()
                                summary = (
                                    f"{len(report.created_roles)} rôle(s), {len(report.created_channels)} salon(s) créés, "
                                    f"{report.assigned_roles} attribution(s) de rôle"
                                )
                            target_store.finish_discord_provision(request["id"], report=summary)
                            logger.warning("Synchronisation Discord terminée pour %s : %s.", guild.name, summary)
                            if request["scope"] == "uninstall":
                                await guild.leave()
                        except Exception as exc:
                            target_store.finish_discord_provision(request["id"], error=str(exc))
                            logger.exception("Synchronisation Discord impossible pour %s.", guild.name)
            except (OSError, ValueError):
                logger.exception("Impossible de lire la file de provisionnement Discord.")
            await asyncio.sleep(3)

    @bot.event
    async def on_guild_join(guild: discord.Guild):
        """Rend immédiatement visible l'installation OAuth sans redémarrer le Core."""
        with store.connection() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "managed_servers" in tables:
                db.execute(
                    "UPDATE managed_servers SET bot_installed=1,name=CASE WHEN name='Royaume principal' THEN ? ELSE name END WHERE guild_id=?",
                    (guild.name, str(guild.id)),
                )

    @bot.event
    async def on_guild_remove(guild: discord.Guild):
        with store.connection() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "managed_servers" in tables:
                db.execute("UPDATE managed_servers SET bot_installed=0 WHERE guild_id=?", (str(guild.id),))

    @bot.event
    async def on_member_join(member: discord.Member):
        """Les humains doivent prêter serment ; seuls les bots sont autorisés immédiatement."""
        if not member.bot:
            return
        guild_store = managed_store_for_guild(store, member.guild.id)
        role_name = get_server_settings(guild_store)["roles"]["bot"]
        role = discord.utils.get(member.guild.roles, name=role_name)
        if role is not None and member.guild.me is not None and role < member.guild.me.top_role:
            await member.add_roles(role, reason="Accès bot KingdomEngine 2")

    @bot.event
    async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if not member.bot:
            guild_store = managed_store_for_guild(store, member.guild.id)
            guild_engine = GameEngine(guild_store, EventBus())
            persist_player_presence(guild_store, member, after.channel if isinstance(after.channel, discord.VoiceChannel) else None)
            world = WorldEngine(guild_store)
            before_building = building_for_voice(guild_store, before.channel) if isinstance(before.channel, discord.VoiceChannel) else None
            after_building = building_for_voice(guild_store, after.channel) if isinstance(after.channel, discord.VoiceChannel) else None
            try:
                if after_building and after_building["payload"].get("location_key"):
                    world.enter_building(str(member.id), after_building["entity_key"])
                elif before_building:
                    world.leave_building(str(member.id))
            except WorldError:
                logger.info("Position logique non modifiée pour %s : bâtiment non localisé.", member.id)
            try:
                await update_building_access(guild_store, guild_engine, member, before, after)
            except (discord.DiscordException, PermissionError, RuntimeError):
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
        # Filet de sécurité pour une vue restaurée tardivement : la vue
        # persistante normale répond presque instantanément. Si elle ne l'a pas
        # fait, on prend en charge le serment avant l'expiration Discord.
        if component_id == OATH_CUSTOM_ID:
            await asyncio.sleep(0.15)
            if not interaction.response.is_done():
                logger.warning("Prise en charge de secours du serment pour l'interaction %s.", interaction.id)
                await oath_view.accept_oath(interaction)

    @bot.event
    async def on_ready():
        nonlocal access_reconciled, deletion_watcher, provisioning_watcher
        # KingdomWeb affiche ainsi les serveurs sur lesquels l'application
        # principale est réellement présente, sans se fier à un clic OAuth.
        with store.connection() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "managed_servers" in tables:
                guild_ids = [str(guild.id) for guild in bot.guilds]
                # Migration d'une installation historique : on identifie le
                # serveur principal grâce aux salons déjà provisionnés.
                channel_ids = [int(row[0]) for row in db.execute("SELECT voice_channel_id FROM building_discord_channels WHERE voice_channel_id<>''") if str(row[0]).isdigit()]
                primary_guild = next((guild for guild in bot.guilds if any(guild.get_channel(channel_id) for channel_id in channel_ids)), None)
                if primary_guild and not db.execute("SELECT 1 FROM managed_servers WHERE guild_id=?", (str(primary_guild.id),)).fetchone():
                    db.execute(
                        "UPDATE managed_servers SET guild_id=? WHERE id=(SELECT id FROM managed_servers WHERE guild_id='' ORDER BY id LIMIT 1)",
                        (str(primary_guild.id),),
                    )
                # Tout serveur où le bot est installé devient visible depuis
                # le profil administrateur, même avant sa configuration.
                for guild in bot.guilds:
                    if db.execute("SELECT 1 FROM managed_servers WHERE guild_id=?", (str(guild.id),)).fetchone():
                        db.execute(
                            "UPDATE managed_servers SET name=CASE WHEN name='Royaume principal' THEN ? ELSE name END WHERE guild_id=?",
                            (guild.name, str(guild.id)),
                        )
                        continue
                    slug_base = channel_slug(guild.name) or f"serveur-{guild.id}"
                    slug, suffixe = slug_base[:48], 2
                    while db.execute("SELECT 1 FROM managed_servers WHERE slug=?", (slug,)).fetchone():
                        slug, suffixe = f"{slug_base[:42]}-{suffixe}", suffixe + 1
                    database_path = str(store.path.parent / "servers" / f"{slug}.db")
                    db.execute(
                        "INSERT INTO managed_servers(slug,name,guild_id,database_path,bot_installed,active,created_at) VALUES(?,?,?,?,1,1,?)",
                        (slug, guild.name, str(guild.id), database_path, datetime.now(timezone.utc).isoformat()),
                    )
                db.execute("UPDATE managed_servers SET bot_installed=0 WHERE guild_id<>''")
                if guild_ids:
                    placeholders = ",".join("?" for _ in guild_ids)
                    db.execute(f"UPDATE managed_servers SET bot_installed=1 WHERE guild_id IN ({placeholders})", guild_ids)
        await bind_oath_messages()
        # La navigation du joueur passe exclusivement par les boutons et menus
        # des bâtiments. Une synchronisation vide retire les anciennes commandes
        # globales comme /royaume de l'application Discord.
        bot.tree.clear_commands(guild=None)
        await bot.tree.sync()
        if not access_reconciled:
            access_reconciled = True
            # Un redémarrage ne doit pas laisser un ancien joueur affiché en
            # vocal. On repart de l'état Discord réellement observé.
            with store.connection() as db:
                db.execute("UPDATE player_presence SET online=0,voice_channel_id='',voice_channel_name='',building_key='',updated_at=?", (datetime.now(timezone.utc).isoformat(),))
                for guild in bot.guilds:
                    for member in guild.members:
                        if not member.bot:
                            db.execute("UPDATE players SET display_name=?,avatar_url=? WHERE discord_id=?", (member.display_name, str(member.display_avatar.url), str(member.id)))
            for guild in bot.guilds:
                for channel in guild.voice_channels:
                    for member in channel.members:
                        if not member.bot:
                            persist_player_presence(store, member, channel)
            await reconcile_building_access()
        if deletion_watcher is None or deletion_watcher.done():
            deletion_watcher = asyncio.create_task(watch_deleted_buildings(), name="kingdom-deleted-buildings")
        if provisioning_watcher is None or provisioning_watcher.done():
            provisioning_watcher = asyncio.create_task(watch_discord_provisioning(), name="kingdom-discord-provisioning")
        logger.warning("KingdomCore prêt : %s ; %s vue(s) persistante(s).", bot.user, len(bot.persistent_views))

    return bot


if __name__ == "__main__":
    create_bot().run(os.environ["KINGDOM_CORE_TOKEN"])
