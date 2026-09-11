"""Paramètres serveur partagés par KingdomWeb, KingdomCore et le provisionneur.

Les valeurs ci-dessous ne sont que le document initial. Dès qu'une version est
publiée dans KingdomData, elle devient la seule source de vérité du moteur.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


SERVER_SETTINGS_KEY = "kingdom_server"

DEFAULT_SERVER_SETTINGS: dict[str, Any] = {
    "name": "Paramètres du monde",
    "emoji": "⚙️",
    "description": "Accueil, rôles, catégories et accès Discord du monde.",
    "onboarding": {
        "enabled": True,
        "starting_money": 100,
        "channel_name": "bienvenue-et-regles",
        "title": "Bienvenue dans ce monde",
        "rules_text": (
            "Avant de commencer, lis les règles puis valide ton arrivée :\n\n"
            "• Respecte les autres participants et leurs créations.\n"
            "• Ne triche pas et n'exploite pas les erreurs du moteur.\n"
            "• Suis les indications de l'équipe d'administration.\n\n"
            "En cliquant ci-dessous, tu confirmes avoir lu et accepté ces règles."
        ),
        "button_label": "Valider mon arrivée",
        "button_emoji": "✅",
        "confirmation": "Bienvenue ! Ton accès au monde est maintenant ouvert.",
        "action_name": "validation d'arrivée",
        "currency_label": "unités",
    },
    "roles": {
        "game_master": "🛡️ Administrateur du monde",
        "player": "👤 Participant",
        "bot": "🤖 Agents KingdomEngine",
    },
    "discord": {
        "general_category": "🏰 KINGDOM ENGINE",
        "building_category_template": "🏰 {name}",
        "welcome_channel": "bienvenue",
        "commands_channel": "commandes-du-royaume",
        "administration_channel": "administration-royaume",
        "building_text_channel": "{name}",
        "building_voice_channel_template": "🔊 {name}",
        "building_role_template": "🏠 Accès · {name}",
        "temporary_text_access": True,
        "entry_message_enabled": True,
        "entry_message": "{player} entre dans **{building}**. Que souhaites-tu faire ?",
    },
    "theme": {
        "primary_color": "7a1f1f",
        "accent_color": "b9924c",
    },
    "world_map": {
        "background_path": "",
        "width": 1600,
        "height": 900,
    },
}


def default_server_settings() -> dict[str, Any]:
    return deepcopy(DEFAULT_SERVER_SETTINGS)


def get_server_settings(store: Any) -> dict[str, Any]:
    """Retourne les paramètres publiés, complétés par les valeurs par défaut."""
    settings = default_server_settings()
    try:
        published = store.get("server_settings", SERVER_SETTINGS_KEY, published=True)["payload"]
    except Exception:
        return settings
    settings = _deep_merge(settings, published)
    published_onboarding = published.get("onboarding", {}) if isinstance(published, dict) else {}
    # Compatibilité avec les royaumes existants créés avant le vocabulaire
    # d'arrivée configurable : leur serment historique conserve son nom et ses
    # écus, tandis que les autres univers utilisent les termes génériques.
    if "action_name" not in published_onboarding and "serment" in str(settings["onboarding"].get("title", "")).lower():
        settings["onboarding"]["action_name"] = "serment"
    if "currency_label" not in published_onboarding and "serment" in str(settings["onboarding"].get("title", "")).lower():
        settings["onboarding"]["currency_label"] = "écus"
    # Migration de l'ancien modèle unique : les royaumes qui utilisent encore
    # la valeur historique obtiennent automatiquement un salon nommé d'après le
    # bâtiment. Les modèles personnalisés restent strictement inchangés.
    if str(settings["discord"].get("building_text_channel", "")).strip().lower() in {"entree", "entrée"}:
        settings["discord"]["building_text_channel"] = "{name}"
    return settings


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _deep_merge(dict(base[key]), value)
        else:
            base[key] = deepcopy(value)
    return base
