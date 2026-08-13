"""Bot Discord unique dont les bâtiments et boutons viennent de KingdomData."""

from __future__ import annotations

import os
import discord
from discord import app_commands
from discord.ext import commands

from KingdomData import ContentStore
from kingdomEvent import EventBus
from import_v1 import import_v1
from seed import DEFINITIONS
from .engine import GameEngine
from .provisioner import ROLE_BOT, ROLE_PLAYER


class BuildingView(discord.ui.View):
    def __init__(self, engine: GameEngine, building_key: str, actions: list[dict]):
        super().__init__(timeout=180); self.engine, self.building_key = engine, building_key
        for action in actions[:25]:
            button = discord.ui.Button(label=action.get("name", action["key"]), emoji=action.get("emoji"), custom_id=f"ke2:{building_key}:{action['key']}")
            async def callback(interaction: discord.Interaction, key=action["key"]):
                try:
                    result = await self.engine.execute(str(interaction.user.id), self.building_key, key, str(interaction.id))
                    await interaction.response.send_message("\n".join(result["messages"]) or "Action effectuée.", ephemeral=True)
                except Exception as exc: await interaction.response.send_message(str(exc), ephemeral=True)
            button.callback = callback; self.add_item(button)


def create_bot(store: ContentStore | None = None) -> commands.Bot:
    store = store or ContentStore()
    store.initialize(); store.seed(DEFINITIONS); import_v1(store)
    engine = GameEngine(store, EventBus())
    intents = discord.Intents.default(); intents.members = True
    bot = commands.Bot(command_prefix="!", intents=intents)

    @bot.event
    async def on_member_join(member: discord.Member):
        """Maintient automatiquement les accès créés par le provisionneur."""
        role_name = ROLE_BOT if member.bot else ROLE_PLAYER
        role = discord.utils.get(member.guild.roles, name=role_name)
        if role is not None and member.guild.me is not None and role < member.guild.me.top_role:
            await member.add_roles(role, reason="Accès automatique KingdomEngine 2")

    @bot.tree.command(name="royaume", description="Ouvre un bâtiment du Royaume")
    @app_commands.describe(batiment="Identifiant du bâtiment")
    async def royaume(interaction: discord.Interaction, batiment: str):
        entity = store.get("building", batiment, published=True); data = entity["payload"]
        embed = discord.Embed(title=data["name"], description=data.get("description", ""), color=int(data.get("color", "8b5cf6"), 16))
        await interaction.response.send_message(embed=embed, view=BuildingView(engine, batiment, data.get("actions", [])), ephemeral=True)

    @royaume.autocomplete("batiment")
    async def choices(_interaction, current):
        return [app_commands.Choice(name=x["payload"]["name"], value=x["entity_key"]) for x in engine.buildings() if current.lower() in x["payload"]["name"].lower()][:25]

    @bot.event
    async def on_ready():
        await bot.tree.sync(); print(f"KingdomCore prêt : {bot.user}")
    return bot


if __name__ == "__main__": create_bot().run(os.environ["KINGDOM_CORE_TOKEN"])
