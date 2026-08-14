"""Contrat declaratif partage par KingdomWeb et les renderers du moteur."""

from __future__ import annotations

from typing import Any


def interface_from_activity_modules(
    building_key: str,
    building: dict[str, Any],
    actions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Construit un parcours métier lisible depuis les modules d'un bâtiment.

    Le rendu Discord ne connaît ni la forêt ni un métier particulier : les
    pages, conditions, destinations et actions proviennent exclusivement de la
    fiche publiée dans KingdomData.
    """
    modules = building.get("modules", {})
    professions = list(modules.get("professions", []))
    activities = list(modules.get("activities", []))
    if not professions or not activities:
        return interface_from_building(building_key, building, actions)

    name = building.get("name", building_key)
    emoji = building.get("emoji", "🏰")
    npc = modules.get("npc", {})
    profession_keys = [str(profession["key"]) for profession in professions]
    pages: list[dict[str, Any]] = [
        {
            "key": "home",
            "name": "Accueil",
            "components": [
                {
                    "id": f"hero_{building_key}_home"[:64],
                    "type": "hero",
                    "props": {
                        "title": name,
                        "subtitle": building.get("description", ""),
                        "emoji": emoji,
                    },
                },
                {
                    "id": f"enter_{building_key}"[:64],
                    "type": "button",
                    "slot": 0,
                    "props": {"label": "Entrer dans le camp", "emoji": "🚪", "style": "primary"},
                    "interaction": {"type": "navigate", "page": "camp"},
                },
            ],
        },
        {
            "key": "camp",
            "name": "Dans le camp",
            "components": [
                {
                    "id": f"hero_{building_key}_camp"[:64],
                    "type": "hero",
                    "props": {
                        "title": npc.get("name") or name,
                        "subtitle": npc.get("profession") or "Bienvenue dans le camp.",
                        "emoji": emoji,
                    },
                },
                {
                    "id": f"text_{building_key}_camp"[:64],
                    "type": "text",
                    "props": {
                        "text": (npc.get("phrases") or ["Choisis ce que tu souhaites faire."])[0],
                    },
                },
                {
                    "id": f"inventory_{building_key}"[:64],
                    "type": "button",
                    "slot": 0,
                    "props": {"label": "Consulter mon inventaire", "emoji": "🎒", "style": "secondary"},
                    "interaction": {"type": "navigate", "page": "inventory"},
                },
                {
                    "id": f"back_{building_key}_home"[:64],
                    "type": "button",
                    "slot": 4,
                    "props": {"label": "Sortir du camp", "emoji": "↩️", "style": "secondary"},
                    "interaction": {"type": "navigate", "page": "home"},
                },
            ],
        },
        {
            "key": "inventory",
            "name": "Mon inventaire",
            "components": [
                {
                    "id": f"hero_{building_key}_inventory"[:64],
                    "type": "hero",
                    "props": {"title": "Mon inventaire", "subtitle": "Mes ressources et mon état actuel", "emoji": "🎒"},
                },
                {
                    "id": f"player_inventory_{building_key}"[:64],
                    "type": "player_inventory",
                    "props": {"title": "Contenu du sac"},
                },
                {
                    "id": f"back_{building_key}_camp"[:64],
                    "type": "button",
                    "slot": 0,
                    "props": {"label": "Retour au camp", "emoji": "↩️", "style": "secondary"},
                    "interaction": {"type": "navigate", "page": "camp"},
                },
            ],
        },
    ]

    camp = pages[1]["components"]
    for index, profession in enumerate(professions, 1):
        profession_key = str(profession["key"])
        profession_name = str(profession.get("name") or profession_key)
        page_key = f"job_{profession_key}"[:64]
        profession_emoji = str(profession.get("emoji") or ("🪓" if index == 1 else "🏹"))
        camp.extend([
            {
                "id": f"join_{building_key}_{profession_key}"[:64],
                "type": "button",
                "slot": index + 5,
                "props": {"label": f"Devenir {profession_name}", "emoji": profession_emoji, "style": "success"},
                "visible_when": {"none_of_professions": profession_keys},
                "interaction": {
                    "type": "action",
                    "building": building_key,
                    "action": f"join_{profession_key}",
                    "on_success_page": page_key,
                },
            },
            {
                "id": f"open_{building_key}_{profession_key}"[:64],
                "type": "button",
                "slot": index,
                "props": {"label": f"Continuer comme {profession_name}", "emoji": profession_emoji, "style": "primary"},
                "visible_when": {"profession": profession_key},
                "interaction": {"type": "navigate", "page": page_key},
            },
        ])

        profession_activities = [activity for activity in activities if str(activity.get("profession", "")) == profession_key]
        components: list[dict[str, Any]] = [
            {
                "id": f"hero_{building_key}_{profession_key}"[:64],
                "type": "hero",
                "props": {
                    "title": profession_name,
                    "subtitle": "Choisis ta destination. Les détails de chaque lieu sont indiqués ci-dessous.",
                    "emoji": profession_emoji,
                },
            },
        ]
        for activity in profession_activities:
            details = (
                f"{activity.get('description', '')}\n"
                f"Niveau {int(activity.get('required_level', 1))} · "
                f"{int(activity.get('duration_seconds', 0))} s · "
                f"{int(activity.get('energy_cost', 0))} énergie"
            )
            if activity.get("durability_cost"):
                details += f" · {int(activity['durability_cost'])} usure"
            components.append({
                "id": f"place_{building_key}_{activity['key']}"[:64],
                "type": "card",
                "props": {
                    "title": f"{activity.get('emoji', '🌲')} {activity.get('name', activity['key'])}",
                    "text": details,
                },
            })
        components.extend([
            {
                "id": f"destinations_{building_key}_{profession_key}"[:64],
                "type": "select",
                "slot": 0,
                "props": {"placeholder": "Choisir où aller dans la forêt…"},
                "visible_when": {"profession": profession_key, "no_pending_building": building_key},
                "options": [
                    {
                        "key": str(activity["key"]),
                        "label": str(activity.get("name", activity["key"])),
                        "emoji": activity.get("emoji", "🌲"),
                        "description": (
                            f"Niv. {int(activity.get('required_level', 1))} · "
                            f"{int(activity.get('duration_seconds', 0))} s · "
                            f"{int(activity.get('energy_cost', 0))} énergie"
                        ),
                        "interaction": {"type": "action", "building": building_key, "action": str(activity["key"])},
                    }
                    for activity in profession_activities
                ],
            },
            *[
                {
                    "id": f"claim_{building_key}_{activity['key']}"[:64],
                    "type": "button",
                    "slot": 5 + activity_index,
                    "props": {"label": f"Récupérer : {activity.get('name', activity['key'])}", "emoji": "📦", "style": "success"},
                    "visible_when": {"profession": profession_key, "pending_action": str(activity["key"])},
                    "interaction": {"type": "action", "building": building_key, "action": f"claim_{activity['key']}"},
                }
                for activity_index, activity in enumerate(profession_activities)
            ],
            {
                "id": f"back_{building_key}_{profession_key}"[:64],
                "type": "button",
                "slot": 20,
                "props": {"label": "Retour au camp", "emoji": "↩️", "style": "secondary"},
                "interaction": {"type": "navigate", "page": "camp"},
            },
        ])
        pages.append({"key": page_key, "name": profession_name, "components": components})

    return {
        "name": f"Interface - {name}",
        "emoji": emoji,
        "description": f"Parcours privé de {name}.",
        "target_building_key": building_key,
        "start_page": "home",
        "theme": {"color": building.get("color", "7a1f1f"), "density": "compact", "radius": 12},
        "pages": pages,
        "source": building.get("source", "KingdomWeb"),
        "profession_labels": {
            str(profession["key"]): str(profession.get("name") or profession["key"])
            for profession in professions
        },
        "blueprint": "activity_professions_v1",
    }


def interface_from_building(building_key: str, building: dict[str, Any], actions: list[dict[str, Any]]) -> dict[str, Any]:
    """Produit une interface complete sans connaissance d'un batiment particulier."""
    page_size = 18
    action_pages = [actions[index:index + page_size] for index in range(0, len(actions), page_size)] or [[]]
    pages: list[dict[str, Any]] = []
    home_components = [
        {"id": f"hero_{building_key}"[:64], "type": "hero", "props": {"title": building.get("name", building_key), "subtitle": building.get("description", ""), "emoji": building.get("emoji", "🏰")}},
        {"id": f"text_{building_key}"[:64], "type": "text", "props": {"text": "Choisissez une section pour continuer."}},
    ]
    for index, _actions in enumerate(action_pages, 1):
        page_key = f"actions_{index}"
        home_components.append({
            "id": f"nav_{building_key}_{index}"[:64], "type": "button",
            "props": {"label": "Actions" if len(action_pages) == 1 else f"Actions {index}", "emoji": "⚔️", "style": "primary"},
            "interaction": {"type": "navigate", "page": page_key},
            "slot": index - 1,
        })
    pages.append({"key": "home", "name": "Accueil", "components": home_components})
    for index, page_actions in enumerate(action_pages, 1):
        components: list[dict[str, Any]] = [
            {"id": f"title_{building_key}_{index}"[:64], "type": "hero", "props": {"title": building.get("name", building_key), "subtitle": "Actions disponibles", "emoji": building.get("emoji", "🏰")}},
            {"id": f"back_{building_key}_{index}"[:64], "type": "button", "slot": 0, "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}},
        ]
        components.extend({
            "id": f"action_{building_key}_{action['key']}"[:64], "type": "button",
            "props": {"label": action.get("name", action["key"]), "emoji": action.get("emoji", "⚙️"), "style": "primary"},
            "interaction": {"type": "action", "building": building_key, "action": action["key"]},
            "slot": action_index,
        } for action_index, action in enumerate(page_actions, 1))
        pages.append({"key": f"actions_{index}", "name": "Actions" if len(action_pages) == 1 else f"Actions {index}", "components": components})
    return {
        "name": f"Interface - {building.get('name', building_key)}",
        "emoji": building.get("emoji", "🖥️"),
        "description": f"Navigation visuelle de {building.get('name', building_key)}.",
        "target_building_key": building_key,
        "start_page": "home",
        "theme": {"color": building.get("color", "7a1f1f"), "density": "comfortable", "radius": 12},
        "pages": pages,
        "source": building.get("source", "KingdomWeb"),
    }


def migrate_published_building_interfaces(store: Any) -> int:
    """Intègre les anciennes interfaces séparées aux bâtiments publiés.

    Une fiche possédant déjà un brouillon utilisateur n'est pas modifiée : son
    interface sera intégrée par KingdomWeb lors de la prochaine sauvegarde.
    """
    migrated = 0
    for published in store.list("building", published=True):
        payload = published["payload"]
        if payload.get("interface"):
            continue
        latest = store.get("building", published["entity_key"])
        if latest["status"] != "published" or latest["version"] != published["version"]:
            continue
        definition = None
        if payload.get("interface_key"):
            try:
                definition = store.get("interface", payload["interface_key"], published=True)["payload"]
            except Exception:
                pass
        definition = definition or interface_from_building(published["entity_key"], payload, payload.get("actions", []))
        upgraded = {**payload, "interface": definition}
        draft = store.save("building", published["entity_key"], upgraded, "migration-interface-unifiee", published["version"])
        store.publish("building", published["entity_key"], draft["version"], "migration-interface-unifiee")
        migrated += 1
    return migrated


def migrate_activity_profession_interfaces(store: Any) -> int:
    """Met à niveau une ancienne interface V1 à plusieurs métiers une seule fois."""
    migrated = 0
    for published in store.list("building", published=True):
        payload = published["payload"]
        modules = payload.get("modules", {})
        if payload.get("source") != "KingdomEngine V1":
            continue
        if payload.get("interface", {}).get("blueprint") == "activity_professions_v1":
            continue
        if len(modules.get("professions", [])) < 2 or not modules.get("activities"):
            continue
        latest = store.get("building", published["entity_key"])
        if latest["status"] != "published" or latest["version"] != published["version"]:
            continue
        upgraded = {
            **payload,
            "interface": interface_from_activity_modules(
                published["entity_key"], payload, payload.get("actions", [])
            ),
        }
        draft = store.save(
            "building", published["entity_key"], upgraded,
            "migration-parcours-metiers", published["version"],
        )
        store.publish(
            "building", published["entity_key"], draft["version"],
            "migration-parcours-metiers",
        )
        migrated += 1
    return migrated
