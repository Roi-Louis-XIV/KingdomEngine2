"""Paramètres serveur partagés par KingdomWeb, KingdomCore et le provisionneur.

Les valeurs ci-dessous ne sont que le document initial. Dès qu'une version est
publiée dans KingdomData, elle devient la seule source de vérité du moteur.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


SERVER_SETTINGS_KEY = "kingdom_server"

DEFAULT_SERVER_SETTINGS: dict[str, Any] = {
    "name": "Paramètres du Royaume",
    "emoji": "⚙️",
    "description": "Accueil, rôles, catégories et accès Discord du Royaume.",
    "onboarding": {
        "enabled": True,
        "channel_name": "prestation-de-serment",
        "title": "Le Serment de la Sainte Pelle",
        "rules_text": (
            "Avant d'entrer dans le Royaume, lis les règles puis prête serment :\n\n"
            "• Respecte les autres habitants et leurs créations.\n"
            "• Ne triche pas et n'exploite pas les erreurs du moteur.\n"
            "• Suis les indications des Maîtres du Royaume.\n\n"
            "En cliquant ci-dessous, tu jures fidélité au Royaume sur la Sainte Pelle."
        ),
        "button_label": "Je prête serment",
        "button_emoji": "🛠️",
        "confirmation": "Serment accepté. Les portes du Royaume te sont ouvertes.",
    },
    "roles": {
        "game_master": "👑 Maître du Royaume",
        "player": "⚔️ Aventurier",
        "bot": "🤖 Bots du Royaume",
    },
    "discord": {
        "general_category": "🏰 KINGDOM ENGINE",
        "building_category_template": "🏰 {name}",
        "welcome_channel": "bienvenue",
        "commands_channel": "commandes-du-royaume",
        "administration_channel": "administration-royaume",
        "building_text_channel": "entree",
        "building_voice_channel_template": "🔊 {name}",
        "temporary_text_access": True,
        "entry_message_enabled": True,
        "entry_message": "{player} entre dans **{building}**. Que souhaites-tu faire ?",
    },
    "theme": {
        "primary_color": "7a1f1f",
        "accent_color": "b9924c",
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
    return _deep_merge(settings, published)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _deep_merge(dict(base[key]), value)
        else:
            base[key] = deepcopy(value)
    return base
