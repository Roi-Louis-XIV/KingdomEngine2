import sqlite3
from contextlib import contextmanager

import pytest

from KingdomWeb.discord_channels import DiscordChannelAdministrationService, DiscordChannelError


class FakeStore:
    def __init__(self, mapping=None):
        self.mapping = mapping or {}
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("CREATE TABLE building_discord_channels(building_key TEXT PRIMARY KEY,category_id TEXT,text_channel_id TEXT,voice_channel_id TEXT,updated_at TEXT)")

    def list(self, entity_type, published=False):
        if entity_type == "building":
            return [{"entity_key": "forest", "payload": {"name": "Forêt Royale"}}]
        return []

    def get(self, *args, **kwargs):
        raise LookupError

    def building_channels(self, key):
        return self.mapping

    @contextmanager
    def connection(self):
        with self.db:
            yield self.db


class FakeDiscord:
    guild_id = "42"
    def __init__(self, channels):
        self._channels, self.deleted = channels, []

    def channels(self):
        return list(self._channels)

    def delete_channel(self, channel_id):
        self.deleted.append(channel_id)


def channel(cid, name, kind, parent=None):
    return {"id": str(cid), "name": name, "type": kind, "parent_id": str(parent) if parent else None}


def test_audit_protects_manual_channels_inside_duplicate_category():
    client = FakeDiscord([
        channel(100, "🏰 Forêt Royale", 4), channel(101, "foret-royale", 0, 100), channel(102, "🔊 Forêt Royale", 2, 100),
        channel(200, "🌲 🏰 Forêt Royale", 4), channel(201, "🌲 foret-royale", 0, 200), channel(202, "🎵 🔊 Forêt Royale", 2, 200),
        channel(203, "discussion-des-bucherons", 0, 200),
    ])
    service = DiscordChannelAdministrationService(FakeStore({"category_id": "100", "text_channel_id": "101", "voice_channel_id": "102"}), client)
    result = service.audit()
    assert set(result["safe_channel_ids"]) == {"201", "202"}
    assert any(item["id"] == "200" and not item["safe"] for item in result["buildings"][0]["duplicates"])
    assert result["buildings"][0]["protected"][0]["id"] == "203"


def test_cleanup_revalidates_selection_deletes_children_before_category_and_repairs_mapping():
    client = FakeDiscord([
        channel(100, "🏰 Forêt Royale", 4), channel(101, "foret-royale", 0, 100), channel(102, "🔊 Forêt Royale", 2, 100),
        channel(200, "🏰 Forêt Royale", 4), channel(201, "foret-royale", 0, 200), channel(202, "🔊 Forêt Royale", 2, 200),
    ])
    store = FakeStore({"category_id": "999", "text_channel_id": "998", "voice_channel_id": "997"})
    service = DiscordChannelAdministrationService(store, client)
    result = service.cleanup(["200", "202", "201"], True)
    assert result["deleted"] == ["201", "202", "200"]
    assert client.deleted == ["201", "202", "200"]
    row = store.db.execute("SELECT * FROM building_discord_channels WHERE building_key='forest'").fetchone()
    assert (row["category_id"], row["text_channel_id"], row["voice_channel_id"]) == ("100", "101", "102")


def test_cleanup_requires_confirmation_and_refuses_unknown_channel():
    service = DiscordChannelAdministrationService(FakeStore(), FakeDiscord([channel(100, "🏰 Forêt Royale", 4)]))
    with pytest.raises(DiscordChannelError, match="confirmation"):
        service.cleanup([], False)
    with pytest.raises(DiscordChannelError, match="refusés"):
        service.cleanup(["999"], True)
