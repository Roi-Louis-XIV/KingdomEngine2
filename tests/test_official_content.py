from __future__ import annotations

import json
import sqlite3

import pytest

from KingdomData import ContentStore
from KingdomData.official_content import OfficialContentStore
from KingdomWeb.accounts import SCHEMA_COMPTES


@pytest.fixture()
def official(tmp_path):
    path = tmp_path / "platform.db"
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA_COMPTES)
        db.execute("INSERT INTO web_accounts(id,username,display_name,email,password_salt,password_hash,is_admin,active,created_at) VALUES(1,'platform','Payen Studio','','salt','hash',1,1,'now')")
    store = OfficialContentStore(path)
    store.migrate_legacy_presets()
    return store


def test_legacy_presets_are_migrated_idempotently(official):
    official.migrate_legacy_presets()
    items = official.list(content_type="world_template", published_only=True)
    assert {item["key"] for item in items} == {"medieval_kingdom", "royal_festival", "storm_sainte_pelle", "space_station"}


def test_existing_kingdom_pack_migrates_in_place_to_revision_four(official):
    with official.connection() as db:
        pack_id = db.execute("SELECT id FROM official_content_packs WHERE pack_key='royal_festival'").fetchone()[0]
        row = db.execute("SELECT payload_json FROM official_content_entities WHERE pack_id=? AND entity_type='server_settings' AND entity_key='kingdom_server'", (pack_id,)).fetchone()
        settings = json.loads(row[0]); settings["template_revision"] = 3
        db.execute("UPDATE official_content_entities SET payload_json=? WHERE pack_id=? AND entity_type='server_settings' AND entity_key='kingdom_server'", (json.dumps(settings), pack_id))
        db.execute("UPDATE official_content_packs SET name='La Fête du Royaume' WHERE id=?", (pack_id,))

    official.migrate_legacy_presets()
    official.migrate_legacy_presets()

    current = official.get("royal_festival", published_only=True)
    settings = next(entity["payload"] for entity in current["entities"] if entity["type"] == "server_settings")
    buildings = {entity["key"]: entity["payload"]["name"] for entity in current["entities"] if entity["type"] == "building"}
    assert current["name"] == "Le Royaume"
    assert settings["template_revision"] == settings["workshop_content_revision"] == 4
    assert buildings["edgar_tavern"] == "À la Gueuse Cocu"
    assert len(official.list(content_type="world_template", published_only=True)) == 4


