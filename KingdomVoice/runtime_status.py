"""État runtime non sensible partagé entre KingdomVoice et KingdomWeb."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from KingdomData.paths import persistent_data_root


STATUS_MAX_AGE_SECONDS = 20


def status_path() -> Path:
    return persistent_data_root() / "runtime" / "voice-status.json"


def write_voice_status(snapshot: dict[str, Any]) -> None:
    """Publie atomiquement un instantané dépourvu de token ou de secret."""
    target = status_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **snapshot,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    temporary = target.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(target)


def read_voice_status() -> dict[str, Any]:
    """Ignore un instantané ancien afin de ne pas afficher un worker fantôme."""
    target = status_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        updated_at = datetime.fromisoformat(str(payload["updated_at"]))
        age = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if age > STATUS_MAX_AGE_SECONDS:
            return {"active": 0, "workers": [], "stale": True}
        return payload
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return {"active": 0, "workers": [], "stale": True}
