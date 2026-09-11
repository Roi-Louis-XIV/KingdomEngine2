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

DEFAULT_PLATFORM_WORKER_COUNT = 10


def migrate_bot_catalog(store) -> list[str]:
    """Retire les doublons historiques devenus inutiles.

    Les suppressions passent par le versioning KingdomData : aucune ligne
    d'historique n'est effacée physiquement et la migration reste idempotente.
    """
    removed: list[str] = []
    bots = {entity["entity_key"]: entity for entity in store.list("bot")}
    legacy_owner = {token: key for _number, key, token, _app in LEGACY_WORKERS}
    legacy_owner.update({app: key for _number, key, _token, app in LEGACY_WORKERS})
    for key, entity in list(bots.items()):
        payload = entity["payload"]
        if (
            key == "realm_steward"
            or (
                payload.get("bot_type", "text") == "text"
                and payload.get("name") == "Intendant du Royaume"
                and payload.get("token_env") == "KINGDOM_CORE_TOKEN"
            )
        ):
            store.delete("bot", key, "migration-system-bot-cleanup")
            removed.append(key)
            continue
        if payload.get("bot_type") != "voice" or payload.get("worker_kind") == "platform":
            continue
        references = {
            str(payload.get(field, ""))
            for field in (
                "token_env", "legacy_token_env",
                "application_id_env", "legacy_application_id_env",
            )
            if payload.get(field)
        }
        canonical = next(
            (legacy_owner[reference] for reference in references if reference in legacy_owner),
            "",
        )
        if canonical and canonical in bots and key != canonical:
            store.delete("bot", key, "migration-duplicate-voice-worker")
            removed.append(key)
    return removed


def discover_platform_workers(
    environment: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Détecte les workers réellement configurés sans retourner leurs secrets."""
    env = os.environ if environment is None else environment
    # Cinq emplacements sont fournis par défaut par KingdomEngine. Ils restent
    # visibles même avant la saisie des tokens afin que l'installation soit
    # compréhensible et reproductible sur un nouveau serveur.
    numbers = set(range(1, DEFAULT_PLATFORM_WORKER_COUNT + 1))
    numbers.update({
        int(match.group(1))
        for name, value in env.items()
        if value and (match := re.fullmatch(r"VOICE_WORKER_(\d+)_TOKEN", name))
    })
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
