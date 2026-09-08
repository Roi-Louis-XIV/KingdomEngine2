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
    store = OfficialContentStore(path)
    store.migrate_legacy_presets()
    return store


def test_legacy_presets_are_migrated_idempotently(official):
    official.migrate_legacy_presets()
    items = official.list(content_type="world_template", published_only=True)
    assert {item["key"] for item in items} == {"medieval_kingdom", "space_station"}
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
