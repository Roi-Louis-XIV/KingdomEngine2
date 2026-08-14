"""Import idempotent de KingdomEngine V1 vers les definitions pilotables par KingdomWeb."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from KingdomData import (
    ContentStore,
    interface_from_activity_modules,
    interface_from_building,
    migrate_activity_profession_interfaces,
    migrate_published_building_interfaces,
)


def definitions_from_v1(v1_root: str | Path | None = None) -> list[dict[str, Any]]:
    root = Path(v1_root) if v1_root else Path(__file__).resolve().parent.parent / "KingdomEngine"
    definitions = _building_definitions(root)
    items_root = root / "KingdomData" / "items"
    for catalogue in sorted(items_root.glob("*.json")):
        category = catalogue.stem
        for key, payload in _read(catalogue).items():
            normalized = {
                **payload,
                "category": category,
                "stack_limit": 999 if payload.get("stackable", True) else 1,
                "source": "KingdomEngine V1",
            }
            definitions.append({"type": "item", "key": key, "payload": normalized})
    voice_root = root / "KingdomVoice" / "config"
    for config in sorted(voice_root.glob("*.json")):
        payload = _read(config)
        key = config.stem
        building = str(payload.get("building", "")).lower()
        normalized = {
            **payload,
            "name": payload.get("name", key.title()),
            "emoji": "🎙️",
            "description": f"Bot vocal historique associe a {payload.get('building', 'un batiment')}.",
            "bot_type": "voice",
            "enabled": False,
            "token_env": f"{key.upper()}_BOT_TOKEN",
            "application_id_env": f"{key.upper()}_APPLICATION_ID",
            "building_key": _building_key(building),
            "auto_join": True,
            "source": "KingdomEngine V1",
        }
        definitions.append({"type": "bot", "key": f"voice_{key}", "payload": normalized})
    return definitions


def import_v1(store: ContentStore, v1_root: str | Path | None = None) -> int:
    before = {(x["entity_type"], x["entity_key"]) for x in store.list()}
    definitions = definitions_from_v1(v1_root)
    store.seed(definitions)
    _link_existing_v1_buildings(store, definitions)
    migrate_published_building_interfaces(store)
    migrate_activity_profession_interfaces(store)
    return sum((x["type"], x["key"]) not in before for x in definitions)


def _link_existing_v1_buildings(store: ContentStore, definitions: list[dict[str, Any]]) -> None:
    """Ajoute seulement la reference visuelle aux imports anterieurs, sans ecraser leur configuration."""
    for definition in (item for item in definitions if item["type"] == "building"):
        current = store.get("building", definition["key"])
        payload = current["payload"]
        if current["status"] != "published" or payload.get("source") != "KingdomEngine V1" or payload.get("interface"):
            continue
        upgraded = {
            **payload,
            "interface_key": definition["payload"]["interface_key"],
            "interface": clone_interface(definition["payload"]["interface"]),
        }
        draft = store.save("building", definition["key"], upgraded, "migration-v1-interface", current["version"])
        store.publish("building", definition["key"], draft["version"], "migration-v1-interface")


def _building_definitions(root: Path) -> list[dict[str, Any]]:
    buildings_root = root / "KingdomData" / "buildings"
    item_prices = _item_prices(root / "KingdomData" / "items")
    delivery_markets = _read(buildings_root / "deliveries.json").get("buildings", {}) if (buildings_root / "deliveries.json").exists() else {}
    tavern_rumors = _read(buildings_root / "tavern_rumors.json").get("rumors", []) if (buildings_root / "tavern_rumors.json").exists() else []
    builders = {
        "mine": lambda data: _mine_payload(data),
        "forest": lambda data: _forest_payload(data),
        "forge": lambda data: _forge_payload(data, item_prices),
        "tavern": lambda data: _tavern_payload(data, tavern_rumors),
    }
    definitions: list[dict[str, Any]] = []
    for key, builder in builders.items():
        path = buildings_root / f"{key}.json"
        if path.exists():
            payload = builder(_read(path))
            market = delivery_markets.get(key, {})
            payload["modules"]["market_purchases"] = [
                {"item_key": item, "unit_price": price}
                for item, price in market.get("prices", {}).items()
            ]
            payload["action_mode"] = "generated"
            payload["actions"] = actions_from_modules(key, payload["modules"])
            payload["interface_key"] = f"ui_{key}"
            payload["interface"] = (
                interface_from_activity_modules(key, payload, payload["actions"])
                if key == "forest" else interface_from_building(key, payload, payload["actions"])
            )
            definitions.append({"type": "building", "key": key, "payload": payload})
            definitions.append({"type": "interface", "key": f"ui_{key}", "payload": clone_interface(payload["interface"])})
    projects_path = buildings_root / "construction_projects.json"
    if projects_path.exists():
        for project in _read(projects_path).get("projects", []):
            payload = _project_payload(project)
            payload["action_mode"] = "generated"
            payload["actions"] = actions_from_modules(project["key"], payload["modules"])
            payload["interface_key"] = f"ui_{project['key']}"
            payload["interface"] = interface_from_building(project["key"], payload, payload["actions"])
            definitions.append({"type": "building", "key": project["key"], "payload": payload})
            definitions.append({"type": "interface", "key": f"ui_{project['key']}", "payload": clone_interface(payload["interface"])})
    return definitions


def clone_interface(payload: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(payload, ensure_ascii=False))


def _item_prices(items_root: Path) -> dict[str, int]:
    prices: dict[str, int] = {}
    for catalogue in items_root.glob("*.json"):
        for key, payload in _read(catalogue).items():
            prices[key] = int(payload.get("price", 0))
    return prices


def _base_payload(data: dict[str, Any], emoji: str, description: str, kind: str) -> dict[str, Any]:
    npc_key = str(data.get("npc", data.get("npc_name", ""))).strip().lower().replace(" ", "_")
    npc = {
        "key": npc_key,
        "name": data.get("npc_name", str(data.get("npc", "")).title()),
        "profession": data.get("npc_profession", ""),
        "age": data.get("npc_age"),
        "personality": data.get("npc_personality", data.get("npc_traits", [])),
        "phrases": data.get("npc_phrases", []),
    }
    return {
        "name": data.get("name", kind.title()),
        "emoji": emoji,
        "description": description,
        "building_kind": kind,
        "color": "7a1f1f",
        "npc_name": npc["name"],
        "source": "KingdomEngine V1",
        "modules": {"npc": npc},
    }


def _mine_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload = _base_payload(data, "⛏️", "Extraire minerais et pierre dans les galeries royales.", "harvest")
    activities = []
    for gallery in data.get("galleries", []):
        outcomes = [
            {"key": loot["item_key"], "weight": loot.get("weight", 1), "rewards": {loot["item_key"]: [loot.get("min", 1), loot.get("max", 1)]}}
            for loot in gallery.get("loot", [])
        ]
        activities.append({
            **gallery, "profession": "miner", "tool": "simple_pickaxe",
            "tool_max_durability": int(data.get("starter_pickaxe", {}).get("durability", 20)),
            "outcomes": outcomes,
        })
    payload["modules"].update({
        "rules": {
            "energy_max": data.get("energy_max", 100),
            "energy_recovery_per_hour": data.get("energy_recovery_per_hour", 10),
            "experience_per_level": data.get("experience_per_level", 100),
        },
        "professions": [{
            "key": "miner", "name": data.get("npc_profession", "Mineur"),
            "required_item": "simple_pickaxe", "grant_required_item": True,
            "starter_tool": data.get("starter_pickaxe", {}),
            "tool_tiers": data.get("pickaxe_tiers", {}),
        }],
        "activities": activities,
        "products": [], "recipes": [], "deliveries": [], "repairs": {}, "upgrades": [],
    })
    return payload


def _forest_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload = _base_payload(data, "🌲", "Exploiter la foret, chasser et livrer ses ressources.", "harvest")
    activities = []
    for profession, zones in data.get("zones", {}).items():
        for zone in zones:
            tool = data.get("profession_requirements", {}).get(profession)
            tool_tier = data.get("tool_tiers", {}).get(tool, {})
            activities.append({
                **zone,
                "profession": profession,
                "tool": tool,
                "durability_cost": zone.get("durability_cost", 1 if profession == "hunter" else 0),
                "tool_max_durability": tool_tier.get("max_durability", 90 if profession == "hunter" else data.get("axe_durability", 20)),
                "outcomes": [
                    {"key": outcome.get("key", "result"), "weight": outcome.get("weight", 1), "rewards": outcome.get("loot", {})}
                    for outcome in zone.get("outcomes", [])
                ],
            })
    professions = [
        {
            "key": key,
            "name": {"woodcutter": "Bûcheron", "hunter": "Chasseur"}.get(key, key.title()),
            "emoji": {"woodcutter": "🪓", "hunter": "🏹"}.get(key, "📜"),
            "required_item": item, "tool_tiers": data.get("tool_tiers", {}).get(item, {}),
        }
        for key, item in data.get("profession_requirements", {}).items()
    ]
    deliveries = [
        {"item_key": item, "target_building_key": config.get("building_key", ""), "unit_price": config.get("unit_price", 0)}
        for item, config in data.get("deliveries", {}).items()
    ]
    payload["modules"].update({
        "rules": {"experience_per_level": data.get("experience_per_level", 100), "default_axe_durability": data.get("axe_durability", 20)},
        "professions": professions,
        "activities": activities,
        "deliveries": deliveries,
        "products": [], "recipes": [], "repairs": {}, "upgrades": [],
    })
    return payload


def _forge_payload(data: dict[str, Any], item_prices: dict[str, int]) -> dict[str, Any]:
    payload = _base_payload(data, "⚒️", "Forger, reparer, ameliorer et approvisionner les equipements du Royaume.", "production")
    initial_stock = int(data.get("initial_stock", 0))
    products = [
        {"item_key": item, "price": item_prices.get(item, 0), "active": True, "initial_stock": initial_stock}
        for item in data.get("products", [])
    ]
    deliveries = [
        {"item_key": item, "target_building_key": "forge", "unit_price": price}
        for item, price in data.get("delivery_prices", {}).items()
    ]
    recipes = [{
        **recipe, "profession": "blacksmith", "active": recipe.get("active", True),
        "ingredient_source": "building_stock", "output_destination": "building_stock",
    } for recipe in data.get("recipes", [])]
    upgrades = [
        {"path": path, "tool_key": "simple_pickaxe" if path == "miner_pickaxe" else path, **upgrade}
        for path, values in data.get("upgrades", {}).items()
        for upgrade in values
    ]
    payload["modules"].update({
        "rules": {"experience_per_level": data.get("experience_per_level", 100)},
        "professions": [{"key": "blacksmith", "name": data.get("npc_profession", "Forgeron")}],
        "products": products,
        "recipes": recipes,
        "activities": [],
        "deliveries": deliveries,
        "repairs": data.get("repair", {}),
        "upgrades": upgrades,
    })
    return payload


def _tavern_payload(data: dict[str, Any], rumor_catalogue: list[dict[str, Any]]) -> dict[str, Any]:
    payload = _base_payload(data, "🍺", "Acheter des plats, travailler en cuisine, jouer et ecouter les rumeurs.", "commerce")
    cook = data.get("cook_job", {})
    recipes = [
        {
            **recipe, "name": recipe.get("title", recipe.get("key", "Recette")), "profession": "cook",
            "energy_cost": recipe.get("energy_cost", 15), "ingredient_source": "building_stock",
            "output_destination": "building_stock",
            "initial_ingredient_stock": cook.get("initial_ingredient_stock", {}),
        }
        for recipe in cook.get("recipes", [])
    ]
    payload["modules"].update({
        "rules": {"experience_per_level": cook.get("experience_per_level", 100), "max_active_missions": cook.get("max_active_missions", 1)},
        "professions": [{"key": "cook", "name": cook.get("name", "Cuisinier")}],
        "products": data.get("products", []),
        "recipes": recipes,
        "activities": [], "deliveries": [], "repairs": {}, "upgrades": [],
        "stock": {"ingredients": cook.get("initial_ingredient_stock", {})},
        "categories": data.get("categories", {}),
        "rumors": {**data.get("rumors", {}), "catalogue": rumor_catalogue},
        "games": {"dice": _dice_configuration(data.get("dice_game", {}))},
    })
    return payload


def _dice_configuration(config: dict[str, Any]) -> dict[str, Any]:
    multipliers = config.get("multipliers", {})
    return {
        **config, "sides": 6,
        "bets": [
            *[{"key": f"crown_{face}", "name": f"Couronne {face}", "winning_faces": [face], "multiplier": multipliers.get("crown", 6)} for face in range(1, 7)],
            {"key": "judgement_even", "name": "Jugement pair", "winning_faces": [2, 4, 6], "multiplier": multipliers.get("judgement", 2)},
            {"key": "judgement_odd", "name": "Jugement impair", "winning_faces": [1, 3, 5], "multiplier": multipliers.get("judgement", 2)},
            {"key": "destiny_low", "name": "Destin 1 a 3", "winning_faces": [1, 2, 3], "multiplier": multipliers.get("destiny", 2)},
            {"key": "destiny_high", "name": "Destin 4 a 6", "winning_faces": [4, 5, 6], "multiplier": multipliers.get("destiny", 2)},
        ],
    }


def _project_payload(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": project["name"], "emoji": project.get("emoji", "🏗️"),
        "description": project.get("description", ""), "building_kind": "administration",
        "color": "7a1f1f", "npc_name": "", "source": "KingdomEngine V1",
        "modules": {
            "npc": {}, "rules": {}, "professions": [], "activities": [], "products": [], "recipes": [],
            "deliveries": [], "repairs": {}, "upgrades": [], "market_purchases": [], "construction": project,
        },
    }


def actions_from_modules(building_key: str, modules: dict[str, Any]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    xp_per_level = int(modules.get("rules", {}).get("experience_per_level", 100))
    professions = {item["key"]: item for item in modules.get("professions", [])}
    for profession in professions.values():
        effects: list[dict[str, Any]] = [
            {"type": "profession", "profession": profession["key"], "experience": 0, "experience_per_level": xp_per_level},
            {"type": "message", "text": f"Vous exercez maintenant le metier : {profession.get('name', profession['key'])}."},
        ]
        required_item = profession.get("required_item")
        if required_item and profession.get("grant_required_item"):
            effects.insert(1, {"type": "reward", "resource": required_item, "amount": 1})
        join_requirements = {}
        if required_item and not profession.get("grant_required_item"):
            join_requirements = {"items": {required_item: 1}}
        actions.append({
            "key": f"join_{profession['key']}", "name": f"Devenir {profession.get('name', profession['key'])}",
            "emoji": "📜", "enabled": True, "requirements": join_requirements, "effects": effects,
        })
    for activity in modules.get("activities", []):
        profession = str(activity.get("profession", ""))
        requirements: dict[str, Any] = {"profession": profession, "min_level": int(activity.get("required_level", 1))}
        if activity.get("tool"):
            requirements["items"] = {activity["tool"]: 1}
        immediate_effects = []
        if activity.get("energy_cost"):
            immediate_effects.append({"type": "cost", "resource": "energy", "amount": int(activity["energy_cost"])})
        if activity.get("durability_cost") and activity.get("tool"):
            immediate_effects.append({
                "type": "durability", "tool": activity["tool"], "amount": int(activity["durability_cost"]),
                "max_durability": int(activity.get("tool_max_durability", 80)),
            })
        deferred_effects = [{
            "type": "random_bundle", "outcomes": activity.get("outcomes", []) or [{"key": "empty", "weight": 1, "rewards": {}}],
            "loot_bonus_tool": activity.get("tool") if profession == "miner" else None,
        }]
        if profession:
            deferred_effects.append({"type": "profession", "profession": profession, "experience": int(activity.get("experience", 0)), "experience_per_level": xp_per_level})
        deferred_effects.append({"type": "emit", "event": "building.activity.completed", "payload": {"building": building_key, "activity": activity["key"]}})
        action = {
            "key": activity["key"], "name": activity.get("name", activity["key"]), "emoji": activity.get("emoji", "⚙️"),
            "description": activity.get("description", ""), "enabled": activity.get("active", True),
            "duration_seconds": int(activity.get("duration_seconds", 0)), "requirements": requirements,
        }
        _append_timed(actions, action, immediate_effects, deferred_effects)
    for product in modules.get("products", []):
        item = product["item_key"]
        product_effects = [
            {"type": "cost", "resource": "money", "amount": int(product.get("price", 0))},
            {"type": "stock_cost", "item": item, "amount": 1, "initial_stock": int(product.get("initial_stock", 0))},
            {"type": "reward", "resource": item, "amount": 1},
        ]
        repair_maximum = modules.get("repairs", {}).get("durability", {}).get(item)
        if repair_maximum:
            product_effects.append({"type": "durability", "tool": item, "amount": 0, "max_durability": int(repair_maximum)})
        actions.append({
            "key": f"buy_{item}", "name": f"Acheter {item}", "emoji": "🛒", "enabled": product.get("active", True),
            "effects": product_effects,
        })
    for recipe in modules.get("recipes", []):
        profession = str(recipe.get("profession", ""))
        if recipe.get("ingredient_source") == "building_stock":
            initial = recipe.get("initial_ingredient_stock", {})
            immediate_effects = [
                {"type": "stock_cost", "item": item, "amount": int(amount), "initial_stock": int(initial.get(item, 0))}
                for item, amount in recipe.get("ingredients", {}).items()
            ]
        else:
            immediate_effects = [{"type": "cost", "resource": item, "amount": int(amount)} for item, amount in recipe.get("ingredients", {}).items()]
        if recipe.get("energy_cost"):
            immediate_effects.append({"type": "cost", "resource": "energy", "amount": int(recipe["energy_cost"])})
        deferred_effects = []
        output_effect = "stock_reward" if recipe.get("output_destination") == "building_stock" else "reward"
        if output_effect == "stock_reward":
            deferred_effects.append({"type": output_effect, "item": recipe["output_item_key"], "amount": int(recipe.get("output_quantity", 1)), "building": building_key})
        else:
            deferred_effects.append({"type": output_effect, "resource": recipe["output_item_key"], "amount": int(recipe.get("output_quantity", 1))})
        if recipe.get("reward"):
            deferred_effects.append({"type": "reward", "resource": "money", "amount": int(recipe["reward"])})
        if profession:
            deferred_effects.append({"type": "profession", "profession": profession, "experience": int(recipe.get("experience", 0)), "experience_per_level": xp_per_level})
        action = {
            "key": recipe["key"], "name": recipe.get("name", recipe.get("title", recipe["key"])), "emoji": "🛠️",
            "enabled": recipe.get("active", True), "duration_seconds": int(recipe.get("duration_seconds", 0)),
            "requirements": {"profession": profession, "min_level": int(recipe.get("required_level", 1))} if profession else {},
        }
        _append_timed(actions, action, immediate_effects, deferred_effects)
    for delivery in modules.get("deliveries", []):
        item = delivery["item_key"]
        actions.append({
            "key": f"deliver_{item}", "name": f"Livrer {item}", "emoji": "📦", "enabled": True,
            "effects": [
                {"type": "cost", "resource": item, "amount": 1},
                {"type": "stock_reward", "item": item, "amount": 1, "building": delivery.get("target_building_key", building_key)},
                {"type": "reward", "resource": "money", "amount": int(delivery.get("unit_price", 0))},
            ],
        })
    for purchase in modules.get("market_purchases", []):
        item = purchase["item_key"]
        actions.append({
            "key": f"supply_{item}", "name": f"Approvisionner en {item}", "emoji": "🚚", "enabled": True,
            "effects": [
                {"type": "cost", "resource": item, "amount": 1},
                {"type": "stock_reward", "item": item, "amount": 1, "building": building_key},
                {"type": "reward", "resource": "money", "amount": int(purchase.get("unit_price", 0))},
            ],
        })
    construction = modules.get("construction", {})
    for stage in construction.get("stages", []):
        for requirement in stage.get("requirements", []):
            resources = requirement.get("accepted_items", []) or (["money"] if requirement.get("kind") == "currency" else [requirement["key"]])
            for resource in resources:
                actions.append({
                    "key": f"give_{stage['key']}_{resource}",
                    "name": f"Contribuer : {requirement.get('name', resource)}", "emoji": requirement.get("emoji", "📦"), "enabled": True,
                    "requirements": {"project_stage": stage["key"], "target_quantity": int(requirement.get("quantity", 0))},
                    "effects": [
                        {"type": "cost", "resource": resource, "amount": 1},
                        {"type": "stock_reward", "item": f"project_{stage['key']}_{requirement['key']}", "amount": 1, "building": building_key},
                    ],
                })
    rumors = modules.get("rumors", {})
    rumor_choices = [
        {"key": rumor["key"], "text": rumor.get("text", ""), "weight": rumor.get("weight", 1)}
        for rumor in rumors.get("catalogue", []) if rumor.get("enabled", True)
    ]
    if rumor_choices:
        actions.append({
            "key": "hear_rumor", "name": "Ecouter une rumeur", "emoji": "🗣️", "enabled": True,
            "cooldown_seconds": int(rumors.get("player_cooldown_seconds", 0)),
            "global_cooldown_seconds": int(rumors.get("global_cooldown_seconds", 0)),
            "effects": [{"type": "random_message", "choices": rumor_choices}],
        })
    repair = modules.get("repairs", {})
    for tool, maximum in repair.get("durability", {}).items():
        if tool == "simple_pickaxe":
            price_per_point = int(repair.get("pickaxe_price_per_point", 1))
        elif tool == "simple_axe":
            price_per_point = int(repair.get("axe_price_per_point", 1))
        else:
            price_per_point = int(repair.get("equipment_price_per_point", 1))
        actions.append({
            "key": f"repair_{tool}", "name": f"Reparer {tool}", "emoji": "🔧", "enabled": True,
            "requirements": {"items": {tool: 1}},
            "effects": [{"type": "repair", "tool": tool, "max_durability": int(maximum), "price_per_point": price_per_point}],
        })
    for upgrade in modules.get("upgrades", []):
        tool = upgrade.get("tool_key") or upgrade.get("tool") or upgrade.get("path")
        if not tool:
            # Une entrée partiellement éditée dans KingdomWeb ne doit pas faire
            # tomber toute la supervision ni les autres actions du bâtiment.
            continue
        effects = [{"type": "cost", "resource": "money", "amount": int(upgrade.get("price", 0))}]
        effects.extend({"type": "cost", "resource": item, "amount": int(amount)} for item, amount in upgrade.get("ingredients", {}).items())
        effects.append({
            "type": "upgrade", "tool": tool, "to_level": int(upgrade.get("to_level", 1)),
            "max_durability": int(upgrade.get("max_durability", 1)), "loot_bonus": int(upgrade.get("loot_bonus", 0)),
        })
        actions.append({
            "key": f"upgrade_{tool}_{upgrade.get('to_level', 1)}", "name": upgrade.get("name", f"Ameliorer {tool}"),
            "emoji": "⬆️", "enabled": True,
            "requirements": {"profession": "miner", "min_level": 1, "items": {tool: 1}, "tool": tool, "tool_level": int(upgrade.get("from_level", 1))},
            "effects": effects,
        })
    dice = modules.get("games", {}).get("dice", {})
    if dice:
        stake, sides = int(dice.get("stake", 0)), int(dice.get("sides", 6))
        for bet in dice.get("bets", []):
            winning = {int(face) for face in bet.get("winning_faces", [])}
            outcomes = [
                {"key": f"roll_{face}", "weight": 1, "rewards": {"money": stake * int(bet.get("multiplier", 1))} if face in winning else {}}
                for face in range(1, sides + 1)
            ]
            actions.append({"key": f"dice_{bet['key']}", "name": bet.get("name", bet["key"]), "emoji": "🎲", "enabled": True, "effects": [
                {"type": "cost", "resource": "money", "amount": stake}, {"type": "random_bundle", "outcomes": outcomes},
            ]})
    return actions


def _append_timed(actions: list[dict[str, Any]], action: dict[str, Any], immediate: list[dict[str, Any]], deferred: list[dict[str, Any]]) -> None:
    duration = int(action.get("duration_seconds", 0))
    if duration <= 0:
        actions.append({**action, "effects": [*immediate, *deferred]})
        return
    actions.append({
        **action,
        "effects": [*immediate, {"type": "schedule", "action": action["key"], "duration_seconds": duration, "effects": deferred}],
    })
    actions.append({
        "key": f"claim_{action['key']}"[:64], "name": f"Recuperer : {action['name']}", "emoji": "✅",
        "enabled": action.get("enabled", True), "effects": [{"type": "claim_scheduled", "action": action["key"]}],
    })


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _building_key(label: str) -> str:
    if "tavern" in label: return "tavern"
    if "mine" in label: return "mine"
    if "forge" in label: return "forge"
    if "bucheron" in label or "foret" in label or "forêt" in label: return "forest"
    return "village_square"
