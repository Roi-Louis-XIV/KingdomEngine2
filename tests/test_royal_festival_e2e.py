"""Parcours complet unique du template officiel La Fête du Royaume."""

import asyncio
import sqlite3
import time
from types import SimpleNamespace

from kingdomCore.engine import GameEngine
from kingdomCore.npc import NpcEngine
from kingdomCore.world import WorldEngine
from KingdomData import ContentStore
from KingdomData.official_content import OfficialContentStore
from KingdomVoice.pool import VoicePresence, VoiceWorkerPool, VoiceWorkerState
from KingdomWeb.accounts import SCHEMA_COMPTES
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.discord_bot import grant_oath_reward
from kingdomEvent.lifecycle import EventLifecycle


def test_royal_festival_published_world_full_persistent_journey(tmp_path):
    platform_path = tmp_path / "platform.db"
    with sqlite3.connect(platform_path) as database:
        database.executescript(SCHEMA_COMPTES)
    official = OfficialContentStore(platform_path)
    official.migrate_legacy_presets()
    template = official.get("royal_festival", published_only=True)
    assert template["status"] == "published" and template["validation"]["valid"]

    world_path = tmp_path / "servers" / "festival.db"
    store = ContentStore(world_path)
    store.initialize()
    store.seed(template["entities"])

    # Même file persistante que celle consommée par la synchronisation Discord.
    request_id = store.request_discord_provision("server", requested_by="e2e")
    assert store.pending_discord_provision()[0]["id"] == request_id
    store.finish_discord_provision(request_id, report="7 bâtiments et interfaces synchronisés")
    assert store.discord_provision_status()["status"] == "done"

    member = SimpleNamespace(
        id=42, display_name="Joueuse test",
        display_avatar=SimpleNamespace(url="https://example.invalid/avatar.png"),
    )
    assert grant_oath_reward(store, member)
    engine = GameEngine(store)
    joined = asyncio.run(engine.execute("42", "festival_farm", "join_farmer", "e2e-join"))
    worked = asyncio.run(engine.execute("42", "festival_farm", "harvest_festival_wheat", "e2e-work"))
    assert joined["player"]["money"] == 25
    assert worked["player"]["inventory"]["wheat_sack"] == 4
    assert worked["player"]["professions"]["farmer"]["experience"] == 10

    world = WorldEngine(store)
    world.place("42", "riverhold")
    departure = world.travel("42", "whispering_woods", now=1000)
    assert departure["travel"]
    assert world.get_travel_state("42", now=1061) is None
    assert world.player_state("42")["location_key"] == "whispering_woods"
    assert "Sylvain" in NpcEngine(store).react("sylvain", "42")["variant"]["text"]

    event_now = time.time()
    occurrence = EventLifecycle(store).activate("festival_rain", duration_seconds=60, now=event_now)
    assert occurrence["status"] == "active"
    with store.connection() as database:
        database.execute("UPDATE players SET money=25 WHERE discord_id='42'")
    asyncio.run(engine.execute("42", "market_square", "fund_festival", "e2e-contribution"))
    treasury = next(item for item in WorldCreatorService(store).live_operations()["objectives"] if item["key"] == "treasury")
    assert treasury["current"] == 10

    presence_payload = store.get("voice_presence", "presence_sylvain", published=True)["payload"]
    presence = VoicePresence(
        key="presence_sylvain", name=presence_payload["name"],
        presence_type=presence_payload["presence_type"], scene_key=presence_payload["scene_key"],
        voice_profile_key=presence_payload["voice_profile_key"], metadata=presence_payload["metadata"],
    )
    pool = VoiceWorkerPool([VoiceWorkerState("voice_worker_1")])
    assert pool.allocate(presence, guild_id="guild", channel_id="forest-voice").presence_key == "presence_sylvain"

    # Redémarrage logique des services : nouvelles instances, même base.
    restarted_store = ContentStore(world_path)
    restarted_store.initialize()
    restarted_player = GameEngine(restarted_store).player("42")
    assert restarted_player["money"] == 15
    assert restarted_player["inventory"]["wheat_sack"] == 4
    assert EventLifecycle(restarted_store).get(occurrence["occurrence_id"], now=event_now + 1)["status"] == "active"
    assert restarted_store.discord_provision_status()["status"] == "done"
