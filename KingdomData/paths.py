"""Chemins persistants configurables, indépendants de l'emplacement du code."""

from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DATA_ROOT = Path(__file__).resolve().parent


def persistent_data_root() -> Path:
    """Racine des données volumineuses, ou emplacement historique par défaut."""
    configured = os.getenv("KINGDOM_DATA_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else PACKAGE_DATA_ROOT


def database_path() -> Path:
    """Base principale : surcharge explicite, puis HDD configuré, puis ancien chemin."""
    configured_database = os.getenv("KINGDOM_DATABASE", "").strip()
    configured_root = os.getenv("KINGDOM_DATA_DIR", "").strip()
    if configured_database and (not configured_root or configured_database not in {"var/kingdom.db", "var\\kingdom.db"}):
        return Path(configured_database).expanduser()
    if configured_root:
        return Path(configured_root).expanduser().resolve() / "kingdom.db"
    return Path(configured_database or "var/kingdom.db")


def assets_root() -> Path:
    return persistent_data_root() / "assets"
