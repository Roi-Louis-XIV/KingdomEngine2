from __future__ import annotations

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
    assert {item["key"] for item in items} == {"medieval_kingdom", "royal_festival", "space_station"}


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


def test_published_template_can_be_deleted_without_legacy_resurrection(official):
    official.delete("royal_festival", content_type="world_template")
    with pytest.raises(LookupError):
        official.get("royal_festival", content_type="world_template")
    official.migrate_legacy_presets()
    with pytest.raises(LookupError):
        official.get("royal_festival", content_type="world_template")


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
