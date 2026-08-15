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
            columns = {row[1] for row in db.execute("PRAGMA table_info(scheduled_actions)")}
            if "category" not in columns:
                db.execute("ALTER TABLE scheduled_actions ADD COLUMN category TEXT NOT NULL DEFAULT ''")
            if "limit_scope" not in columns:
                db.execute("ALTER TABLE scheduled_actions ADD COLUMN limit_scope TEXT NOT NULL DEFAULT 'action'")
            if "result_json" not in columns:
                db.execute("ALTER TABLE scheduled_actions ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'")
            if "claim_hooks_json" not in columns:
                db.execute("ALTER TABLE scheduled_actions ADD COLUMN claim_hooks_json TEXT NOT NULL DEFAULT '[]'")
            profession_columns = {row[1] for row in db.execute("PRAGMA table_info(player_professions)")}
            if "active" not in profession_columns:
                db.execute("ALTER TABLE player_professions ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
            player_columns = {row[1] for row in db.execute("PRAGMA table_info(players)")}
            for name, definition in {
                "display_name": "TEXT NOT NULL DEFAULT ''",
                "avatar_url": "TEXT NOT NULL DEFAULT ''",
                "created_at": "TEXT NOT NULL DEFAULT ''",
            }.items():
                if name not in player_columns:
                    db.execute(f"ALTER TABLE players ADD COLUMN {name} {definition}")
            # Les états d'outil enrichissent l'inventaire, ils ne constituent
            # pas une seconde liste de possessions.
            db.execute(
                "INSERT OR IGNORE INTO inventory(discord_id,item_key,quantity) "
                "SELECT discord_id,tool_key,1 FROM player_tools"
            )
            db.execute(
                "UPDATE inventory SET quantity=1 WHERE quantity<1 AND "
                "EXISTS(SELECT 1 FROM player_tools WHERE player_tools.discord_id=inventory.discord_id AND player_tools.tool_key=inventory.item_key)"
            )

    def save(self, entity_type: str, key: str, payload: dict[str, Any], author: str = "web", expected_version: int | None = None) -> dict[str, Any]:
        key = validate_key(key)
        payload = validate_entity(entity_type, payload)
        self._validate_references(entity_type, key, payload)
        now = _now()
        with self._lock, self.connection() as db:
            latest = int(db.execute("SELECT COALESCE(MAX(version),0) FROM content WHERE entity_type=? AND entity_key=?", (entity_type, key)).fetchone()[0])
            if expected_version is not None and latest != expected_version:
                raise ConflictError(f"Version courante {latest}, version attendue {expected_version}.")
            version = latest + 1
            db.execute("INSERT INTO content VALUES(?,?,?,?,?,?,?,NULL,NULL)", (entity_type, key, version, "draft", _dump(payload), author, now))
            self._outbox(db, "content.draft.saved", entity_type, key, {"version": version})
        return self.get(entity_type, key, version)

    def _validate_references(self, entity_type: str, entity_key: str, payload: dict[str, Any]) -> None:
        """Valide les références du nouveau contrat sans rejeter les effets V1 opaques."""
        if entity_type == "bot" and payload.get("building_key"):
            building_key = str(payload["building_key"])
            if building_key not in {item["entity_key"] for item in self.list("building")}:
                raise ValidationError(f"Bâtiment attribué au bot introuvable : {building_key}")
        if entity_type == "audio" and payload.get("speaker_bot_key"):
            bot_key = str(payload["speaker_bot_key"])
            bots = {item["entity_key"]: item["payload"] for item in self.list("bot")}
            if bot_key not in bots or bots[bot_key].get("bot_type") != "voice":
                raise ValidationError(f"Bot vocal associé au son introuvable : {bot_key}")
        if entity_type != "building":
            return
        items = {item["entity_key"] for item in self.list("item")}
        buildings = {item["entity_key"] for item in self.list("building")} | {entity_key}
        events = {item["entity_key"] for item in self.list("event")}
        audios = {item["entity_key"] for item in self.list("audio")}
        audio_module = payload.get("modules", {}).get("audio", {})
        groups = audio_module.get("groups", [])
        group_keys = {str(group.get("key")) for group in groups}
        for group in groups:
            for audio_key in (track for channel in ("music", "ambience", "sfx", "voice") for track in group.get("tracks", {}).get(channel, [])):
                if str(audio_key) not in audios:
                    raise ValidationError(f"Son du groupe {group.get('key')} introuvable : {audio_key}")
        for route in audio_module.get("event_routes", []):
            if route.get("event") not in events:
                raise ValidationError(f"Événement audio introuvable : {route.get('event')}")
            if route.get("group_key") not in group_keys:
                raise ValidationError(f"Groupe sonore introuvable : {route.get('group_key')}")

        def hooks(value: Any) -> None:
            if not isinstance(value, dict): return
            for entries in value.values():
                for entry in entries if isinstance(entries, list) else [entries]:
                    if entry.get("event") not in events:
                        raise ValidationError(f"Événement référencé introuvable : {entry.get('event')}")

        def effects(values: Any) -> None:
            for effect in values or []:
                kind = effect.get("type")
                if kind == "production":
                    resource = str(effect.get("resource", effect.get("item", "")))
                    if resource not in items | {"money", "energy"}:
                        raise ValidationError(f"Ressource de production introuvable : {resource}")
                    if effect.get("destination") == "building_stock" and str(effect.get("building", entity_key)) not in buildings:
                        raise ValidationError(f"Bâtiment de destination introuvable : {effect.get('building')}")
                if kind in {"tool_grant", "tool_modify"} and str(effect.get("tool")) not in items:
                    raise ValidationError(f"Outil référencé introuvable : {effect.get('tool')}")
                if kind == "play_audio" and str(effect.get("audio_key")) not in audios:
                    raise ValidationError(f"Son référencé introuvable : {effect.get('audio_key')}")
                if kind == "set_audio_group" and str(effect.get("group_key")) not in group_keys:
                    raise ValidationError(f"Groupe sonore référencé introuvable : {effect.get('group_key')}")
                if kind in {"random_result", "random_bundle"}:
                    for outcome in effect.get("outcomes", []): effects(outcome.get("effects", []))
                if kind == "schedule":
                    effects(effect.get("effects", [])); hooks(effect.get("hooks", {}))

        for action in payload.get("actions", []):
            effects(action.get("effects", [])); hooks(action.get("hooks", {}))
        for activity in payload.get("modules", {}).get("activities", []):
            hooks(activity.get("hooks", {}))
            for outcome in activity.get("outcomes", []): effects(outcome.get("effects", []))
        for delivery in payload.get("modules", {}).get("deliveries", []):
            resource = str(delivery.get("item_key", delivery.get("resource", "")))
            destination = str(delivery.get("target_building_key", delivery.get("building", entity_key)))
            currency = str(delivery.get("payment_resource", delivery.get("currency", "money")))
            if resource not in items and payload.get("source") != "KingdomEngine V1": raise ValidationError(f"Ressource livrable introuvable : {resource}")
            if delivery.get("destination", "building_stock") == "building_stock" and destination not in buildings and payload.get("source") != "KingdomEngine V1": raise ValidationError(f"Bâtiment destinataire introuvable : {destination}")
            if currency not in items | {"money", "energy"}: raise ValidationError(f"Monnaie de paiement introuvable : {currency}")
            for event_rule in delivery.get("events", {}).values():
                if event_rule and event_rule.get("event") not in events: raise ValidationError(f"Événement de livraison introuvable : {event_rule.get('event')}")

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

    def delete(self, entity_type: str, key: str, author: str = "web") -> dict[str, Any]:
        """Masque une définition sans détruire son historique versionné."""
        if entity_type not in {"building", "item", "event", "audio"}:
            raise ValidationError("Ce type de contenu ne peut pas être supprimé.")
        current = self.get(entity_type, key)
        with self._lock, self.connection() as db:
            version = int(current["version"]) + 1
            db.execute("UPDATE content SET status='archived' WHERE entity_type=? AND entity_key=? AND status='published'", (entity_type, key))
            db.execute("INSERT INTO content VALUES(?,?,?,?,?,?,?,NULL,NULL)", (entity_type, key, version, "deleted", _dump(current["payload"]), author, _now()))
            self._outbox(db, "content.deleted", entity_type, key, {"version": version})
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
            latest = db.execute("SELECT status FROM content WHERE entity_type=? AND entity_key=? ORDER BY version DESC LIMIT 1", (entity_type, key)).fetchone()
            row = None if version is None and latest and latest[0] == "deleted" else db.execute(query, args).fetchone()
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
            rows = [_row(row) for row in db.execute(query, args)]
            deleted = {(row[0], row[1]) for row in db.execute("SELECT entity_type,entity_key FROM content c WHERE status='deleted' AND version=(SELECT MAX(version) FROM content WHERE entity_type=c.entity_type AND entity_key=c.entity_key)")}
            return [row for row in rows if (row["entity_type"], row["entity_key"]) not in deleted]

    def seed(self, definitions: list[dict[str, Any]]) -> None:
        # Les catalogues référencés sont installés avant les bâtiments afin que
        # la validation stricte soit également applicable aux imports V1.
        # Les catalogues précèdent les bâtiments, puis les bots qui peuvent
        # désormais référencer explicitement un bâtiment provisionné.
        rank = {"building": 1, "bot": 2}
        ordered = sorted(enumerate(definitions), key=lambda pair: (rank.get(pair[1]["type"], 0), pair[0]))
        for _, item in ordered:
            try: self.get(item["type"], item["key"])
            except NotFoundError:
                draft = self.save(item["type"], item["key"], item["payload"], "seed")
                self.publish(item["type"], item["key"], draft["version"], "seed")

    def changes(self, after: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM outbox WHERE id>? ORDER BY id LIMIT ?", (after, min(limit, 500))).fetchall()
        return [{**dict(r), "payload": json.loads(r["payload_json"])} for r in rows]

    def queue_audio(self, db: sqlite3.Connection, command: str, building_key: str, *, audio_key: str = "", group_key: str = "", bot_key: str = "", context: dict[str, Any] | None = None) -> int:
        """Ajoute une instruction durable que KingdomVoice consommera dans un autre processus."""
        cursor = db.execute(
            "INSERT INTO audio_queue(command,building_key,bot_key,audio_key,group_key,context_json,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
            (command, building_key, bot_key, audio_key, group_key, _dump(context or {}), _now()),
        )
        return int(cursor.lastrowid)

    def pending_audio(self, limit: int = 25) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM audio_queue WHERE status='pending' ORDER BY id LIMIT ?", (min(limit, 100),)).fetchall()
            if rows:
                db.executemany("UPDATE audio_queue SET status='processing',attempts=attempts+1 WHERE id=? AND status='pending'", [(row["id"],) for row in rows])
        return [{**dict(row), "context": json.loads(row["context_json"] or "{}")} for row in rows]

    def recover_audio(self) -> int:
        """Remet en attente les commandes laissées en cours par un arrêt de KingdomVoice."""
        with self.connection() as db:
            cursor = db.execute("UPDATE audio_queue SET status='pending',error='' WHERE status='processing'")
        return int(cursor.rowcount)

    def finish_audio(self, command_id: int, error: str = "") -> None:
        with self.connection() as db:
            db.execute(
                "UPDATE audio_queue SET status=?,processed_at=?,error=? WHERE id=?",
                ("failed" if error else "done", _now(), error[:500], command_id),
            )

    def building_channels(self, building_key: str) -> dict[str, str]:
        with self.connection() as db:
            row = db.execute("SELECT * FROM building_discord_channels WHERE building_key=?", (building_key,)).fetchone()
        return dict(row) if row else {}

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
CREATE TABLE IF NOT EXISTS audio_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,command TEXT NOT NULL,building_key TEXT NOT NULL DEFAULT '',bot_key TEXT NOT NULL DEFAULT '',audio_key TEXT NOT NULL DEFAULT '',group_key TEXT NOT NULL DEFAULT '',context_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,processed_at TEXT,error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS audio_queue_pending ON audio_queue(status,id);
CREATE TABLE IF NOT EXISTS building_discord_channels(building_key TEXT PRIMARY KEY,category_id TEXT NOT NULL DEFAULT '',text_channel_id TEXT NOT NULL DEFAULT '',voice_channel_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(discord_id TEXT PRIMARY KEY,money INTEGER NOT NULL DEFAULT 0,energy INTEGER NOT NULL DEFAULT 100,updated_at TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',avatar_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS inventory(discord_id TEXT NOT NULL,item_key TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(discord_id,item_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS player_professions(discord_id TEXT NOT NULL,profession_key TEXT NOT NULL,level INTEGER NOT NULL DEFAULT 1,experience INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(discord_id,profession_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS player_tools(discord_id TEXT NOT NULL,tool_key TEXT NOT NULL,durability INTEGER NOT NULL,max_durability INTEGER NOT NULL,level INTEGER NOT NULL DEFAULT 1,loot_bonus INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(discord_id,tool_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS player_state(discord_id TEXT NOT NULL,state_key TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(discord_id,state_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS player_stats(discord_id TEXT NOT NULL,stat_key TEXT NOT NULL,value REAL NOT NULL,updated_at REAL NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(discord_id,stat_key),FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS random_result_memory(scope TEXT NOT NULL,pool_key TEXT NOT NULL,result_key TEXT NOT NULL,updated_at REAL NOT NULL,PRIMARY KEY(scope,pool_key));
CREATE TABLE IF NOT EXISTS game_sessions(session_key TEXT PRIMARY KEY,discord_id TEXT NOT NULL,building_key TEXT NOT NULL,game_key TEXT NOT NULL,choice_key TEXT NOT NULL,stake_resource TEXT NOT NULL,stake INTEGER NOT NULL,multiplier REAL NOT NULL,status TEXT NOT NULL,confirmation_interaction_id TEXT UNIQUE,result_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,resolved_at TEXT,FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE INDEX IF NOT EXISTS game_sessions_owner ON game_sessions(discord_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS player_presence(discord_id TEXT PRIMARY KEY,online INTEGER NOT NULL DEFAULT 0,voice_channel_id TEXT NOT NULL DEFAULT '',voice_channel_name TEXT NOT NULL DEFAULT '',building_key TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS onboarding_grants(discord_id TEXT PRIMARY KEY,amount INTEGER NOT NULL,granted_at TEXT NOT NULL,FOREIGN KEY(discord_id) REFERENCES players(discord_id));
CREATE TABLE IF NOT EXISTS building_stock(building_key TEXT NOT NULL,item_key TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(building_key,item_key));
CREATE TABLE IF NOT EXISTS action_cooldowns(scope TEXT NOT NULL,building_key TEXT NOT NULL,action_key TEXT NOT NULL,ready_at REAL NOT NULL,PRIMARY KEY(scope,building_key,action_key));
CREATE TABLE IF NOT EXISTS scheduled_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,discord_id TEXT NOT NULL,building_key TEXT NOT NULL,action_key TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',limit_scope TEXT NOT NULL DEFAULT 'player_action',ready_at REAL NOT NULL,effects_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,completed_at TEXT,result_json TEXT NOT NULL DEFAULT '{}',claim_hooks_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS collective_contributions(id INTEGER PRIMARY KEY AUTOINCREMENT,objective_key TEXT NOT NULL,discord_id TEXT NOT NULL,building_key TEXT NOT NULL,resource_key TEXT NOT NULL,amount INTEGER NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_log(id INTEGER PRIMARY KEY AUTOINCREMENT,interaction_id TEXT NOT NULL,discord_id TEXT NOT NULL,source_building TEXT NOT NULL,destination_building TEXT NOT NULL,resource_key TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,total_payment INTEGER NOT NULL,payment_resource TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_interaction_line ON delivery_log(interaction_id,resource_key,destination_building);
CREATE TABLE IF NOT EXISTS action_log(id INTEGER PRIMARY KEY AUTOINCREMENT,interaction_id TEXT UNIQUE NOT NULL,discord_id TEXT NOT NULL,building_key TEXT NOT NULL,action_key TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,admin_id TEXT NOT NULL,player_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,old_value_json TEXT NOT NULL,new_value_json TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admin_audit_player ON admin_audit_log(player_id,created_at DESC);
"""
