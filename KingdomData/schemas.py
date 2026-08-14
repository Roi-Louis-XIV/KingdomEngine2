"""Validation légère des définitions no-code, sans imposer un framework externe."""

from __future__ import annotations

import re
from typing import Any

ENTITY_TYPES = {"building", "item", "event", "bot", "audio", "npc", "recipe", "interface", "server_settings"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
ACTION_TYPES = {
    "message", "reward", "cost", "emit", "random_reward", "random_bundle", "random_result",
    "stock_cost", "stock_reward", "profession", "durability",
    "repair", "upgrade", "random_message",
    "schedule", "claim_scheduled", "state",
}


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
                _validate_effect(effect)
        _validate_building_modules(payload)
        if payload.get("interface"):
            _validate_interface(payload["interface"])
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
    if entity_type == "interface":
        _validate_interface(payload)
    if entity_type == "server_settings":
        _validate_server_settings(payload)
    return payload


def _validate_effect(effect: dict[str, Any]) -> None:
    """Valide récursivement un effet, y compris les branches aléatoires no-code."""
    if not isinstance(effect, dict) or effect.get("type") not in ACTION_TYPES:
        raise ValidationError(f"Effet inconnu : {getattr(effect, 'get', lambda _key: None)('type')}")
    if effect.get("type") not in {"random_bundle", "random_result"}:
        return
    outcomes = effect.get("outcomes", [])
    if not isinstance(outcomes, list) or not outcomes:
        raise ValidationError("Un résultat aléatoire doit proposer au moins une issue.")
    for outcome in outcomes:
        if not isinstance(outcome, dict) or float(outcome.get("weight", 0)) <= 0:
            raise ValidationError("Chaque résultat aléatoire doit avoir un poids positif.")
        if effect.get("type") == "random_result":
            nested = outcome.get("effects", [])
            if not isinstance(nested, list):
                raise ValidationError("Les effets d'un résultat aléatoire doivent former une liste.")
            for nested_effect in nested:
                _validate_effect(nested_effect)


def _validate_building_modules(payload: dict[str, Any]) -> None:
    """Valide les modules sans figer leur contenu : KingdomWeb reste la source de v\u00e9rit\u00e9."""
    modules = payload.get("modules", {})
    if not isinstance(modules, dict):
        raise ValidationError("modules doit \u00eatre un objet JSON.")
    for name in ("professions", "products", "recipes", "activities", "deliveries", "upgrades"):
        value = modules.get(name, [])
        if not isinstance(value, list):
            raise ValidationError(f"Le module {name} doit \u00eatre une liste.")
    for product in modules.get("products", []):
        if int(product.get("price", 0)) < 0 or int(product.get("initial_stock", 0)) < 0:
            raise ValidationError("Le prix et le stock d'un produit ne peuvent pas \u00eatre n\u00e9gatifs.")
    for recipe in modules.get("recipes", []):
        if int(recipe.get("duration_seconds", 0)) < 0 or int(recipe.get("energy_cost", 0)) < 0:
            raise ValidationError("La dur\u00e9e et le co\u00fbt en \u00e9nergie d'une recette doivent \u00eatre positifs.")
    for activity in modules.get("activities", []):
        if int(activity.get("duration_seconds", 0)) < 0 or int(activity.get("energy_cost", 0)) < 0:
            raise ValidationError("La dur\u00e9e et le co\u00fbt en \u00e9nergie d'une activit\u00e9 doivent \u00eatre positifs.")
        limit = activity.get("activity_limit", {})
        if limit and limit.get("scope", "action") not in {"player", "building", "action", "category"}:
            raise ValidationError("La portée de limite d'activité est invalide.")
        if limit and int(limit.get("max_active", 1)) < 1:
            raise ValidationError("La limite d'activités doit être au moins égale à 1.")
        outcomes = activity.get("outcomes", [])
        if outcomes and all("effects" in outcome for outcome in outcomes):
            _validate_effect({"type": "random_result", "outcomes": outcomes})
    for recipe in modules.get("recipes", []):
        if recipe.get("output_destination", "player") not in {"player", "building_stock"}:
            raise ValidationError("La destination de production doit être player ou building_stock.")


def _validate_interface(payload: dict[str, Any]) -> None:
    pages = payload.get("pages", [])
    if not isinstance(pages, list) or not pages:
        raise ValidationError("Une interface doit contenir au moins une page.")
    page_keys: set[str] = set()
    component_ids: set[str] = set()
    for page in pages:
        page_key = validate_key(page.get("key", ""))
        if page_key in page_keys:
            raise ValidationError(f"Page dupliquee : {page_key}")
        page_keys.add(page_key)
        if not isinstance(page.get("components", []), list):
            raise ValidationError(f"Les composants de {page_key} doivent former une liste.")
        # Compatibilité ascendante : les interfaces créées avant la grille 5x5
        # reçoivent automatiquement les premiers emplacements libres.
        reserved_slots: set[int] = set()
        reserved_rows: set[int] = set()
        for component in page.get("components", []):
            if component.get("type") not in {"button", "select"} or "slot" not in component:
                continue
            explicit_slot = int(component["slot"])
            if not 0 <= explicit_slot <= 24:
                raise ValidationError("Chaque bouton ou menu doit occuper un emplacement entre 0 et 24.")
            explicit_row = explicit_slot // 5
            if component.get("type") == "select":
                component["slot"] = explicit_row * 5
                reserved_rows.add(explicit_row)
                reserved_slots.update(range(explicit_row * 5, explicit_row * 5 + 5))
            else:
                reserved_slots.add(explicit_slot)
        for component in page.get("components", []):
            if component.get("type") not in {"button", "select"} or "slot" in component:
                continue
            if component.get("type") == "select":
                available_row = next((row for row in range(5) if row not in reserved_rows and not any(slot // 5 == row for slot in reserved_slots)), None)
                if available_row is None:
                    raise ValidationError("Aucune ligne n'est libre pour ce menu déroulant.")
                component["slot"] = available_row * 5
                reserved_rows.add(available_row)
                reserved_slots.update(range(available_row * 5, available_row * 5 + 5))
            else:
                available_slot = next((slot for slot in range(25) if slot not in reserved_slots and slot // 5 not in reserved_rows), None)
                if available_slot is None:
                    raise ValidationError("La page dépasse les 25 emplacements Discord.")
                component["slot"] = available_slot
                reserved_slots.add(available_slot)
        occupied_slots: set[int] = set()
        occupied_rows: set[int] = set()
        for component in page.get("components", []):
            component_id = validate_key(component.get("id", ""))
            if component_id in component_ids:
                raise ValidationError(f"Composant duplique : {component_id}")
            component_ids.add(component_id)
            if component.get("type") not in {"hero", "text", "card", "stat", "divider", "image", "player_inventory", "button", "select"}:
                raise ValidationError(f"Composant inconnu : {component.get('type')}")
            if component.get("type") in {"button", "select"}:
                slot = int(component.get("slot", -1))
                if not 0 <= slot <= 24:
                    raise ValidationError("Chaque bouton ou menu doit occuper un emplacement entre 0 et 24.")
                row = slot // 5
                if component.get("type") == "select":
                    if row in occupied_rows or any(candidate // 5 == row for candidate in occupied_slots):
                        raise ValidationError(f"Le menu de la ligne {row + 1} entre en conflit avec un autre composant.")
                    options = component.get("options", [])
                    if not isinstance(options, list) or not 1 <= len(options) <= 25:
                        raise ValidationError("Un menu déroulant doit proposer entre 1 et 25 options.")
                    occupied_rows.add(row)
                    occupied_slots.update(range(row * 5, row * 5 + 5))
                    for option in options:
                        _validate_interaction(option.get("interaction"))
                else:
                    if row in occupied_rows or slot in occupied_slots:
                        raise ValidationError(f"L'emplacement {slot + 1} est déjà utilisé.")
                    occupied_slots.add(slot)
            interaction = component.get("interaction")
            _validate_interaction(interaction)
    if payload.get("start_page") not in page_keys:
        raise ValidationError("La page de depart doit exister.")
    for page in pages:
        for component in page.get("components", []):
            interaction = component.get("interaction", {})
            if interaction.get("type") == "navigate" and interaction.get("page") not in page_keys:
                raise ValidationError(f"Page cible inconnue : {interaction.get('page')}")
            for option in component.get("options", []):
                option_interaction = option.get("interaction", {})
                if option_interaction.get("type") == "navigate" and option_interaction.get("page") not in page_keys:
                    raise ValidationError(f"Page cible inconnue : {option_interaction.get('page')}")


def _validate_interaction(interaction: dict[str, Any] | None) -> None:
    if not interaction:
        return
    if interaction.get("type") not in {"navigate", "action"}:
        raise ValidationError("Une interaction doit être de type navigate ou action.")
    if interaction.get("type") == "action" and not (interaction.get("building") and interaction.get("action")):
        raise ValidationError("Une action doit cibler un bâtiment et une action publiée.")


def _validate_server_settings(payload: dict[str, Any]) -> None:
    for section in ("onboarding", "roles", "discord", "theme"):
        if not isinstance(payload.get(section), dict):
            raise ValidationError(f"La section {section} doit être un objet.")
    if not str(payload["roles"].get("player", "")).strip():
        raise ValidationError("Le rôle accordé après le serment est obligatoire.")
    if "{name}" not in str(payload["discord"].get("building_category_template", "")):
        raise ValidationError("Le modèle de catégorie doit contenir {name}.")
    allowed_variables = {"name", "key", "emoji"}
    for field in ("building_category_template", "building_text_channel", "building_voice_channel_template"):
        variables = set(re.findall(r"\{([^{}]+)\}", str(payload["discord"].get(field, ""))))
        if not variables.issubset(allowed_variables):
            raise ValidationError(f"Le champ {field} contient une variable inconnue.")
    entry_variables = set(re.findall(r"\{([^{}]+)\}", str(payload["discord"].get("entry_message", ""))))
    if not entry_variables.issubset({"player", "building", "key"}):
        raise ValidationError("Le message d'entrée contient une variable inconnue.")
    for field in ("primary_color", "accent_color"):
        if not re.fullmatch(r"#?[0-9a-fA-F]{6}", str(payload["theme"].get(field, ""))):
            raise ValidationError(f"La couleur {field} doit contenir 6 caractères hexadécimaux.")
