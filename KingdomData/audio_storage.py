"""Stockage sûr des médias audio administrés depuis KingdomWeb."""

from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from pathlib import Path
from typing import BinaryIO

from .schemas import ValidationError
from .paths import PACKAGE_DATA_ROOT, persistent_data_root

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"}
MAX_AUDIO_BYTES = int(os.getenv("KINGDOM_AUDIO_MAX_BYTES", str(100 * 1024 * 1024)))
DATA_ROOT = persistent_data_root()
AUDIO_ROOT = DATA_ROOT / "assets" / "audio"


def audio_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    key = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    if len(key) < 3:
        key = f"son_{key or 'audio'}"
    return key[:56]


def safe_audio_path(storage_path: str) -> Path:
    # Les imports historiques sont rangés par bâtiment sous ``assets`` alors
    # que les nouveaux téléversements vivent sous ``assets/audio``. Les deux
    # emplacements restent confinés à la banque média de KingdomData.
    writable_target: Path | None = None
    for data_root in dict.fromkeys((DATA_ROOT.resolve(), PACKAGE_DATA_ROOT.resolve())):
        root = (data_root / "assets").resolve()
        target = (data_root / storage_path).resolve()
        if root != target and root not in target.parents:
            continue
        if target.is_file():
            return target
        if data_root == DATA_ROOT.resolve():
            writable_target = target
    if writable_target is not None:
        return writable_target
    raise ValidationError("Chemin audio invalide.")


def store_audio_file(stream: BinaryIO, entity_key: str, original_name: str, namespace: str = "") -> dict[str, object]:
    extension = Path(original_name or "").suffix.lower()
    if extension not in AUDIO_EXTENSIONS:
        raise ValidationError("Format non pris en charge. Utilisez MP3, WAV, OGG, FLAC, M4A, AAC ou OPUS.")
    safe_namespace = re.sub(r"[^a-z0-9_-]+", "-", namespace.lower()).strip("-")
    directory = AUDIO_ROOT / "servers" / safe_namespace / entity_key if safe_namespace else AUDIO_ROOT / entity_key
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"source{extension}"
    temporary = directory / f"upload{extension}.tmp"
    digest = hashlib.sha256()
    size = 0
    try:
        with temporary.open("wb") as output:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise ValidationError(f"Le fichier dépasse la limite de {MAX_AUDIO_BYTES // (1024 * 1024)} Mo.")
                digest.update(chunk)
                output.write(chunk)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {
        "storage_path": target.relative_to(DATA_ROOT).as_posix(),
        "file_name": Path(original_name).name,
        "size_bytes": size,
        "checksum_sha256": digest.hexdigest(),
    }
