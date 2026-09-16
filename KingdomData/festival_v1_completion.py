"""Réconciliation du contenu V1 dans le modèle Fête du Royaume existant.

Ce module compose uniquement des données no-code. Le snapshot livré ne contient
ni base de joueurs, ni secret, ni référence au répertoire d'installation V1.
"""

from copy import deepcopy
import json
from pathlib import Path

from .festival_workshops import _button, _nav
from .royal_festival_content import BALANCE


ITEM_ALIASES = {
    "wood": "oak_timber", "coal": "festival_coal", "raw_stone": "stone_block",
    "iron": "iron_ore", "simple_pickaxe": "iron_pickaxe", "herbs": "medicinal_herb",
    "bread": "festival_bread", "cheese": "cheese_wheel", "biere_royaume": "royal_ale",
    "hydromel": "festival_mead", "traveler_sword": "iron_sword", "luxuriant_shield": "oak_shield",
}
BUILDINGS = {"tavern": "edgar_tavern", "forge": "royal_forge", "mine": "deep_mine", "forest": "forester_lodge"}
ALIASES = {**ITEM_ALIASES, **BUILDINGS, "cook": "innkeeper", "woodcutter": "forester"}


def _remap(value):
    if isinstance(value, dict):
        return {ALIASES.get(key, key): _remap(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_remap(item) for item in value]
    return ALIASES.get(value, value) if isinstance(value, str) else value


def _merge(rows, additions, key="key", replace=False):
    """Une seule entrée par identité, même si la composition est rappelée."""
    index = {row[key]: row for row in rows}
    for entry in additions:
        identity = entry[key]
        if identity not in index:
            rows.append(deepcopy(entry))
            index[identity] = rows[-1]
        elif replace:
            index[identity].update(deepcopy(entry))


def _page(building, key, title, components, parent="home"):
    pages = building["interface"]["pages"]
    components = deepcopy(components)
    for component in components:
        component["id"] = f"{key}_{component['id']}"[:64]
    entry = {"key": key, "name": title, "components": [
        {"id": f"title_{key}", "type": "hero", "props": {"title": title}},
        *components, _nav(f"back_{key}", "⬅️ Retour", parent),
        {"id": f"exit_{key}", "type": "button", "props": {"label": "Quitter"}, "interaction": {"type": "close"}},
    ]}
    _merge(pages, [entry], replace=True)


def _home_link(building, key, title):
    home = next(p for p in building["interface"]["pages"] if p["key"] == building["interface"].get("start_page", "home"))
    _merge(home["components"], [_nav(f"nav_{key}", title, key)], key="id")


def complete_v1_catalogue(definitions):
    from import_v1 import actions_from_modules

    source = json.loads(Path(__file__).with_name("festival_v1_catalogue.json").read_text(encoding="utf-8"))
    entities = {(row["type"], row["key"]): row["payload"] for row in definitions}
    settings = entities["server_settings", "kingdom_server"]
    settings["workshop_content_revision"] = 3
    settings["v1_content_aliases"] = deepcopy(ALIASES)

    for row in source["items"]:
        key = ITEM_ALIASES.get(row["key"], row["key"])
        if ("item", key) not in entities:
            payload = deepcopy(row["payload"])
            # Une seule énergie : les effets player_stat réutilisent players.energy.
            if payload.get("consumable") and not payload.get("consumption"):
                payload["consumption"] = {"effects": [{"type": "reward", "resource": "energy", "amount": 20}]}
            definitions.append({"type": "item", "key": key, "payload": payload})
            entities["item", key] = payload

    for old_key, building_key in BUILDINGS.items():
        building = entities["building", building_key]
        modules = building["modules"]
        legacy = _remap(source["buildings"][old_key])
        # Les produits existants gardent leurs prix V2 ; les nouveaux gardent
        # prix, stock initial et limites d'achat V1.
        products = legacy.get("products", [])
        for product in products:
            product["name"] = entities["item", product["item_key"]]["name"]
        _merge(modules.setdefault("products", []), products, "item_key")

        recipes = []
        for recipe in legacy.get("recipes", []):
            recipe = deepcopy(recipe)
            if old_key == "forge":
                # Deux méthodes distinctes : minerai brut V1 / lingots V2.
                recipe["key"] = f"forge_{recipe['output_item_key']}_from_ore"
                recipe["name"] = f"{recipe.get('name', recipe['key'])} (minerai brut)"
            recipe["category"] = "v1_kitchen" if old_key == "tavern" else "v1_forge"
            recipe["ingredient_source"] = recipe["output_destination"] = "building_stock"
            recipe["conditions"] = {"type": "profession_active", "profession": recipe["profession"]}
            recipe["shared_mission"] = old_key == "tavern"
            recipes.append(recipe)
        _merge(modules.setdefault("recipes", []), recipes)

        # Le tarif explicite du marché universel V1 est prioritaire pour ces
        # ressources ; les autres livraisons du scénario restent inchangées.
        deliveries = [{"item_key": row["item_key"], "name": entities["item", row["item_key"]]["name"],
                       "target_building_key": building_key, "unit_price": row["unit_price"], "minimum_quantity": 1}
                      for row in legacy.get("market_purchases", [])]
        ingredient_keys = {key for recipe in recipes for key in recipe.get("ingredients", {})}
        for key in sorted(ingredient_keys - {row["item_key"] for row in deliveries}):
            deliveries.append({"item_key": key, "name": entities["item", key]["name"],
                               "target_building_key": building_key, "unit_price": entities["item", key].get("price", 1), "minimum_quantity": 1})
        _merge(modules.setdefault("deliveries", []), deliveries, "item_key", replace=True)

        if old_key == "forge":
            repairs = modules.setdefault("repairs", {})
            # Ne pas réduire la durabilité d'outils V2 déjà plus résistants.
            for tool, maximum in legacy["repairs"]["durability"].items():
                repairs.setdefault("durability", {}).setdefault(tool, maximum)
                repairs.setdefault("item_names", {})[tool] = entities["item", tool]["name"]
            upgrades = legacy.get("upgrades", [])
            for upgrade in upgrades:
                upgrade["key"] = f"upgrade_{upgrade['tool_key']}_{upgrade['to_level']}"
                # La pioche V2 possède 100 points ; ne pas la dégrader à 40.
                upgrade["max_durability"] = max(upgrade["max_durability"], repairs["durability"].get(upgrade["tool_key"], 1))
                upgrade["profession"] = "miner"
                upgrade["balance_status"] = BALANCE
            _merge(modules.setdefault("upgrades", []), upgrades)

        # Generated pour les ateliers, manuel pour les actions de scénario :
        # fusionner uniquement les nouvelles capacités, sans perdre leurs effets.
        compiled = actions_from_modules(building_key, modules)
        _merge(building["actions"], compiled)
        _catalogue_pages(building_key, building, products, recipes)
        if deliveries:
            _home_link(building, "v1_deliveries", "📦 Livrer des ressources")
            _page(building, "v1_deliveries", "Livraison au stock du bâtiment", [
                {"id": "v1_delivery_selector", "type": "dynamic_inventory_selector", "props": {"building": building_key}},
            ])

    _renewable_supplies(entities)
    _hunter_reconciliation(entities)
    _forge_services(entities["building", "royal_forge"])
    tavern = entities["building", "edgar_tavern"]
    _merge(tavern["actions"], actions_from_modules("edgar_tavern", tavern["modules"]))
    _bridge_quest(entities["building", "festival_esplanade"], _remap(source["buildings"]["royal_bridge"]["construction"]))


def _bridge_quest(building, project):
    """Le chantier V1 devient une quête collective à l'esplanade existante."""
    building["modules"]["construction"] = deepcopy(project)
    _home_link(building, "bridge_quest", "🌉 Reconstruire le pont")
    branches, prerequisites = [], []
    for stage in project["stages"]:
        page_key = f"bridge_{stage['key']}"
        objective = f"royal_bridge_{stage['key']}"
        next(s for s in building["modules"]["construction"]["stages"] if s["key"] == stage["key"])["objective_key"] = objective
        branches.append(_nav(f"nav_{page_key}", stage["name"], page_key))
        components = []
        for requirement in stage["requirements"]:
            progress = {"type": "collective_progress", "objective": objective,
                        "resource": requirement["key"], "value": requirement["quantity"]}
            resources = requirement.get("accepted_items") or ["money"]
            for resource in resources:
                for quantity in sorted({1, min(10, requirement["quantity"])}):
                    key = f"bridge_{stage['key']}_{resource}_{quantity}"
                    action = {"key": key, "name": f"{requirement['name']} ×{quantity} ({resource})", "enabled": True,
                              "conditions": {"all": [*deepcopy(prerequisites), {**progress, "operator": "<=", "value": requirement["quantity"] - quantity}]},
                              "effects": [{"type": "cost", "resource": resource, "amount": quantity},
                                          {"type": "contribution", "objective": objective, "resource": requirement["key"], "amount": quantity},
                                          {"type": "message", "text": f"Merci pour votre contribution : {stage['name']}."}]}
                    _merge(building["actions"], [action])
                    components.append(_button(building, "festival_esplanade", action))
        _page(building, page_key, stage["name"], components, "bridge_quest")
        prerequisites.extend({"type": "collective_progress", "objective": objective, "resource": r["key"], "operator": ">=", "value": r["quantity"]} for r in stage["requirements"])
    _page(building, "bridge_quest", project["name"], branches)


def _catalogue_pages(key, building, products, recipes):
    """Sous-menus bornés, pas de sélection Discord dépassant 25 options."""
    if products:
        _home_link(building, "v1_counter", "🛒 Comptoir et spécialités")
        categories = {}
        for product in products:
            categories.setdefault(product.get("category", "equipment"), []).append(product["item_key"])
        labels = {"bieres": "Bières", "spiritueux": "Hydromels et spiritueux", "vins": "Vins", "nourriture": "À manger", "equipment": "Armes et équipements"}
        branches = []
        for category, keys in categories.items():
            target = f"v1_shop_{category}"
            branches.append(_nav(f"nav_{target}", labels.get(category, category), target))
            components = [{"id": f"buy_{target}", "type": "dynamic_product_selector", "props": {"item_keys": keys}}]
            if key == "edgar_tavern":
                components.append({"id": f"consume_{target}", "type": "dynamic_consumable_selector", "props": {"item_keys": keys}})
            _page(building, target, labels.get(category, category), components, "v1_counter")
        _page(building, "v1_counter", "Comptoir et spécialités", branches)
    if recipes:
        actions = {a["key"]: a for a in building["actions"]}
        profession = recipes[0]["profession"]
        _home_link(building, "v1_recipes", "📜 Recettes traditionnelles")
        components = []
        for recipe in recipes:
            button = _button(building, key, actions[recipe["key"]])
            button["visible_when"] = {"profession": profession}
            components.append(button)
            claim = _button(building, key, actions[f"claim_{recipe['key']}"])
            claim["visible_when"] = {"pending_action": recipe["key"]}
            components.append(claim)
        _page(building, "v1_recipes", "Recettes traditionnelles", components)


def _renewable_supplies(entities):
    """Les stocks de départ ne sont pas l'unique source des ingrédients."""
    farm = entities["building", "festival_farm"]
    additions = []
    for item, label in [("onion", "Récolter les oignons"), ("poultry", "Préparer les volailles"), ("cheese_wheel", "Affiner les fromages")]:
        additions.append({"key": f"gather_{item}", "name": label, "enabled": True,
                          "conditions": {"type": "profession_active", "profession": "farmer"},
                          "cooldown_seconds": 20, "balance_status": BALANCE,
                          "effects": [{"type": "cost", "resource": "energy", "amount": 5}, {"type": "reward", "resource": item, "amount": 4}]})
    _merge(farm["actions"], additions)
    _home_link(farm, "v1_supplies", "🌾 Ingrédients traditionnels")
    _page(farm, "v1_supplies", "Production fermière", [_button(farm, "festival_farm", a) for a in additions])
    # Pain noir fabriqué dans le stock cuisine, puis vendu/consommé ou réutilisé.
    from import_v1 import actions_from_modules
    tavern = entities["building", "edgar_tavern"]
    recipe = {"key": "bake_dark_bread", "name": "Cuire le pain noir", "profession": "innkeeper", "category": "bread",
              "ingredients": {"flour_sack": 2, "water": 1}, "output_item_key": "dark_bread", "output_quantity": 4,
              "duration_seconds": 30, "energy_cost": 5, "experience": 15,
              "ingredient_source": "building_stock", "output_destination": "building_stock", "balance_status": BALANCE}
    _merge(tavern["modules"]["recipes"], [recipe])
    _merge(tavern["modules"]["products"], [{"item_key": "dark_bread", "name": "Pain noir", "price": 2, "initial_stock": 20, "category": "bread"}], "item_key")
    _merge(tavern["actions"], actions_from_modules("edgar_tavern", {"recipes": [recipe]}))
    page = next(p for p in tavern["interface"]["pages"] if p["key"] == "kitchen_bread")
    for action in actions_from_modules("edgar_tavern", {"recipes": [recipe]}):
        button = _button(tavern, "edgar_tavern", action)
        button["visible_when"] = {"pending_action": recipe["key"]} if action["key"].startswith("claim_") else {"profession": "innkeeper"}
        _merge(page["components"], [button], "id")
    for page in tavern["interface"]["pages"]:
        if page["key"] == "eat_bread":
            for component in page["components"]:
                keys = component.get("props", {}).get("item_keys")
                if keys is not None and "dark_bread" not in keys:
                    keys.append("dark_bread")


def _hunter_reconciliation(entities):
    """Même identité d'action, mais métier/outils cohérents avec la chasse."""
    building = entities["building", "forester_lodge"]
    for rows in [building["actions"], building["modules"]["activities"]]:
        for index, row in enumerate(rows):
            if row["key"] == "hunt_game":
                def convert(value):
                    if isinstance(value, dict):
                        return {k: convert(v) for k, v in value.items()}
                    if isinstance(value, list):
                        return [convert(v) for v in value]
                    return {"forester": "hunter", "simple_axe": "curved_bow"}.get(value, value) if isinstance(value, str) else value
                rows[index] = convert(row)


def _forge_services(building):
    actions = {a["key"]: a for a in building["actions"]}
    components = []
    for key, action in actions.items():
        if key.startswith(("repair_", "upgrade_")):
            button = _button(building, "royal_forge", action)
            if key.startswith("upgrade_"):
                button["visible_when"] = {"profession": "miner"}
            components.append(button)
    _home_link(building, "v1_services", "🔧 Réparer et améliorer")
    _page(building, "v1_services", "Services de Wagner", components)
