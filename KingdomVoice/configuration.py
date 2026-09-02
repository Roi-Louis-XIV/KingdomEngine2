"""Découverte non sensible des capacités vocales configurées par environnement."""

from __future__ import annotations

import os
import re
from typing import Any, Mapping


LEGACY_WORKERS = (
    (1, "voice_edgar", "EDGAR_BOT_TOKEN", "EDGAR_APPLICATION_ID"),
    (2, "voice_edouard", "EDOUARD_BOT_TOKEN", "EDOUARD_APPLICATION_ID"),
    (3, "voice_roland", "ROLAND_BOT_TOKEN", "ROLAND_APPLICATION_ID"),
    (4, "voice_sylvain", "SYLVAIN_BOT_TOKEN", "SYLVAIN_APPLICATION_ID"),
    (5, "voice_wagner", "WAGNER_BOT_TOKEN", "WAGNER_APPLICATION_ID"),
)


def discover_platform_workers(
    environment: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Détecte les workers réellement configurés sans retourner leurs secrets."""
    env = environment or os.environ
    numbers = {
        int(match.group(1))
        for name, value in env.items()
        if value and (match := re.fullmatch(r"VOICE_WORKER_(\d+)_TOKEN", name))
    }
    numbers.update(number for number, _, token, _ in LEGACY_WORKERS if env.get(token))
    legacy = {number: (key, token, app) for number, key, token, app in LEGACY_WORKERS}
    workers: list[dict[str, Any]] = []
    for number in sorted(numbers):
        key, old_token, old_app = legacy.get(
            number, (f"voice_worker_{number}", "", "")
        )
        token_env = f"VOICE_WORKER_{number}_TOKEN"
        app_env = f"VOICE_WORKER_{number}_APPLICATION_ID"
        workers.append(
            {
                "key": key,
                "name": f"Voice Worker {number}",
                "worker_number": number,
                "worker_kind": "platform",
                "enabled": True,
                "token_env": token_env if env.get(token_env) else old_token,
                "application_id_env": app_env if env.get(app_env) else old_app,
                "legacy_token_env": old_token,
                "legacy_application_id_env": old_app,
            }
        )
    return workers