def test_storm_revision_five_syncs_pack_and_existing_workspaces_without_overwrite(official, tmp_path):
    with official.connection() as db:
        pack_id = db.execute(
            "SELECT id FROM official_content_packs WHERE pack_key='storm_sainte_pelle' "
            "AND status='published'"
        ).fetchone()[0]
        settings_row = db.execute(
            "SELECT payload_json FROM official_content_entities WHERE pack_id=? "
            "AND entity_type='server_settings' AND entity_key='kingdom_server'", (pack_id,)
        ).fetchone()
        settings = json.loads(settings_row[0]); settings["template_revision"] = 4
        db.execute(
            "UPDATE official_content_entities SET payload_json=? WHERE pack_id=? "
            "AND entity_type='server_settings' AND entity_key='kingdom_server'",
            (json.dumps(settings), pack_id),
        )
        db.execute(
            "DELETE FROM official_content_entities WHERE pack_id=? AND entity_type='audio' "
            "AND entity_key LIKE 'storm_voice_%'", (pack_id,),
        )
        for profile_key in ("voice_edgar", "voice_roland", "voice_wagner"):
            row = db.execute(
                "SELECT payload_json FROM official_content_entities WHERE pack_id=? "
                "AND entity_type='voice_profile' AND entity_key=?", (pack_id, profile_key),
            ).fetchone()
            payload = json.loads(row[0]); payload["clips"] = []
            db.execute(
                "UPDATE official_content_entities SET payload_json=? WHERE pack_id=? "
                "AND entity_type='voice_profile' AND entity_key=?",
                (json.dumps(payload), pack_id, profile_key),
            )
        db.commit()

    workspace = official.create_workspace("storm_sainte_pelle", 1, tmp_path)
    old_world = ContentStore(workspace["database_path"])
    # Simule un atelier créé par l'ancienne version, avant la synchronisation
    # automatique ajoutée à create_workspace().
    with old_world.connection() as db:
        db.execute("DELETE FROM content WHERE entity_type='audio' AND entity_key LIKE 'storm_voice_%'")
        for profile_key in ("voice_edgar", "voice_roland", "voice_wagner"):
            rows = db.execute(
                "SELECT version,payload_json FROM content WHERE entity_type='voice_profile' "
                "AND entity_key=?", (profile_key,),
            ).fetchall()
            for row in rows:
                payload = json.loads(row["payload_json"])
                payload["clips"] = [clip for clip in payload.get("clips", [])
                                    if not clip.get("audio_key", "").startswith("storm_voice_")]
                db.execute(
                    "UPDATE content SET payload_json=? WHERE entity_type='voice_profile' "
                    "AND entity_key=? AND version=?", (json.dumps(payload), profile_key, row["version"]),
                )
    building = old_world.get("building", "edgar_tavern")
    changed = {**building["payload"], "name": "Taverne personnalisée"}
    saved = old_world.save("building", "edgar_tavern", changed, expected_version=building["version"])
    old_world.publish("building", "edgar_tavern", saved["version"])
    custom_audio = old_world.save("audio", "custom_admin_voice", {
        "name": "Voix personnelle", "emoji": "🎙️", "description": "Import administrateur",
        "audio_type": "voice", "storage_path": "custom/admin.mp3", "file_name": "admin.mp3",
        "volume": 1, "loop": False, "tags": ["custom"],
    })
    old_world.publish("audio", "custom_admin_voice", custom_audio["version"])
    profile = old_world.get("voice_profile", "voice_edgar")
    profile_payload = dict(profile["payload"])
    profile_payload["clips"] = [{"key": "custom", "name": "Personnalisée", "trigger": "manual",
                                  "audio_key": "custom_admin_voice", "text": "Personnalisée"}]
    saved_profile = old_world.save("voice_profile", "voice_edgar", profile_payload,
                                   expected_version=profile["version"])
    old_world.publish("voice_profile", "voice_edgar", saved_profile["version"])

    assert not [row for row in old_world.list("audio") if row["entity_key"].startswith("storm_voice_")]
    before_pack_id = official.workspace(workspace["workspace_token"], 1)["pack_id"]
    saved_revision = official.save_workspace(workspace["workspace_token"], 1)
    draft_workspace = official.workspace(workspace["workspace_token"], 1)
    assert draft_workspace["pack_id"] != before_pack_id
    assert draft_workspace["pack_id"] == saved_revision["id"]
    assert draft_workspace["origin"] == f"workspace:{workspace['workspace_token']}"

    official.migrate_legacy_presets()
    official.migrate_legacy_presets()

    pack = official.get("storm_sainte_pelle", published_only=True)
    settings = next(entity["payload"] for entity in pack["entities"]
                    if entity["type"] == "server_settings" and entity["key"] == "kingdom_server")
    assert settings["template_revision"] == 5
    assert len([entity for entity in pack["entities"] if entity["type"] == "audio"
                and entity["key"].startswith("storm_voice_")]) == 80

    migrated = ContentStore(workspace["database_path"])
    voices = [row for row in migrated.list("audio") if row["entity_key"].startswith("storm_voice_")]
    assert len(voices) == 80
    assert {row["status"] for row in voices} == {"published"}
    assert {row["payload"]["audio_type"] for row in voices} == {"voice"}
    assert all(row["payload"].get(field) for row in voices for field in (
        "storage_path", "description", "tags", "semantic_key", "speaker", "building_key", "variant_group",
    ))
    assert {speaker: sum(row["payload"]["speaker"] == speaker for row in voices)
            for speaker in ("edgar", "roland", "wagner")} == {
                "edgar": 28, "roland": 26, "wagner": 26,
            }
    assert migrated.get("building", "edgar_tavern")["payload"]["name"] == "Taverne personnalisée"
    assert migrated.get("audio", "custom_admin_voice")["payload"]["name"] == "Voix personnelle"
    expected = {"voice_edgar": 28, "voice_roland": 26, "voice_wagner": 26}
    for key, count in expected.items():
        clips = migrated.get("voice_profile", key)["payload"]["clips"]
        assert len([clip for clip in clips if clip.get("audio_key", "").startswith("storm_voice_")]) == count
    assert any(clip.get("audio_key") == "custom_admin_voice"
               for clip in migrated.get("voice_profile", "voice_edgar")["payload"]["clips"])

    fresh_workspace = official.create_workspace("storm_sainte_pelle", 1, tmp_path)
    fresh = ContentStore(fresh_workspace["database_path"])
    assert len([row for row in fresh.list("audio") if row["entity_key"].startswith("storm_voice_")]) == 80

    # La même synchronisation reste active si la révision publiée courante
    # provient elle-même de save_workspace(), et non plus du pack legacy.
    official.set_status("storm_sainte_pelle", "published", version=saved_revision["version"])
    with migrated.connection() as db:
        db.execute("DELETE FROM content WHERE entity_type='audio' AND entity_key LIKE 'storm_voice_%'")
    assert not [row for row in migrated.list("audio") if row["entity_key"].startswith("storm_voice_")]
    assert official.get("storm_sainte_pelle", published_only=True)["origin"].startswith("workspace:")
    official.migrate_legacy_presets()
    official.migrate_legacy_presets()
    assert len([row for row in migrated.list("audio") if row["entity_key"].startswith("storm_voice_")]) == 80
    assert migrated.get("building", "edgar_tavern")["payload"]["name"] == "Taverne personnalisée"
    assert migrated.get("audio", "custom_admin_voice")["payload"]["name"] == "Voix personnelle"

