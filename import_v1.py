"""Import idempotent des catalogues et profils vocaux de KingdomEngine V1."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from KingdomData import ContentStore


def definitions_from_v1(v1_root: str | Path | None = None) -> list[dict[str, Any]]:
    root = Path(v1_root) if v1_root else Path(__file__).resolve().parent.parent / "KingdomEngine"
    definitions: list[dict[str, Any]] = []
    items_root = root / "KingdomData" / "items"
    for catalogue in sorted(items_root.glob("*.json")):
        category = catalogue.stem
        for key, payload in _read(catalogue).items():
            normalized = {
                **payload,
                "category": category,
                "stack_limit": 999 if payload.get("stackable", True) else 1,
                "source": "KingdomEngine V1",
            }
            definitions.append({"type": "item", "key": key, "payload": normalized})
    voice_root = root / "KingdomVoice" / "config"
    for config in sorted(voice_root.glob("*.json")):
        payload = _read(config)
        key = config.stem
        building = str(payload.get("building", "")).lower()
        normalized = {
            **payload,
            "name": payload.get("name", key.title()),
            "emoji": "🎙️",
            "description": f"Bot vocal historique associé à {payload.get('building', 'un bâtiment')}.",
            "bot_type": "voice",
            "enabled": False,
            "token_env": f"{key.upper()}_BOT_TOKEN",
            "application_id_env": f"{key.upper()}_APPLICATION_ID",
            "building_key": _building_key(building),
            "auto_join": True,
            "source": "KingdomEngine V1",
        }
        definitions.append({"type": "bot", "key": f"voice_{key}", "payload": normalized})
    return definitions


def import_v1(store: ContentStore, v1_root: str | Path | None = None) -> int:
    before = {(x["entity_type"], x["entity_key"]) for x in store.list()}
    definitions = definitions_from_v1(v1_root)
    store.seed(definitions)
    return sum((x["type"], x["key"]) not in before for x in definitions)


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _building_key(label: str) -> str:
    if "tavern" in label: return "tavern"
    if "mine" in label: return "mine"
    if "forge" in label: return "forge"
    if "bûcheron" in label or "foret" in label or "forêt" in label: return "forest"
    return "village_square"
