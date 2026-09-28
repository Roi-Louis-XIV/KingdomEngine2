"""Parcours ciblés du nouveau scénario officiel, sans toucher au pack précédent."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from datetime import datetime, timezone

from KingdomData import ContentStore
from KingdomData.official_content import OfficialContentStore
from KingdomData.world_presets import world_preset
from KingdomWeb.accounts import SCHEMA_COMPTES
from KingdomWeb.world_creator import WorldCreatorService
from kingdomCore.engine import GameEngine
from kingdomEvent.lifecycle import EventLifecycle


def _world(tmp_path, name="world"):
    store = ContentStore(tmp_path / f"{name}.db")
    store.initialize()
    store.seed(world_preset("storm_sainte_pelle"))
    return store


def test_new_official_template_is_published_once_and_clones_cleanly(tmp_path):
    path = tmp_path / "platform.db"
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA_COMPTES)
    official = OfficialContentStore(path)
    official.migrate_legacy_presets()
    official.migrate_legacy_presets()
    packs = [entry for entry in official.list(content_type="world_template", published_only=True)
             if entry["key"] == "storm_sainte_pelle"]
    assert len(packs) == 1
    assert packs[0]["catalog_scope"] == "official"
    template = official.get("storm_sainte_pelle", published_only=True)
    assert template["validation"]["valid"]
    world = ContentStore(tmp_path / "installed.db")
    world.initialize()
    world.seed(template["entities"])
    assert {row["entity_key"] for row in world.list("building", published=True)} >= {
        "market_square", "old_bridge", "saint_shovel_church", "deep_mine", "royal_forge",
    }
    assert len(world.list("quest", published=True)) >= 20
    assert world.get("npc", "church_priest", published=True)["payload"]["voice_presence_key"] == "presence_church_priest"
    assert not any(row["entity_key"] == "festival_esplanade" for row in world.list("building", published=True))
    assert any(row["key"] == "festival_esplanade" for row in world_preset("royal_festival") if row["type"] == "building")


def test_quest_board_and_mine_repair_survive_restart(tmp_path):
    world = _world(tmp_path)
    start = time.time() - 106 * 60
    WorldCreatorService(world).start_live_operations(now=start)
    engine = GameEngine(world)
    engine.accept_quest("42", "p01_first_steps", "accept-first")
    for index, key in enumerate(("edgar_tavern", "deep_mine", "forester_lodge")):
        engine.record_quest_visit("42", f"visit-{index}", building_key=key)
    assert engine.quest_board("42")["active"]["status"] == "ready"
    assert engine.claim_quest("42", "p01_first_steps", "claim-first")["reward_xp"] == 40
    assert GameEngine(ContentStore(world.path)).player("42")["quest_experience"] == 40

    with world.connection() as db:
        db.execute("INSERT OR REPLACE INTO inventory(discord_id,item_key,quantity) VALUES('42','oak_timber',8)")
        db.execute("INSERT OR REPLACE INTO inventory(discord_id,item_key,quantity) VALUES('42','stone_block',8)")
    lifecycle = EventLifecycle(world)
    assert next(item for item in lifecycle.list() if item["event_key"] == "storm_mine_damage")["status"] == "active"
    asyncio.run(engine.execute("42", "deep_mine", "deposit_mine_wood_8", "mine-wood"))
    asyncio.run(engine.execute("42", "deep_mine", "deposit_mine_stone_8", "mine-stone"))
    asyncio.run(engine.execute("42", "deep_mine", "start_storm_mine_repaired", "mine-start"))
    with world.connection() as db:
        db.execute("UPDATE scheduled_actions SET ready_at=0 WHERE discord_id='42' AND action_key='storm_mine_repaired'")
    restarted = GameEngine(ContentStore(world.path))
    asyncio.run(restarted.execute("42", "deep_mine", "claim_storm_mine_repaired", "mine-finish"))
    assert next(item for item in EventLifecycle(world).list() if item["event_key"] == "storm_mine_damage")["status"] == "finished"
    with world.connection() as db:
        count = db.execute("SELECT COALESCE(SUM(amount),0) FROM collective_contributions WHERE objective_key='storm_mine_repaired'").fetchone()[0]
    assert count == 1


def test_only_the_true_mass_variant_activates_at_minute_170(tmp_path):
    for name, completed, expected in [
        ("full", True, "storm_mass_full"),
        ("deferred", False, "storm_mass_deferred"),
    ]:
        world = _world(tmp_path, name)
        start = time.time() - 171 * 60
        WorldCreatorService(world).start_live_operations(now=start)
        if completed:
            stamp = datetime.fromtimestamp(start + 160 * 60, timezone.utc).isoformat()
            with world.connection() as db:
                for objective, building, resource, amount in [
                    ("church_tree_cleared", "saint_shovel_church", "progress", 3),
                    ("church_wood", "saint_shovel_church", "oak_timber", 40),
                    ("church_stone", "saint_shovel_church", "stone_block", 28),
                    ("church_brackets", "saint_shovel_church", "church_bracket", 4),
                    ("church_provisions", "saint_shovel_church", "storm_ration", 8),
                    ("church_assembly", "saint_shovel_church", "progress", 2),
                ]:
                    db.execute("INSERT INTO collective_contributions(objective_key,discord_id,building_key,resource_key,amount,metadata_json,created_at) VALUES(?,?,?,?,?,'{}',?)",
                               (objective, "builder", building, resource, amount, stamp))
        states = {item["event_key"]: item["status"] for item in EventLifecycle(world).list()}
        variants = {key: states[key] for key in ("storm_mass_full", "storm_mass_partial", "storm_mass_deferred")}
        assert variants[expected] == "active", variants
        assert sum(status == "active" for status in variants.values()) == 1, variants
        assert all(status in {"active", "disabled"} for status in variants.values())
