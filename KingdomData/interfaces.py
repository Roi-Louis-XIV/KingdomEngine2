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
                        "title": building.get("interface_texts", {}).get("home_title", name),
                        "subtitle": building.get("interface_texts", {}).get("welcome", building.get("description", "")),
                        "emoji": emoji,
                    },
                },
                {
                    "id": f"enter_{building_key}"[:64],
                    "type": "button",
                    "slot": 0,
                    "props": {"label": building.get("interface_texts", {}).get("enter_label", "Entrer dans le camp"), "emoji": emoji, "style": "primary"},
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
                        "title": building.get("interface_texts", {}).get("refuge_title", npc.get("name") or name),
                        "subtitle": building.get("interface_texts", {}).get("refuge_subtitle", npc.get("profession") or "Bienvenue dans le camp."),
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
                    "id": f"talk_{building_key}"[:64], "type": "button", "slot": 8,
                    "props": {"label": building.get("interface_texts", {}).get("talk_label", "Discuter"), "emoji": "💬", "style": "secondary"},
                    "interaction": {"type": "action", "building": building_key, "action": "talk_npc"},
                },
                {
                    "id": f"refresh_{building_key}"[:64], "type": "button", "slot": 9,
                    "props": {"label": "Actualiser", "emoji": "🔄", "style": "secondary"},
                    "interaction": {"type": "refresh"},
                },
                {
                    "id": f"back_{building_key}_home"[:64],
                    "type": "button",
                    "slot": 4,
                    "props": {"label": "Quitter", "emoji": "🚪", "style": "danger"},
                    "interaction": {"type": "close"},
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
                    "subtitle": building.get("interface_texts", {}).get("zones_subtitle", "Choisis ta destination. Les détails de chaque lieu sont indiqués ci-dessous."),
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
            {
                "id": f"leave_{building_key}_{profession_key}"[:64],
                "type": "button",
                "slot": 24,
                "props": {"label": "Démissionner", "emoji": "📜", "style": "danger"},
                "visible_when": {"profession": profession_key, "no_pending_building": building_key},
                "interaction": {"type": "action", "building": building_key, "action": f"leave_{profession_key}", "on_success_page": "camp"},
            },
        ])
        pages.append({"key": page_key, "name": profession_name, "components": components})

    deliveries = list(modules.get("deliveries", []))
    if deliveries and modules.get("delivery_mode") == "all_available":
        camp.insert(-1, {"id": f"delivery_selector_{building_key}", "type": "dynamic_inventory_selector", "slot": 15, "props": {"placeholder": "Choisir une ressource à livrer…"}})
        camp.insert(-1, {"id": f"deliver_all_{building_key}", "type": "button", "slot": 20, "props": {"label": building.get("interface_texts", {}).get("deliveries_label", "Tout livrer"), "emoji": "📦", "style": "secondary"}, "interaction": {"type": "deliver_all"}})
    elif deliveries:
        camp.insert(-1, {
            "id": f"deliveries_{building_key}"[:64], "type": "select", "slot": 15,
            "props": {"placeholder": building.get("interface_texts", {}).get("deliveries_label", "Livrer des ressources…")},
            "options": [{
                "key": str(delivery["item_key"]), "label": f"Livrer {delivery['item_key']}", "emoji": "📦",
                "description": f"1 unité · {int(delivery.get('unit_price', 0))} écus",
                "interaction": {"type": "action", "building": building_key, "action": f"deliver_{delivery['item_key']}"},
            } for delivery in deliveries],
        })

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
        "blueprint": "activity_professions_v2",
    }


