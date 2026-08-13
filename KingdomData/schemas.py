"""Validation légère des définitions no-code, sans imposer un framework externe."""

from __future__ import annotations

import re
from typing import Any

ENTITY_TYPES = {"building", "item", "event", "bot", "audio", "npc", "recipe"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
ACTION_TYPES = {"message", "reward", "cost", "emit", "random_reward"}


class ValidationError(ValueError):
    pass


def validate_key(value: str) -> str:
    key = str(value).strip().lower()
    if not KEY_RE.fullmatch(key):
        raise ValidationError("L’identifiant doit utiliser 3 à 64 lettres minuscules, chiffres ou underscores.")
    return key


def validate_entity(entity_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    if entity_type not in ENTITY_TYPES:
        raise ValidationError(f"Type inconnu : {entity_type}")
    if not isinstance(payload, dict):
        raise ValidationError("La définition doit être un objet JSON.")
    if not str(payload.get("name", "")).strip():
        raise ValidationError("Le champ name est obligatoire.")
    if entity_type == "item":
        if int(payload.get("stack_limit", 999)) < 1:
            raise ValidationError("stack_limit doit être positif.")
        if int(payload.get("price", 0)) < 0:
            raise ValidationError("Le prix ne peut pas être négatif.")
    if entity_type == "building":
        actions = payload.get("actions", [])
        if not isinstance(actions, list):
            raise ValidationError("actions doit être une liste.")
        seen: set[str] = set()
        for action in actions:
            key = validate_key(action.get("key", ""))
            if key in seen:
                raise ValidationError(f"Action dupliquée : {key}")
            seen.add(key)
            for effect in action.get("effects", []):
                if effect.get("type") not in ACTION_TYPES:
                    raise ValidationError(f"Effet inconnu : {effect.get('type')}")
    if entity_type == "bot":
        if payload.get("bot_type", "text") not in {"text", "voice"}:
            raise ValidationError("Le type de bot doit être text ou voice.")
        if not str(payload.get("token_env", "")).strip():
            raise ValidationError("La variable d’environnement du token est obligatoire.")
        if payload.get("bot_type") == "voice" and not (payload.get("voice_channel_id") or payload.get("voice_channel_env")):
            raise ValidationError("Un bot vocal doit cibler un salon vocal ou une variable de salon.")
        for volume in payload.get("volume", {}).values():
            if not 0 <= float(volume) <= 1:
                raise ValidationError("Les volumes doivent être compris entre 0 et 1.")
    if entity_type == "event":
        if payload.get("trigger", {}).get("type", "manual") not in {"manual", "scheduled", "recurring", "action", "players"}:
            raise ValidationError("Déclencheur d’événement invalide.")
    return payload
