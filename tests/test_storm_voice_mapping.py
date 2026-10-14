from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from KingdomData import ContentStore
from KingdomData.storm_sainte_pelle_content import audit_storm_voice_mapping
from KingdomData.world_presets import world_preset
from kingdomCore.engine import GameEngine


def _world(tmp_path):
    store = ContentStore(tmp_path / "voice.db")
    store.initialize()
    store.seed(world_preset("storm_sainte_pelle"))
    return store


def _clips(store):
    return [clip for row in store.list("voice_profile", published=True)
            if row["entity_key"] in {"voice_edgar", "voice_roland", "voice_wagner"}
            for clip in row["payload"].get("clips", [])]


def test_audio_01_02_manifest_matches_exactly_80_physical_files(tmp_path):
    assert audit_storm_voice_mapping(world_preset("storm_sainte_pelle")) == {
        "expected": 80, "found": 80, "mapped": 80, "missing": 0,
        "auto_routable": 66, "scenario_disabled_rumours": 8,
        "conditional_closing": 6,
    }
    store = _world(tmp_path)
    clips = _clips(store)
    assert len(clips) == len({clip["audio_key"] for clip in clips}) == 80
    assert Counter(clip["metadata"]["speaker"] for clip in clips) == {
        "edgar": 28, "roland": 26, "wagner": 26,
    }
    declared = set()
    root = Path(__file__).parents[1] / "KingdomData"
    for clip in clips:
        audio = store.get("audio", clip["audio_key"], published=True)["payload"]
        path = root / audio["storage_path"]
        assert path.is_file() and path.stat().st_size > 0
        declared.add(path.resolve())
    physical = {path.resolve() for path in
                (root / "assets" / "storm_sainte_pelle" / "voices").glob("*/*.mp3")}
    assert declared == physical


def test_audio_03_to_09_semantics_variants_and_restrictions(tmp_path):
    store = _world(tmp_path)
    clips = _clips(store)
    groups = {}
    for clip in clips:
        groups.setdefault(clip["metadata"]["variant_group"], []).append(clip)
        assert clip["text"] and "Information importante" not in clip["text"]
    assert {c["audio_key"] for c in groups["edgar_welcome_general"]}.isdisjoint(
        {c["audio_key"] for c in groups["edgar_rumor_roland_long"]}
    )
    assert all(len(group) == 2 for group in groups.values())
    assert sum(c["metadata"]["storm_beta_policy"] == "AUTO_CONTEXTUEL" for c in clips) == 66
    assert sum(c["metadata"]["storm_beta_policy"] == "MANUEL_DESACTIVE_BETA" for c in clips) == 8
    assert sum(c["metadata"]["storm_beta_policy"] == "CONDITIONNEL_FERMETURE" for c in clips) == 6
    assert not any(c["metadata"].get("timeline_event") in {"E02", "E06", "E07", "E11", "E15"}
                   for c in clips)


def test_audio_03_06_08_09_11_12_router_is_local_single_and_cooldown(tmp_path):
    store = _world(tmp_path)
    engine = GameEngine(store)
    with store.connection() as db:
        db.execute("INSERT INTO players(discord_id,updated_at) VALUES('42','now')")
        db.execute("INSERT INTO player_presence(discord_id,online,building_key,updated_at) VALUES('42',1,'edgar_tavern','now')")
    selected = engine.queue_semantic_voice("edgar_tavern", "presence_join", discord_id="42")
    assert selected in {"storm_voice_edgar_00_01", "storm_voice_edgar_00_02"}
    assert engine.queue_semantic_voice("edgar_tavern", "presence_join", discord_id="42") == ""
    assert engine.queue_semantic_voice("deep_mine", "presence_join", discord_id="42") == ""
    assert engine.queue_semantic_voice("edgar_tavern", "manual", discord_id="42") == ""
    assert engine.queue_semantic_voice("edgar_tavern", "building_closed", discord_id="42") in {
        "storm_voice_edgar_12_01", "storm_voice_edgar_12_02",
    }
    assert engine.queue_semantic_voice("edgar_tavern", "E06", discord_id="42") == ""
    pending = store.pending_audio()
    assert len(pending) == 2
    assert all(row["building_key"] == "edgar_tavern" for row in pending)


def test_audio_10_narrative_priority_precedes_generic(tmp_path):
    store = _world(tmp_path)
    with store.connection() as db:
        store.queue_audio(db, "play", "edgar_tavern", audio_key="storm_voice_edgar_00_01",
                          context={"priority": "building_interaction"})
        store.queue_audio(db, "play", "edgar_tavern", audio_key="storm_voice_edgar_07_01",
                          context={"priority": "narrative_event"})
    commands = store.pending_audio()
    assert commands[0]["context"]["priority"] == "narrative_event"

