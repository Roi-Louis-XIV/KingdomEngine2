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
from KingdomVoice.resolver import resolve_building_presences
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
    scenario_start = 1_900_000_000.0
    live_ops = WorldCreatorService(store).start_live_operations(now=scenario_start)
    assert live_ops["started"] and live_ops["scheduled"] == 5

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
    produced = asyncio.run(engine.execute("42", "festival_farm", "prepare_provisions", "e2e-production"))
    assert joined["player"]["money"] == 25
    assert worked["player"]["inventory"]["wheat_sack"] == 4
    assert worked["player"]["professions"]["farmer"]["experience"] == 10
    assert produced["player"]["inventory"]["festival_provision"] == 2

    delivered = asyncio.run(
        engine.execute_delivery("42", "edgar_tavern", "e2e-delivery", {"festival_provision": 2})
    )
    purchased = asyncio.run(engine.execute_purchase("42", "edgar_tavern", "e2e-sale", "royal_ale", 1))
    assert delivered["payments"] == {"money": 4}
    assert purchased["purchase"]["total"] == 8
    assert purchased["player"]["inventory"]["royal_ale"] == 1
    left = asyncio.run(engine.execute("42", "festival_farm", "leave_farmer", "e2e-leave"))
    assert "farmer" not in left["player"]["professions"]
    with store.connection() as database:
        assert database.execute(
            "SELECT active FROM player_professions WHERE discord_id='42' AND profession_key='farmer'"
        ).fetchone()[0] == 0

    world = WorldEngine(store)
    world.place("42", "riverhold")
    departure = world.travel("42", "whispering_woods", now=1000)
    assert departure["travel"]
    assert world.get_travel_state("42", now=1061) is None
    assert world.player_state("42")["location_key"] == "whispering_woods"
    assert "Sylvain" in NpcEngine(store).react("sylvain", "42")["variant"]["text"]

    lifecycle = EventLifecycle(store)
    milestones = {
        45: "festival_rain",
        70: "mine_incident",
        110: "edgar_round",
        135: "festival_storm",
    }
    for minute, event_key in milestones.items():
        occurrence = next(
            item for item in lifecycle.list(now=scenario_start + minute * 60)
            if item["event_key"] == event_key
        )
        assert occurrence["status"] == "active"

    # La fête finale reste bloquée tant que les objectifs du royaume ne sont
    # pas remplis, même lorsque son horaire de +170 minutes est atteint.
    opening = next(
        item for item in lifecycle.list(now=scenario_start + 170 * 60)
        if item["event_key"] == "festival_opening"
    )
    assert opening["status"] == "scheduled"
    with store.connection() as database:
        database.execute("UPDATE players SET money=25 WHERE discord_id='42'")
    asyncio.run(engine.execute("42", "market_square", "fund_festival", "e2e-contribution"))
    treasury = next(item for item in WorldCreatorService(store).live_operations()["objectives"] if item["key"] == "treasury")
    assert treasury["current"] == 10

    # Les autres joueurs du royaume terminent les objectifs collectifs. Le
    # joueur E2E a bien effectué lui-même une contribution via le moteur.
    objectives = WorldCreatorService(store).live_operations()["objectives"]
    with store.connection() as database:
        for objective in objectives:
            missing = int(objective["target"]) - int(objective["current"])
            if missing > 0:
                database.execute(
                    "INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)",
                    (objective["key"], "collective", "festival_esplanade", objective.get("unit", "resource"), missing, '{"source":"e2e_collective"}', "2026-09-10T00:00:00+00:00"),
                )
    assert all(item["progress"] == 100 for item in WorldCreatorService(store).live_operations()["objectives"])
    opening = next(
        item for item in lifecycle.list(now=scenario_start + 170 * 60)
        if item["event_key"] == "festival_opening"
    )
    assert opening["status"] == "active"

    presence_payload = store.get("voice_presence", "presence_sylvain", published=True)["payload"]
    presence = VoicePresence(
        key="presence_sylvain", name=presence_payload["name"],
        presence_type=presence_payload["presence_type"], scene_key=presence_payload["scene_key"],
        voice_profile_key=presence_payload["voice_profile_key"], metadata=presence_payload["metadata"],
    )
    pool = VoiceWorkerPool([VoiceWorkerState("voice_worker_1")])
    assert pool.allocate(presence, guild_id="guild", channel_id="forest-voice").presence_key == "presence_sylvain"
    forest = store.get("building", "forester_lodge", published=True)["payload"]
    resolved = resolve_building_presences(
        "forester_lodge",
        forest,
        store.list("npc", published=True),
        {row["entity_key"]: row["payload"] for row in store.list("voice_presence", published=True)},
    )
    assert resolved[0]["source_key"] == "sylvain"
    assert resolved[0]["scene_key"] and resolved[0]["carries_ambience"] is True

    # Redémarrage logique des services : nouvelles instances, même base.
    restarted_store = ContentStore(world_path)
    restarted_store.initialize()
    restarted_player = GameEngine(restarted_store).player("42")
    assert restarted_player["money"] == 15
    assert restarted_player["inventory"]["wheat_sack"] == 3
    assert restarted_player["inventory"]["royal_ale"] == 1
    persisted_opening = next(
        item for item in EventLifecycle(restarted_store).list(now=scenario_start + 171 * 60)
        if item["event_key"] == "festival_opening"
    )
    assert persisted_opening["status"] == "active"
    assert WorldCreatorService(restarted_store).start_live_operations(now=scenario_start + 172 * 60)["started"] is False
    assert all(item["progress"] == 100 for item in WorldCreatorService(restarted_store).live_operations()["objectives"])
    assert restarted_store.discord_provision_status()["status"] == "done"