def interface_from_workshop_modules(building_key: str, building: dict[str, Any], actions: list[dict[str, Any]]) -> dict[str, Any]:
    """Parcours générique d'un atelier : vente, stock, métier, production et entretien."""
    modules, texts = building.get("modules", {}), building.get("interface_texts", {})
    products, recipes = list(modules.get("products", [])), list(modules.get("recipes", []))
    repairs, upgrades = modules.get("repairs", {}), list(modules.get("upgrades", []))
    profession = (modules.get("professions") or [{}])[0]
    profession_key = str(profession.get("key", "")); profession_name = str(profession.get("name", profession_key))
    emoji, name = building.get("emoji", "🏭"), building.get("name", building_key)
    pages: list[dict[str, Any]] = []
    home_buttons = [
        ("shop", "Commander", "🛒", "primary"), ("repairs", "Réparer un équipement", "🛠️", "secondary"),
        ("upgrades", texts.get("upgrade_label", "Améliorer un équipement"), "⬆️", "success"),
        ("stock", "Inventaire du bâtiment", "📋", "secondary"), ("job", f"Métier de {profession_name}", "🔨", "primary"),
    ]
    home = [{"id": f"hero_{building_key}", "type": "hero", "props": {"title": texts.get("home_title", name), "subtitle": texts.get("welcome", building.get("description", "")), "emoji": emoji}}]
    home.extend({"id": f"open_{building_key}_{page}", "type": "button", "slot": index, "props": {"label": label, "emoji": icon, "style": style}, "interaction": {"type": "navigate", "page": page}} for index, (page, label, icon, style) in enumerate(home_buttons))
    if profession_key:
        next(component for component in home if component["id"] == f"open_{building_key}_job")["visible_when"] = {"profession": profession_key}
    if profession_key:
        home.append({"id": f"join_{building_key}_{profession_key}", "type": "button", "slot": 5, "props": {"label": f"Devenir {profession_name}", "emoji": "🔨", "style": "success"}, "visible_when": {"none_of_professions": [profession_key]}, "interaction": {"type": "action", "building": building_key, "action": f"join_{profession_key}"}})
    home.extend([
        {"id": f"talk_{building_key}", "type": "button", "slot": 6, "props": {"label": texts.get("talk_label", "Discuter"), "emoji": "💬", "style": "secondary"}, "interaction": {"type": "action", "building": building_key, "action": "talk_npc"}},
        {"id": f"refresh_{building_key}", "type": "button", "slot": 7, "props": {"label": "Actualiser", "emoji": "🔄", "style": "secondary"}, "interaction": {"type": "refresh"}},
        {"id": f"close_{building_key}", "type": "button", "slot": 9, "props": {"label": "Quitter", "emoji": "🚪", "style": "danger"}, "interaction": {"type": "close"}},
    ])
    deliveries = list(modules.get("deliveries", []))
    if deliveries and modules.get("delivery_mode") == "all_available":
        home.append({"id": f"delivery_selector_{building_key}"[:64], "type": "dynamic_inventory_selector", "slot": 15, "props": {"placeholder": "Choisir une ressource à livrer…"}})
        home.append({"id": f"deliver_all_{building_key}"[:64], "type": "button", "slot": 20, "props": {"label": "Tout livrer", "emoji": "📦", "style": "secondary"}, "interaction": {"type": "deliver_all"}})
    elif deliveries:
        home.append({"id": f"deliveries_{building_key}", "type": "select", "slot": 15, "props": {"placeholder": "Livrer des ressources à l'atelier…"}, "options": [{"key": str(delivery["item_key"]), "label": f"Livrer {delivery['item_key']}", "emoji": "📦", "description": f"1 unité · {int(delivery.get('unit_price', 0))} écus", "interaction": {"type": "action", "building": building_key, "action": f"deliver_{delivery['item_key']}"}} for delivery in deliveries]})
    pages.append({"key": "home", "name": texts.get("home_title", name), "components": home})

    def back(page: str, slot: int = 24) -> dict[str, Any]:
        return {"id": f"back_{building_key}_{page}", "type": "button", "slot": slot, "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}}

    shop = [{"id": f"hero_{building_key}_shop", "type": "hero", "props": {"title": "COMPTOIR · Équipements", "subtitle": "Le stock dépend du travail des artisans.", "emoji": "🛒"}}]
    for index, product in enumerate(products):
        key = str(product["item_key"]); label = str(product.get("name", key)); icon = product.get("emoji", "📦")
        shop.extend([
            {"id": f"card_{building_key}_buy_{key}", "type": "card", "props": {"title": f"{icon} {label} · {int(product.get('price', 0))} écus", "text": product.get("description", "Équipement disponible selon le stock commun.")}},
            {"id": f"buy_{building_key}_{key}", "type": "button", "slot": index, "props": {"label": label, "emoji": icon, "style": "primary"}, "interaction": {"type": "action", "building": building_key, "action": f"buy_{key}"}},
        ])
    shop.append(back("shop")); pages.append({"key": "shop", "name": "🛒 COMPTOIR · Équipements", "components": shop})

    stock = [{"id": f"hero_{building_key}_stock", "type": "hero", "props": {"title": f"INVENTAIRE · {name}", "subtitle": "Stock commun visible par tous. Utilisez-le pour choisir quoi livrer et quoi fabriquer.", "emoji": "📋"}}, {"id": f"stock_{building_key}", "type": "building_inventory", "props": {"title": "Stock commun", "building": building_key}}, back("stock", 0)]
    pages.append({"key": "stock", "name": f"📋 INVENTAIRE · {name}", "components": stock})

    repair_components = [{"id": f"hero_{building_key}_repairs", "type": "hero", "props": {"title": "ATELIER DE RÉPARATION", "subtitle": "Choisis l'outil ou l'arme à remettre à neuf. Le prix dépend des points de durabilité manquants.", "emoji": "🛠️"}}]
    product_labels = {str(item["item_key"]): (str(item.get("name", item["item_key"])), str(item.get("emoji", "📦"))) for item in products}
    for index, (tool, maximum) in enumerate(repairs.get("durability", {}).items()):
        tool_name, tool_emoji = product_labels.get(str(tool), (str(tool).replace("_", " ").capitalize(), "🔨"))
        repair_components.append({"id": f"repair_{building_key}_{tool}", "type": "button", "slot": index, "props": {"label": f"Réparer {tool_name}", "emoji": tool_emoji, "style": "success"}, "interaction": {"type": "action", "building": building_key, "action": f"repair_{tool}", "confirm": "Confirmer la remise à neuf ?"}})
    repair_components.append(back("repairs")); pages.append({"key": "repairs", "name": "🛠️ ATELIER DE RÉPARATION", "components": repair_components})

    upgrade_components = [{"id": f"hero_{building_key}_upgrades", "type": "hero", "props": {"title": "AMÉLIORATIONS", "subtitle": "Renforce tes équipements avec des écus et des matériaux.", "emoji": "⬆️"}}]
    for index, upgrade in enumerate(upgrades):
        tool = str(upgrade.get("tool_key") or upgrade.get("tool") or upgrade.get("path")); level = int(upgrade.get("to_level", 1))
        upgrade_components.extend([{"id": f"upgrade_card_{building_key}_{tool}_{level}", "type": "card", "props": {"title": upgrade.get("name", f"Améliorer {tool}"), "text": f"Prix : **{int(upgrade.get('price', 0))} écus** · Niveau {upgrade.get('from_level', 1)} → {level}"}}, {"id": f"upgrade_{building_key}_{tool}_{level}", "type": "button", "slot": index, "props": {"label": upgrade.get("name", f"Améliorer {tool}"), "emoji": "⬆️", "style": "success"}, "interaction": {"type": "action", "building": building_key, "action": f"upgrade_{tool}_{level}", "confirm": "Confirmer cette amélioration ?"}}])
    upgrade_components.append(back("upgrades")); pages.append({"key": "upgrades", "name": "⬆️ AMÉLIORATIONS", "components": upgrade_components})

    job = [{"id": f"hero_{building_key}_job", "type": "hero", "props": {"title": f"Métier de {profession_name}", "subtitle": "Les ressources sont prélevées du stock commun dès le lancement.", "emoji": "🔨"}}]
    categories = []
    for recipe in recipes:
        if recipe.get("category", "production") not in categories: categories.append(recipe.get("category", "production"))
    for index, category in enumerate(categories):
        page_key = f"recipes_{category}"[:64]
        job.append({"id": f"open_{building_key}_{page_key}", "type": "button", "slot": index, "props": {"label": "Forger un outil" if category == "tool" else "Forger une arme" if category == "weapon" else f"Produire : {category}", "emoji": "⛏️" if category == "tool" else "⚔️", "style": "primary"}, "visible_when": {"profession": profession_key}, "interaction": {"type": "navigate", "page": page_key}})
        components = [{"id": f"hero_{building_key}_{page_key}", "type": "hero", "props": {"title": "OUTILS · Commandes de forge" if category == "tool" else "ARMES · Commandes de forge", "subtitle": "Les ressources sont prélevées du stock commun dès le lancement.", "emoji": "⛏️" if category == "tool" else "⚔️"}}]
        for recipe_index, recipe in enumerate(item for item in recipes if item.get("category", "production") == category):
            ingredients = " · ".join(f"{amount} × {item}" for item, amount in recipe.get("ingredients", {}).items())
            components.extend([{"id": f"recipe_card_{building_key}_{recipe['key']}", "type": "card", "props": {"title": recipe.get("name", recipe["key"]), "text": f"Niveau **{recipe.get('required_level', 1)}** · {recipe.get('duration_seconds', 0)} s\n{ingredients}\nRécompense : **{recipe.get('reward', 0)} écus · {recipe.get('experience', 0)} XP**"}}, {"id": f"recipe_{building_key}_{recipe['key']}", "type": "button", "slot": recipe_index, "props": {"label": recipe.get("name", recipe["key"]), "emoji": "🔥", "style": "primary"}, "interaction": {"type": "action", "building": building_key, "action": str(recipe["key"])}}, {"id": f"claim_{building_key}_{recipe['key']}", "type": "button", "slot": 10 + recipe_index, "props": {"label": "Récupérer la fabrication", "emoji": "📦", "style": "success"}, "visible_when": {"pending_action": str(recipe["key"])}, "interaction": {"type": "action", "building": building_key, "action": f"claim_{recipe['key']}"}}])
        components.append({**back(page_key), "interaction": {"type": "navigate", "page": "job"}}); pages.append({"key": page_key, "name": str(category), "components": components})
    if profession_key:
        job.append({"id": f"leave_{building_key}_{profession_key}", "type": "button", "slot": 4, "props": {"label": "Démissionner", "emoji": "📜", "style": "danger"}, "visible_when": {"profession": profession_key, "no_pending_building": building_key}, "interaction": {"type": "action", "building": building_key, "action": f"leave_{profession_key}", "on_success_page": "home"}})
    job.append(back("job")); pages.append({"key": "job", "name": f"Métier de {profession_name}", "components": job})
    return {"name": f"Interface - {name}", "emoji": emoji, "description": f"Atelier privé de {name}.", "target_building_key": building_key, "start_page": "home", "theme": {"color": building.get("color", "f1c40f"), "density": "compact", "radius": 12}, "pages": pages, "source": building.get("source", "KingdomWeb"), "profession_labels": {profession_key: profession_name}, "blueprint": "workshop_market_v1"}


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
        if payload.get("interface", {}).get("blueprint") == "activity_professions_v2":
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
