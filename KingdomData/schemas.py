"""Validation légère des définitions no-code, sans imposer un framework externe."""

from __future__ import annotations

import re
from typing import Any

ENTITY_TYPES = {"building", "item", "event", "bot", "audio", "audio_group", "audio_story", "npc", "recipe", "interface", "server_settings", "profession", "environment", "location"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
ACTION_TYPES = {
    "message", "reward", "cost", "emit", "random_reward", "random_bundle", "random_result",
    "stock_cost", "stock_reward", "profession", "durability",
    "repair", "upgrade", "random_message", "deliver_inventory",
    "schedule", "claim_scheduled", "state", "production",
    "profession_join", "profession_leave", "profession_experience",
    "tool_grant", "tool_modify", "contribution", "player_stat",
    "play_audio", "set_audio_group",
}
CONDITION_TYPES = {
    "resource", "item_present", "item_absent", "profession_active", "no_active_profession",
    "profession_level", "tool_present", "tool_level", "tool_durability", "voice_presence",
    "discord_role", "no_pending_activity", "activity_limit_available", "cooldown_available",
    "building_stock", "state", "player_stat",
}
CONDITION_OPERATORS = {"=", "!=", ">", ">=", "<", "<="}
ACTIVITY_SCOPES = {"player", "player_building", "player_action", "category", "building", "action"}
PRODUCTION_DESTINATIONS = {"player_inventory", "building_stock", "player"}


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
        relations = payload.get("building_relations", [])
        if not isinstance(relations, list):
            raise ValidationError("building_relations doit être une liste.")
        for relation in relations:
            validate_key(str(relation.get("building_key", "")))
            if relation.get("relation", "related") not in {"produced_by", "used_by", "sold_by", "accepted_by", "related"}:
                raise ValidationError("Relation objet-bâtiment inconnue.")
        consumption = payload.get("consumption", {})
        if consumption and not isinstance(consumption.get("effects", []), list):
            raise ValidationError("Les effets de consommation doivent former une liste.")
        for effect in consumption.get("effects", []): _validate_effect(effect)
    if entity_type == "building":
        if payload.get("location_key"):
            validate_key(str(payload["location_key"]))
        relations = payload.get("relations", {})
        if not isinstance(relations, dict):
            raise ValidationError("Les relations du bâtiment doivent former un objet.")
        for field in ("primary_profession_key", "ambience_audio_key"):
            if relations.get(field):
                validate_key(str(relations[field]))
        actions = payload.get("actions", [])
        if not isinstance(actions, list):
            raise ValidationError("actions doit être une liste.")
        seen: set[str] = set()
        for action in actions:
            key = validate_key(action.get("key", ""))
            if key in seen:
                raise ValidationError(f"Action dupliquée : {key}")
            seen.add(key)
            if "conditions" in action:
                _validate_condition(action["conditions"])
            _validate_hooks(action.get("hooks", {}))
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
        if payload.get("bot_type") == "voice" and not (payload.get("building_key") or payload.get("voice_channel_id") or payload.get("voice_channel_env")):
            raise ValidationError("Un bot vocal doit être associé à un bâtiment ou cibler un salon vocal.")
        for volume in payload.get("volume", {}).values():
            if not 0 <= float(volume) <= 1:
                raise ValidationError("Les volumes doivent être compris entre 0 et 1.")
    if entity_type == "event":
        if payload.get("trigger", {}).get("type", "manual") not in {"manual", "scheduled", "recurring", "action", "players"}:
            raise ValidationError("Déclencheur d’événement invalide.")
        for modifier in payload.get("modifiers", []):
            if modifier.get("operator", "multiply") not in {"set", "add", "multiply", "min", "max"}:
                raise ValidationError("Opérateur de modificateur invalide.")
            if not str(modifier.get("property", "")).strip():
                raise ValidationError("La propriété du modificateur est obligatoire.")
        for layer in payload.get("audio_layers", []):
            validate_key(str(layer.get("group_key", "")))
            if layer.get("building_keys") is not None and not isinstance(layer.get("building_keys"), list):
                raise ValidationError("Les bâtiments d’une ambiance Event doivent former une liste.")
    if entity_type == "profession":
        if payload.get("required_item"): validate_key(str(payload["required_item"]))
    if entity_type == "environment":
        if payload.get("mode", "manual") not in {"manual", "weighted", "automatic", "scheduled"}:
            raise ValidationError("Mode environnemental invalide.")
        if not 0 <= int(payload.get("hour", 12)) <= 23:
            raise ValidationError("L’heure doit être comprise entre 0 et 23.")
        if not 0 <= int(payload.get("minute", 0)) <= 59:
            raise ValidationError("Les minutes doivent être comprises entre 0 et 59.")
        calendar=payload.get("calendar", {})
        if calendar:
            months=calendar.get("months", []); weekdays=calendar.get("weekdays", [])
            if not months or not weekdays: raise ValidationError("Le calendrier doit contenir des mois et des jours de semaine.")
            if any(int(month.get("days",0))<1 for month in months): raise ValidationError("Chaque mois doit contenir au moins un jour.")
            month_keys=[validate_key(str(month.get("key",""))) for month in months]
            if len(month_keys)!=len(set(month_keys)): raise ValidationError("Les identifiants de mois doivent être uniques.")
            for season in calendar.get("seasons",[]):
                validate_key(str(season.get("key","")))
                if season.get("start_month_key") not in month_keys: raise ValidationError("Le mois de début d’une saison est introuvable.")
    if entity_type == "npc":
        if payload.get("location_key"): validate_key(str(payload["location_key"]))
        if payload.get("building_key"): validate_key(str(payload["building_key"]))
        for reaction in payload.get("reactions",[]):
            if not reaction.get("variants"): raise ValidationError("Une réaction PNJ doit contenir au moins une variante.")
            for variant in reaction["variants"]:
                if not str(variant.get("text","")).strip(): raise ValidationError("Chaque variante PNJ doit contenir un texte Discord.")
    if entity_type == "location":
        if payload.get("location_type", "place") not in {"kingdom", "region", "city", "village", "forest", "mountain", "wilderness", "road", "place", "gate", "river", "crossroads", "building", "secret", "special"}:
            raise ValidationError("Type de lieu invalide.")
        if payload.get("parent_key"): validate_key(str(payload["parent_key"]))
        for connection in payload.get("connections", []):
            validate_key(str(connection.get("target", "")))
            if connection.get("direction", "one_way") not in {"one_way", "bidirectional"}: raise ValidationError("Direction de connexion invalide.")
            if connection.get("visibility", "visible") not in {"visible", "discovered", "secret"}: raise ValidationError("Visibilité de connexion invalide.")
            if int(connection.get("duration_seconds", 0)) < 0: raise ValidationError("La durée d’une connexion ne peut pas être négative.")
    if entity_type == "audio":
        if payload.get("audio_type", payload.get("channel", "sfx")) not in {"voice", "music", "ambience", "sfx"}:
            raise ValidationError("Le type audio doit être voice, music, ambience ou sfx.")
        if not str(payload.get("storage_path", payload.get("source", ""))).strip():
            raise ValidationError("Le fichier audio est obligatoire.")
        if not 0 <= float(payload.get("volume", 0.5)) <= 1:
            raise ValidationError("Le volume doit être compris entre 0 et 1.")
    if entity_type == "audio_group":
        layers = payload.get("layers", [])
        if not isinstance(layers, list) or not layers:
            raise ValidationError("Un groupe d’ambiance doit contenir au moins une couche audio.")
        for layer in layers:
            validate_key(str(layer.get("audio_key", "")))
            if layer.get("role", "ambience") not in {"ambience", "music", "sfx", "voice"}:
                raise ValidationError("Rôle de couche audio invalide.")
            if not 0 <= float(layer.get("volume", 1)) <= 1:
                raise ValidationError("Le volume d’une couche doit être compris entre 0 et 1.")
        transitions = payload.get("transitions", {})
        if any(float(transitions.get(field, 0)) < 0 for field in ("fade_in_seconds", "fade_out_seconds", "crossfade_seconds")):
            raise ValidationError("Les transitions audio ne peuvent pas être négatives.")
    if entity_type == "audio_story":
        steps = payload.get("steps", [])
        if not isinstance(steps, list) or not steps:
            raise ValidationError("Une histoire auditive doit contenir au moins une étape.")
        for step in steps:
            if not str(step.get("name", "")).strip():
                raise ValidationError("Chaque étape d’une histoire doit avoir un nom.")
            if step.get("audio_key"):
                validate_key(str(step["audio_key"]))
            if float(step.get("delay_seconds", 0)) < 0:
                raise ValidationError("Le délai d’une étape ne peut pas être négatif.")
    if entity_type == "interface":
        _validate_interface(payload)
    if entity_type == "server_settings":
        _validate_server_settings(payload)
    return payload


def _validate_effect(effect: dict[str, Any]) -> None:
    """Valide récursivement un effet, y compris les branches aléatoires no-code."""
    if not isinstance(effect, dict) or effect.get("type") not in ACTION_TYPES:
        raise ValidationError(f"Effet inconnu : {getattr(effect, 'get', lambda _key: None)('type')}")
    kind = effect.get("type")
    if kind == "play_audio" and not str(effect.get("audio_key", "")).strip():
        raise ValidationError("L’effet audio doit référencer un son.")
    if kind == "set_audio_group" and not str(effect.get("group_key", "")).strip():
        raise ValidationError("Le changement d’ambiance doit référencer un groupe sonore.")
    if kind == "production":
        if effect.get("destination", "player_inventory") not in PRODUCTION_DESTINATIONS:
            raise ValidationError("Destination de production invalide.")
        if not str(effect.get("resource", effect.get("item", ""))).strip():
            raise ValidationError("Une production doit référencer une ressource.")
    if kind in {"profession_join", "profession_leave", "profession_experience"} and not str(effect.get("profession", "")).strip():
        raise ValidationError("Un effet de métier doit référencer un métier.")
    if kind in {"tool_grant", "tool_modify"} and not str(effect.get("tool", "")).strip():
        raise ValidationError("Un effet d'outil doit référencer un outil.")
    if kind == "tool_modify" and effect.get("operation", "consume_durability") not in {"consume_durability", "restore_durability", "set_level", "increment_level", "set_max_durability", "set_bonus"}:
        raise ValidationError("Opération d'outil invalide.")
    if kind == "contribution" and not str(effect.get("objective", "")).strip():
        raise ValidationError("Une contribution doit référencer un objectif collectif.")
    if kind == "player_stat" and not str(effect.get("stat", "")).strip():
        raise ValidationError("Un effet de statistique doit référencer une statistique.")
    if kind == "schedule":
        scope = effect.get("limit_scope", "player_action")
        if scope not in ACTIVITY_SCOPES:
            raise ValidationError("Portée de limite d'activité invalide.")
        if int(effect.get("max_active", 1)) < 1 or int(effect.get("duration_seconds", 0)) < 0:
            raise ValidationError("La durée et la limite d'activité doivent être positives.")
        for nested_effect in effect.get("effects", []):
            _validate_effect(nested_effect)
        _validate_hooks(effect.get("hooks", {}))
    if kind not in {"random_bundle", "random_result"}:
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


def _validate_condition(condition: Any) -> None:
    if not isinstance(condition, dict):
        raise ValidationError("Une condition doit être un objet.")
    groups = [key for key in ("all", "any", "not") if key in condition]
    if groups:
        if len(groups) != 1:
            raise ValidationError("Un groupe de conditions utilise un seul opérateur logique.")
        key = groups[0]
        children = condition[key] if key != "not" else [condition[key]]
        if not isinstance(children, list) or not children:
            raise ValidationError(f"Le groupe {key} doit contenir des conditions.")
        for child in children:
            _validate_condition(child)
        return
    kind = condition.get("type")
    if kind not in CONDITION_TYPES:
        raise ValidationError(f"Type de condition inconnu : {kind}")
    if condition.get("operator", ">=") not in CONDITION_OPERATORS:
        raise ValidationError("Opérateur de condition invalide.")
    required = {
        "resource": "resource", "item_present": "item", "item_absent": "item",
        "profession_active": "profession", "profession_level": "profession",
        "tool_present": "tool", "tool_level": "tool", "tool_durability": "tool",
        "discord_role": "role", "building_stock": "item", "state": "key",
    }.get(kind)
    if required and not str(condition.get(required, "")).strip():
        raise ValidationError(f"La condition {kind} exige le champ {required}.")
    if kind == "activity_limit_available" and condition.get("scope", "player_action") not in ACTIVITY_SCOPES:
        raise ValidationError("Portée de condition d'activité invalide.")


def _validate_hooks(hooks: Any) -> None:
    if not hooks:
        return
    if not isinstance(hooks, dict) or not set(hooks).issubset({"on_start", "on_success", "on_failure", "on_claim"}):
        raise ValidationError("Hooks d'événements invalides.")
    for hook, entries in hooks.items():
        entries = entries if isinstance(entries, list) else [entries]
        for entry in entries:
            if not isinstance(entry, dict) or not str(entry.get("event", "")).strip():
                raise ValidationError(f"Le hook {hook} doit référencer un événement.")
            if "payload" in entry and not isinstance(entry["payload"], dict):
                raise ValidationError("Le payload d'un hook doit être un objet.")


def _validate_building_modules(payload: dict[str, Any]) -> None:
    """Valide les modules sans figer leur contenu : KingdomWeb reste la source de v\u00e9rit\u00e9."""
    modules = payload.get("modules", {})
    if not isinstance(modules, dict):
        raise ValidationError("modules doit \u00eatre un objet JSON.")
    for name in ("professions", "products", "recipes", "activities", "deliveries", "upgrades"):
        value = modules.get(name, [])
        if not isinstance(value, list):
            raise ValidationError(f"Le module {name} doit \u00eatre une liste.")
    if not isinstance(modules.get("games", {}), (dict, list)):
        raise ValidationError("Le module games doit être un objet ou une liste.")
    sound = modules.get("audio", {})
    if not isinstance(sound, dict):
        raise ValidationError("Le module audio doit être un objet.")
    groups = sound.get("groups", [])
    if not isinstance(groups, list):
        raise ValidationError("Les groupes sonores doivent former une liste.")
    group_keys: set[str] = set()
    for group in groups:
        group_key = validate_key(group.get("key", ""))
        if group_key in group_keys:
            raise ValidationError(f"Groupe sonore dupliqué : {group_key}")
        group_keys.add(group_key)
        tracks = group.get("tracks", {})
        if not isinstance(tracks, dict) or any(not isinstance(tracks.get(channel, []), list) for channel in ("music", "ambience", "sfx", "voice")):
            raise ValidationError("Les pistes d’un groupe sonore doivent être classées par type.")
    default_group = str(sound.get("default_group_key", ""))
    if default_group and default_group not in group_keys:
        raise ValidationError("Le groupe sonore général n’existe pas.")
    profession_keys = {validate_key(item.get("key", "")) for item in modules.get("professions", [])}
    if len(profession_keys) != len(modules.get("professions", [])):
        raise ValidationError("Les identifiants de métiers doivent être uniques.")
    activity_keys = {validate_key(item.get("key", "")) for item in modules.get("activities", [])}
    if len(activity_keys) != len(modules.get("activities", [])):
        raise ValidationError("Les identifiants d'activités doivent être uniques.")
    for product in modules.get("products", []):
        if int(product.get("price", 0)) < 0 or int(product.get("initial_stock", 0)) < 0:
            raise ValidationError("Le prix et le stock d'un produit ne peuvent pas \u00eatre n\u00e9gatifs.")
    for recipe in modules.get("recipes", []):
        if int(recipe.get("duration_seconds", 0)) < 0 or int(recipe.get("energy_cost", 0)) < 0:
            raise ValidationError("La dur\u00e9e et le co\u00fbt en \u00e9nergie d'une recette doivent \u00eatre positifs.")
    for activity in modules.get("activities", []):
        if activity.get("profession") and activity["profession"] not in profession_keys:
            raise ValidationError(f"Métier inexistant pour l'activité {activity.get('key')} : {activity['profession']}")
        if int(activity.get("duration_seconds", 0)) < 0 or int(activity.get("energy_cost", 0)) < 0:
            raise ValidationError("La dur\u00e9e et le co\u00fbt en \u00e9nergie d'une activit\u00e9 doivent \u00eatre positifs.")
        limit = activity.get("activity_limit", {})
        if limit and limit.get("scope", "action") not in ACTIVITY_SCOPES:
            raise ValidationError("La portée de limite d'activité est invalide.")
        if limit and int(limit.get("max_active", 1)) < 1:
            raise ValidationError("La limite d'activités doit être au moins égale à 1.")
        if int(activity.get("minimum_durability", 0)) < 0:
            raise ValidationError("La durabilité minimale ne peut pas être négative.")
        _validate_hooks(activity.get("hooks", {}))
        outcomes = activity.get("outcomes", [])
        if outcomes and all("effects" in outcome for outcome in outcomes):
            _validate_effect({"type": "random_result", "outcomes": outcomes})
    for recipe in modules.get("recipes", []):
        if recipe.get("output_destination", "player") not in {"player", "player_inventory", "building_stock"}:
            raise ValidationError("La destination de production doit être player ou building_stock.")
    for delivery in modules.get("deliveries", []):
        if not str(delivery.get("item_key", delivery.get("resource", ""))).strip():
            raise ValidationError("Une livraison doit référencer une ressource.")
        if delivery.get("source", "player_inventory") != "player_inventory":
            raise ValidationError("La source de livraison doit être player_inventory.")
        if delivery.get("destination", "building_stock") not in {"building_stock", "player_inventory"}:
            raise ValidationError("Destination de livraison invalide.")
        if int(delivery.get("minimum_quantity", 1)) < 1 or (delivery.get("maximum_quantity") is not None and int(delivery["maximum_quantity"]) < int(delivery.get("minimum_quantity", 1))):
            raise ValidationError("Les limites de quantité d'une livraison sont invalides.")
        if int(delivery.get("unit_price", 0)) < 0:
            raise ValidationError("Le prix unitaire d'une livraison ne peut pas être négatif.")
        if delivery.get("conditions"):
            _validate_condition(delivery["conditions"])
        for event_rule in delivery.get("events", {}).values():
            if event_rule and not str(event_rule.get("event", "")).strip():
                raise ValidationError("Un événement de livraison doit posséder un identifiant.")


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
            if component.get("type") not in {"hero", "text", "sequence", "card", "stat", "divider", "image", "player_inventory", "building_inventory", "button", "select", "dynamic_inventory_selector", "dynamic_product_selector", "dynamic_consumable_selector", "dynamic_game_selector"}:
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
    if interaction.get("type") not in {"navigate", "action", "purchase", "refresh", "close", "deliver_all"}:
        raise ValidationError("Type d'interaction inconnu.")
    if interaction.get("type") == "action" and not (interaction.get("building") and interaction.get("action")):
        raise ValidationError("Une action doit cibler un bâtiment et une action publiée.")
    if interaction.get("type") == "purchase" and not str(interaction.get("item_key", "")).strip():
        raise ValidationError("Une option d’achat doit référencer un objet.")


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
    world_map = payload.get("world_map", {})
    if not isinstance(world_map, dict):
        raise ValidationError("La configuration de la carte doit être un objet.")
    if not 800 <= int(world_map.get("width", 1600)) <= 4000:
        raise ValidationError("La largeur de la carte doit être comprise entre 800 et 4000 pixels.")
    if not 500 <= int(world_map.get("height", 900)) <= 2500:
        raise ValidationError("La hauteur de la carte doit être comprise entre 500 et 2500 pixels.")