def test_archived_bundled_template_is_restored_without_duplication(official):
    official.migrate_legacy_presets()
    before = official.list(content_type="world_template")
    festival = next(item for item in before if item["key"] == "royal_festival")
    official.set_status("royal_festival", "archived", version=festival["version"])

    official.migrate_legacy_presets()

    visible = official.list(content_type="world_template", published_only=True)
    restored = [item for item in visible if item["key"] == "royal_festival"]
    assert len(restored) == 1
    assert restored[0]["status"] == "published"
    assert restored[0]["version"] == festival["version"]
    medieval = official.get("medieval_kingdom", published_only=True)
    assert medieval["validation"]["valid"]
    assert {"buildings", "items", "professions", "events", "calendar"} <= set(medieval["validation"]["coverage"]["represented"])


def test_editing_a_published_pack_creates_an_independent_draft(official):
    published = official.get("space_station", published_only=True)
    published["description"] = "Nouvelle description"
    draft = official.save(published, key=published["key"])
    assert draft["version"] == 2
    assert draft["status"] == "draft"
    assert official.get("space_station", published_only=True)["version"] == 1
    official.set_status("space_station", "published", version=2)
    assert official.get("space_station", published_only=True)["version"] == 2


def test_clone_survives_later_template_edits(official, tmp_path):
    template = official.get("medieval_kingdom", published_only=True)
    world = ContentStore(tmp_path / "world.db")
    world.initialize()
    world.seed(template["entities"])
    original_name = world.get("building", "market_square")["payload"]["name"]
    template["entities"] = [entity for entity in template["entities"] if entity["key"] != "market_square"]
    official.save(template, key=template["key"])
    assert world.get("building", "market_square")["payload"]["name"] == original_name


def test_publication_is_blocked_for_missing_world_settings(official):
    draft = official.save({
        "key": "broken_world", "name": "Cassé", "content_type": "world_template",
        "entities": [{"type": "item", "key": "stone", "payload": {"name": "Pierre", "emoji": "🪨", "description": "", "category": "resource"}}],
    })
    assert not draft["validation"]["valid"]
    with pytest.raises(Exception, match="Publication bloquée"):
        official.set_status("broken_world", "published")


def test_full_studio_workspace_creates_a_new_independent_revision(official, tmp_path):
    workspace = official.create_workspace("medieval_kingdom", 1, tmp_path)
    world = ContentStore(workspace["database_path"])
    current = world.get("building", "market_square")
    changed = dict(current["payload"])
    changed["name"] = "Place du modèle éditée"
    world.save("building", "market_square", changed, expected_version=current["version"])

    revision = official.save_workspace(workspace["workspace_token"], 1)

    assert revision["status"] == "draft"
    assert revision["version"] == 2
    assert next(entity for entity in revision["entities"] if entity["key"] == "market_square")["payload"]["name"] == "Place du modèle éditée"
    assert official.get("medieval_kingdom", published_only=True)["version"] == 1


def test_community_catalog_is_separate_from_official_catalog(official):
    source = official.get("space_station", published_only=True)
    community = official.save({
        **source,
        "key": "community_crew_world",
        "name": "Monde de l'équipage",
        "catalog_scope": "community",
        "owner_account_id": 1,
        "source_world_slug": "aurora-live",
    })
    official.set_status(community["key"], "published", version=community["version"])

    assert not any(item["key"] == community["key"] for item in official.list(catalog_scope="official"))
    assert any(item["key"] == community["key"] for item in official.list(catalog_scope="community", published_only=True))


def test_required_royal_festival_is_restored_after_legacy_tombstone(official):
    official.delete("royal_festival", content_type="world_template")
    with pytest.raises(LookupError):
        official.get("royal_festival", content_type="world_template")
    assert official.catalog_state("royal_festival")["tombstoned"] is True

    official.migrate_legacy_presets()

    restored = official.get("royal_festival", content_type="world_template", published_only=True)
    settings = next(
        entity["payload"] for entity in restored["entities"]
        if entity["type"] == "server_settings" and entity["key"] == "kingdom_server"
    )
    state = official.catalog_state("royal_festival")
    assert settings["template_revision"] == 4
    assert state["tombstoned"] is False
    assert state["versions"] == [{
        "version": 1, "status": "published", "origin": "legacy_world_presets",
    }]


def test_building_preset_opens_with_a_real_editable_building(official, tmp_path):
    preset = official.save({
        "key": "watchtower", "name": "Tour de garde",
        "content_type": "building_preset", "entities": [],
    })
    assert preset["validation"]["valid"]
    building = next(item for item in preset["entities"] if item["type"] == "building")
    workspace = official.create_workspace(
        preset["key"], 1, tmp_path, content_type="building_preset"
    )
    world = ContentStore(workspace["database_path"])
    assert world.get("building", building["key"])["payload"]["name"] == "Tour de garde"
