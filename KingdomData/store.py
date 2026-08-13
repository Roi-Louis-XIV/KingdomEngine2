"""Persistance SQLite transactionnelle, versionnée et partagée par les cinq modules."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterator

from .schemas import ValidationError, validate_entity, validate_key


class ConflictError(RuntimeError):
    pass


class NotFoundError(LookupError):
    pass


class ContentStore:
    def __init__(self, path: str | Path | None = None) -> None:
        configured = path or os.getenv("KINGDOM_DATABASE", "var/kingdom.db")
        self.path = Path(configured)
        self._lock = RLock()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def initialize(self) -> None:
        with self.connection() as db:
            db.executescript(SCHEMA)

    def save(self, entity_type: str, key: str, payload: dict[str, Any], author: str = "web", expected_version: int | None = None) -> dict[str, Any]:
        key = validate_key(key)
        payload = validate_entity(entity_type, payload)
        now = _now()
        with self._lock, self.connection() as db:
            latest = int(db.execute("SELECT COALESCE(MAX(version),0) FROM content WHERE entity_type=? AND entity_key=?", (entity_type, key)).fetchone()[0])
            if expected_version is not None and latest != expected_version:
                raise ConflictError(f"Version courante {latest}, version attendue {expected_version}.")
            version = latest + 1
            db.execute("INSERT INTO content VALUES(?,?,?,?,?,?,?,NULL,NULL)", (entity_type, key, version, "draft", _dump(payload), author, now))
            self._outbox(db, "content.draft.saved", entity_type, key, {"version": version})
        return self.get(entity_type, key, version)

    def publish(self, entity_type: str, key: str, version: int, author: str = "web") -> dict[str, Any]:
        key = validate_key(key)
        with self._lock, self.connection() as db:
            row = db.execute("SELECT status FROM content WHERE entity_type=? AND entity_key=? AND version=?", (entity_type, key, version)).fetchone()
            if not row:
                raise NotFoundError("Révision introuvable.")
            if row[0] != "draft":
                raise ConflictError("Seul un brouillon peut être publié.")
            db.execute("UPDATE content SET status='archived' WHERE entity_type=? AND entity_key=? AND status='published'", (entity_type, key))
            db.execute("UPDATE content SET status='published',published_at=?,published_by=? WHERE entity_type=? AND entity_key=? AND version=?", (_now(), author, entity_type, key, version))
            self._outbox(db, "content.published", entity_type, key, {"version": version})
        return self.get(entity_type, key, version)

    def get(self, entity_type: str, key: str, version: int | None = None, published: bool = False) -> dict[str, Any]:
        query = "SELECT * FROM content WHERE entity_type=? AND entity_key=?"
        args: list[Any] = [entity_type, validate_key(key)]
        if version is not None:
            query += " AND version=?"; args.append(version)
        elif published:
            query += " AND status='published'"
        else:
            query += " ORDER BY version DESC LIMIT 1"
        with self.connection() as db:
            row = db.execute(query, args).fetchone()
        if not row:
            raise NotFoundError(f"{entity_type}/{key} introuvable.")
        return _row(row)

    def list(self, entity_type: str | None = None, published: bool = False) -> list[dict[str, Any]]:
        clauses, args = [], []
        if entity_type: clauses.append("entity_type=?"); args.append(entity_type)
        if published: clauses.append("status='published'")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        query = "SELECT c.* FROM content c JOIN (SELECT entity_type,entity_key,MAX(version) v FROM content" + where + " GROUP BY entity_type,entity_key) x ON x.entity_type=c.entity_type AND x.entity_key=c.entity_key AND x.v=c.version ORDER BY c.entity_type,c.entity_key"
        with self.connection() as db:
            return [_row(row) for row in db.execute(query, args)]

    def seed(self, definitions: list[dict[str, Any]]) -> None:
        for item in definitions:
            try: self.get(item["type"], item["key"])
            except NotFoundError:
                draft = self.save(item["type"], item["key"], item["payload"], "seed")
                self.publish(item["type"], item["key"], draft["version"], "seed")

    def changes(self, after: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM outbox WHERE id>? ORDER BY id LIMIT ?", (after, min(limit, 500))).fetchall()
        return [{**dict(r), "payload": json.loads(r["payload_json"])} for r in rows]

    @staticmethod
    def _outbox(db: sqlite3.Connection, kind: str, aggregate_type: str, aggregate_key: str, payload: dict[str, Any]) -> None:
        db.execute("INSERT INTO outbox(kind,aggregate_type,aggregate_key,payload_json,created_at) VALUES(?,?,?,?,?)", (kind, aggregate_type, aggregate_key, _dump(payload), _now()))


def _now() -> str: return datetime.now(timezone.utc).isoformat()
def _dump(value: Any) -> str: return json.dumps(value, ensure_ascii=False, sort_keys=True)
def _row(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row); result["payload"] = json.loads(result.pop("payload_json")); return result


SCHEMA = """
CREATE TABLE IF NOT EXISTS content(entity_type TEXT NOT NULL,entity_key TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT,published_by TEXT,PRIMARY KEY(entity_type,entity_key,version));
CREATE UNIQUE INDEX IF NOT EXISTS one_published ON content(entity_type,entity_key) WHERE status='published';
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,aggregate_type TEXT NOT NULL,aggregate_key TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(discord_id TEXT PRIMARY KEY,money INTEGER NOT NULL DEFAULT 0,energy INTEGER NOT NULL DEFAULT 100,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory(discord_id TEXT NOT NULL,item_key TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(discord_id,item_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS action_log(id INTEGER PRIMARY KEY AUTOINCREMENT,interaction_id TEXT UNIQUE NOT NULL,discord_id TEXT NOT NULL,building_key TEXT NOT NULL,action_key TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
"""
