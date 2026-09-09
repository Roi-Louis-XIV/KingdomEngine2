"""Catalogue versionné de contenus officiels Payen Studio.

Les packs vivent dans la base de plateforme, jamais dans une base cliente.
Une installation clone leurs entités dans KingdomData : aucune référence
runtime vers le catalogue officiel n'est conservée.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import re
import sqlite3
import secrets
from pathlib import Path
from typing import Any

from .schemas import ValidationError, validate_entity, validate_key
from .world_presets import PRESET_CATALOG, world_preset


CONTENT_TYPES = {
    "world_template", "building_preset", "npc_preset", "event_preset",
    "calendar_preset", "item_preset", "activity_preset", "audio_pack", "example",
}
STATUSES = {"draft", "published", "archived"}
FEATURES = (
    "locations", "routes", "buildings", "actions", "activities",
    "professions", "items", "commerce", "recipes", "deliveries", "npcs",
    "events", "calendar", "weather", "audio", "voice", "interfaces",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return validate_key(value)


class OfficialContentStore:
    """CRUD de plateforme et clonage des modèles publiés."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def connection(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def migrate_legacy_presets(self) -> None:
        """Importe une seule fois les modèles historiques sans les modifier."""
        catalog = {item["key"]: item for item in PRESET_CATALOG}
        with self.connection() as db:
            for key in (item["key"] for item in PRESET_CATALOG if item["key"] != "blank"):
                exists = db.execute(
                    "SELECT 1 FROM official_content_packs WHERE pack_key=? AND content_type='world_template'",
                    (key,),
                ).fetchone()
                deleted = db.execute(
                    "SELECT 1 FROM official_content_tombstones WHERE pack_key=? AND content_type='world_template'",
                    (key,),
                ).fetchone()
                if deleted:
                    continue
                meta = catalog[key]
                if exists:
                    current = db.execute(
                        "SELECT id,origin FROM official_content_packs WHERE pack_key=? AND content_type='world_template' "
                        "AND status='published' ORDER BY version DESC LIMIT 1", (key,),
                    ).fetchone()
                    settings_row = current and db.execute(
                        "SELECT payload_json FROM official_content_entities WHERE pack_id=? "
                        "AND entity_type='server_settings' AND entity_key='kingdom_server' LIMIT 1",
                        (current["id"],),
                    ).fetchone()
                    current_revision = int(json.loads(settings_row[0]).get("template_revision", 0)) if settings_row else 0
                    has_audio = current and db.execute(
                        "SELECT 1 FROM official_content_entities WHERE pack_id=? AND entity_type='audio' LIMIT 1",
                        (current["id"],),
                    ).fetchone()
                    needs_bundled_update = current_revision < 2 if key == "royal_festival" else not has_audio
                    # Migration ciblée des seuls presets livrés avec le code.
                    # Les copies et contenus créés par les administrateurs ne
                    # sont jamais réécrits par un démarrage de KingdomWeb.
                    if current and current["origin"] == "legacy_world_presets" and needs_bundled_update:
                        self._replace_entities(db, int(current["id"]), world_preset(key))
                        db.execute(
                            "UPDATE official_content_packs SET updated_at=? WHERE id=?",
                            (_now(), current["id"]),
                        )
                    continue
                now = _now()
                cursor = db.execute(
                    "INSERT INTO official_content_packs(pack_key,content_type,version,status,name,description,category,emoji,tags_json,author,origin,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (key, "world_template", 1, "published", meta["name"], meta["description"],
                     "Monde complet", meta["emoji"], json.dumps([meta["tone"], "officiel"]),
                     "Payen Studio", "legacy_world_presets", now, now, now),
                )
                self._replace_entities(db, int(cursor.lastrowid), world_preset(key))
            db.commit()

    def list(self, *, content_type: str | None = None, published_only: bool = False,
             search: str = "", catalog_scope: str | None = None,
             owner_account_id: int | None = None) -> list[dict[str, Any]]:
        clauses, args = [], []
        if content_type:
            clauses.append("p.content_type=?"); args.append(content_type)
        if published_only:
            clauses.append("p.status='published'")
        if catalog_scope:
            clauses.append("p.catalog_scope=?"); args.append(catalog_scope)
        if owner_account_id is not None:
            clauses.append("p.owner_account_id=?"); args.append(int(owner_account_id))
        if search:
            clauses.append("(p.name LIKE ? OR p.description LIKE ? OR p.tags_json LIKE ?)")
            term = f"%{search}%"; args.extend([term, term, term])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connection() as db:
            rows = db.execute(
                f"SELECT p.*,COUNT(e.entity_key) entity_count FROM official_content_packs p LEFT JOIN official_content_entities e ON e.pack_id=p.id {where} GROUP BY p.id ORDER BY p.updated_at DESC",
                args,
            ).fetchall()
        return [self._pack(row) for row in rows]

    def get(self, key: str, *, version: int | None = None,
            published_only: bool = False, content_type: str = "world_template",
            catalog_scope: str | None = None) -> dict[str, Any]:
        clauses = ["pack_key=?", "content_type=?"]
        args: list[Any] = [key, content_type]
        if version is not None:
            clauses.append("version=?"); args.append(version)
        if published_only:
            clauses.append("status='published'")
        if catalog_scope:
            clauses.append("catalog_scope=?"); args.append(catalog_scope)
        with self.connection() as db:
            row = db.execute(
                f"SELECT * FROM official_content_packs WHERE {' AND '.join(clauses)} ORDER BY version DESC LIMIT 1",
                args,
            ).fetchone()
            if not row:
                raise LookupError("Contenu officiel introuvable.")
            entities = db.execute(
                "SELECT entity_type type,entity_key key,payload_json,sort_order,source_entity_key,source_version FROM official_content_entities WHERE pack_id=? ORDER BY sort_order,entity_type,entity_key",
                (row["id"],),
            ).fetchall()
        result = self._pack(row)
        result["entities"] = [
            {"type": item["type"], "key": item["key"], "payload": json.loads(item["payload_json"]),
             "source_entity_key": item["source_entity_key"], "source_version": item["source_version"]}
            for item in entities
        ]
        result["validation"] = validate_official_pack(result)
        return result

    def save(self, data: dict[str, Any], *, key: str | None = None) -> dict[str, Any]:
        content_type = str(data.get("content_type", "world_template"))
        if content_type not in CONTENT_TYPES:
            raise ValueError("Type de contenu officiel invalide.")
        pack_key = _slug(key or data.get("key") or data.get("name", ""))
        source = None
        try:
            source = self.get(pack_key, content_type=content_type)
        except LookupError:
            pass
        version = int(source["version"] + 1) if source and source["status"] != "draft" else int(source["version"] if source else 1)
        entities = deepcopy(data.get("entities", source.get("entities", []) if source else []))
        if content_type == "building_preset" and not any(item.get("type") == "building" for item in entities):
            entities.append({
                "type": "building",
                "key": f"{pack_key}_building"[:64],
                "payload": {
                    "name": str(data.get("name") or "Nouveau bâtiment"),
                    "emoji": str(data.get("emoji") or "🏰"),
                    "description": str(data.get("description") or "Bâtiment prêt à configurer."),
                    "entity_kind": "institution", "modules": {}, "actions": [],
                },
            })
        now = _now()
        with self.connection() as db:
            # Une recréation explicite depuis l'administration lève la pierre
            # tombale posée par une suppression antérieure du même identifiant.
            db.execute(
                "DELETE FROM official_content_tombstones WHERE pack_key=? AND content_type=?",
                (pack_key, content_type),
            )
            row = db.execute(
                "SELECT id FROM official_content_packs WHERE pack_key=? AND content_type=? AND version=?",
                (pack_key, content_type, version),
            ).fetchone()
            values = (
                str(data.get("name", source.get("name", pack_key) if source else pack_key)),
                str(data.get("description", source.get("description", "") if source else "")),
                str(data.get("category", source.get("category", "") if source else "")),
                str(data.get("emoji", source.get("emoji", "◇") if source else "◇")),
                str(data.get("illustration_path", source.get("illustration_path", "") if source else "")),
                json.dumps(list(data.get("tags", source.get("tags", []) if source else [])), ensure_ascii=False),
                str(data.get("author", "Payen Studio")), now,
            )
            if row:
                pack_id = int(row["id"])
                db.execute("UPDATE official_content_packs SET name=?,description=?,category=?,emoji=?,illustration_path=?,tags_json=?,author=?,updated_at=? WHERE id=?", (*values, pack_id))
            else:
                scope = str(data.get("catalog_scope", source.get("catalog_scope", "official") if source else "official"))
                if scope not in {"official", "community"}:
                    raise ValueError("Catalogue invalide.")
                cursor = db.execute(
                    "INSERT INTO official_content_packs(pack_key,content_type,version,status,name,description,category,emoji,illustration_path,tags_json,author,origin,catalog_scope,owner_account_id,source_world_slug,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (pack_key, content_type, version, *values[:-1], str(data.get("origin", "platform")), scope,
                     data.get("owner_account_id", source.get("owner_account_id") if source else None),
                     str(data.get("source_world_slug", source.get("source_world_slug", "") if source else "")), now, now),
                )
                pack_id = int(cursor.lastrowid)
            self._replace_entities(db, pack_id, entities)
            db.commit()
        return self.get(pack_key, version=version, content_type=content_type)

    def delete(self, key: str, *, content_type: str = "world_template") -> list[str]:
        """Supprime toutes les révisions et empêche le retour d'un preset historique."""
        with self.connection() as db:
            workspaces = [str(row[0]) for row in db.execute(
                "SELECT w.database_path FROM official_edit_workspaces w "
                "JOIN official_content_packs p ON p.id=w.pack_id "
                "WHERE p.pack_key=? AND p.content_type=?", (key, content_type),
            ).fetchall()]
            cursor = db.execute(
                "DELETE FROM official_content_packs WHERE pack_key=? AND content_type=?",
                (key, content_type),
            )
            if not cursor.rowcount:
                raise LookupError("Template introuvable.")
            db.execute(
                "INSERT INTO official_content_tombstones(pack_key,content_type,deleted_at) VALUES(?,?,?) "
                "ON CONFLICT(pack_key,content_type) DO UPDATE SET deleted_at=excluded.deleted_at",
                (key, content_type, _now()),
            )
            db.commit()
        for value in workspaces:
            path = Path(value)
            if path.name and path.parent.name == "official-workspaces":
                path.unlink(missing_ok=True)
        return workspaces

    def duplicate(self, key: str, new_key: str, name: str = "", *, content_type: str = "world_template") -> dict[str, Any]:
        source = self.get(key, content_type=content_type)
        source.update({"key": _slug(new_key), "name": name or f"Copie de {source['name']}", "origin": f"duplicate:{key}"})
        return self.save(source)

    def set_status(self, key: str, status: str, *, version: int | None = None,
                   content_type: str = "world_template") -> dict[str, Any]:
        if status not in STATUSES:
            raise ValueError("Statut invalide.")
        pack = self.get(key, version=version, content_type=content_type)
        if status == "published":
            validation = pack["validation"]
            if validation["errors"]:
                raise ValidationError("Publication bloquée : " + validation["errors"][0])
        with self.connection() as db:
            if status == "published":
                db.execute("UPDATE official_content_packs SET status='archived',updated_at=? WHERE pack_key=? AND content_type=? AND status='published'", (_now(), key, pack["content_type"]))
            db.execute("UPDATE official_content_packs SET status=?,updated_at=?,published_at=? WHERE id=?", (status, _now(), _now() if status == "published" else pack.get("published_at"), pack["id"]))
            db.commit()
        return self.get(key, version=pack["version"], content_type=pack["content_type"])

    def delete_draft(self, key: str, version: int, *, content_type: str = "world_template") -> None:
        with self.connection() as db:
            cursor = db.execute("DELETE FROM official_content_packs WHERE pack_key=? AND content_type=? AND version=? AND status='draft'", (key, content_type, version))
            db.commit()
        if not cursor.rowcount:
            raise ValueError("Seul un brouillon peut être supprimé définitivement.")

    def create_workspace(self, key: str, account_id: int, root: str | Path, *,
                         version: int | None = None,
                         content_type: str = "world_template") -> dict[str, Any]:
        """Crée un monde de travail isolé à partir d'une révision officielle."""
        from .store import ContentStore

        pack = self.get(key, version=version, content_type=content_type)
        token = secrets.token_urlsafe(18).replace("-", "_")
        workspace_root = Path(root) / "official-workspaces"
        workspace_root.mkdir(parents=True, exist_ok=True)
        path = workspace_root / f"{token}.db"
        world = ContentStore(path)
        world.initialize()
        world.seed(pack["entities"])
        now = _now()
        with self.connection() as db:
            db.execute(
                "INSERT INTO official_edit_workspaces(workspace_token,pack_id,account_id,database_path,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                (token, pack["id"], int(account_id), str(path), now, now),
            )
            db.commit()
        return {"workspace_token": token, "server_slug": f"official--{token}",
                "database_path": str(path), "template": pack}

    def workspace(self, token: str, account_id: int) -> dict[str, Any]:
        with self.connection() as db:
            row = db.execute(
                "SELECT w.*,p.pack_key,p.content_type,p.version,p.name,p.description,p.category,p.emoji,p.illustration_path,p.tags_json,p.author,p.origin "
                "FROM official_edit_workspaces w JOIN official_content_packs p ON p.id=w.pack_id "
                "WHERE w.workspace_token=? AND w.account_id=?",
                (token, int(account_id)),
            ).fetchone()
        if not row:
            raise LookupError("Atelier officiel introuvable ou expiré.")
        result = dict(row)
        result["tags"] = json.loads(result.pop("tags_json") or "[]")
        return result

    def save_workspace(self, token: str, account_id: int) -> dict[str, Any]:
        """Capture tout le Studio comme nouvelle révision officielle."""
        from .store import ContentStore

        workspace = self.workspace(token, account_id)
        world = ContentStore(workspace["database_path"])
        world.initialize()
        entities = [
            {"type": row["entity_type"], "key": row["entity_key"], "payload": row["payload"]}
            for row in world.list()
        ]
        result = self.save({
            "key": workspace["pack_key"],
            "content_type": workspace["content_type"],
            "name": workspace["name"],
            "description": workspace["description"],
            "category": workspace["category"],
            "emoji": workspace["emoji"],
            "illustration_path": workspace["illustration_path"],
            "tags": workspace["tags"],
            "author": workspace["author"],
            "origin": f"workspace:{token}",
            "entities": entities,
        }, key=workspace["pack_key"])
        with self.connection() as db:
            db.execute("UPDATE official_edit_workspaces SET pack_id=?,updated_at=? WHERE workspace_token=?", (result["id"], _now(), token))
            db.commit()
        return result

    @staticmethod
    def _replace_entities(db: sqlite3.Connection, pack_id: int, entities: list[dict[str, Any]]) -> None:
        db.execute("DELETE FROM official_content_entities WHERE pack_id=?", (pack_id,))
        for index, entity in enumerate(entities):
            entity_type = str(entity.get("type", "")).strip()
            entity_key = validate_key(str(entity.get("key", "")))
            payload = validate_entity(entity_type, deepcopy(entity.get("payload") or {}))
            db.execute(
                "INSERT INTO official_content_entities(pack_id,entity_type,entity_key,payload_json,sort_order,source_entity_key,source_version) VALUES(?,?,?,?,?,?,?)",
                (pack_id, entity_type, entity_key, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), index,
                 str(entity.get("source_entity_key", "")), entity.get("source_version")),
            )

    @staticmethod
    def _pack(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        result["key"] = result.pop("pack_key")
        result["tags"] = json.loads(result.pop("tags_json") or "[]")
        return result


def validate_official_pack(pack: dict[str, Any]) -> dict[str, Any]:
    entities = list(pack.get("entities") or [])
    errors: list[str] = []
    warnings: list[str] = []
    keys: dict[str, set[str]] = {}
    seen: set[tuple[str, str]] = set()
    for entity in entities:
        pair = (str(entity.get("type", "")), str(entity.get("key", "")))
        if pair in seen:
            errors.append(f"Entité dupliquée : {pair[0]}/{pair[1]}")
        seen.add(pair); keys.setdefault(pair[0], set()).add(pair[1])
        try:
            validate_key(pair[1]); validate_entity(pair[0], entity.get("payload") or {})
        except (ValidationError, KeyError, TypeError) as exc:
            errors.append(f"{pair[0]}/{pair[1]} : {exc}")
    for entity in entities:
        kind, payload, key = entity.get("type"), entity.get("payload") or {}, entity.get("key")
        if kind == "building":
            location = payload.get("location_key")
            if location and location not in keys.get("location", set()): errors.append(f"{key} référence le lieu absent {location}.")
            profession = payload.get("relations", {}).get("primary_profession_key")
            if profession and profession not in keys.get("profession", set()): errors.append(f"{key} référence le métier absent {profession}.")
        if kind == "location" and payload.get("parent_key") and payload["parent_key"] not in keys.get("location", set()):
            errors.append(f"{key} référence le lieu parent absent {payload['parent_key']}.")
    content_type = str(pack.get("content_type", "world_template"))
    if content_type in {"world_template", "building_preset"} and not keys.get("building"):
        errors.append("Ce modèle doit contenir au moins un bâtiment.")
    if content_type == "world_template" and not keys.get("server_settings"):
        errors.append("Les paramètres généraux du monde sont absents.")
    represented = _feature_coverage(entities)
    return {"valid": not errors, "errors": errors, "warnings": warnings,
            "coverage": {"represented": represented, "supported": list(FEATURES),
                         "count": len(represented), "total": len(FEATURES)}}


def _feature_coverage(entities: list[dict[str, Any]]) -> list[str]:
    types = {entity.get("type") for entity in entities}
    found: set[str] = set()
    mapping = {"location":"locations", "building":"buildings", "profession":"professions", "item":"items", "npc":"npcs", "event":"events", "audio":"audio", "audio_group":"audio", "voice_presence":"voice", "environment":"weather"}
    found.update(value for key, value in mapping.items() if key in types)
    for entity in entities:
        payload = entity.get("payload") or {}
        if entity.get("type") == "location" and payload.get("connections"): found.add("routes")
        if entity.get("type") == "environment" and payload.get("calendar"): found.add("calendar")
        if entity.get("type") == "building":
            if payload.get("actions"): found.add("actions")
            if payload.get("interface"): found.add("interfaces")
            modules = payload.get("modules", {})
            for key, feature in (("activities","activities"),("products","commerce"),("recipes","recipes"),("deliveries","deliveries")):
                if modules.get(key): found.add(feature)
    return [feature for feature in FEATURES if feature in found]
