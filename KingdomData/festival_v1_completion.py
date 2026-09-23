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
    settings["workshop_content_revision"] = 4
    settings["v1_content_aliases"] = deepcopy(ALIASES)
    settings["onboarding"]["currency_label"] = "deniers"

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
    _add_prompt_forge_catalogue(definitions, entities)
    _add_balance_draft_mining(definitions, entities)
    _set_historical_tavern_welcome(entities)
    tavern = entities["building", "edgar_tavern"]
    _merge(tavern["actions"], actions_from_modules("edgar_tavern", tavern["modules"]))
    _bridge_quest(entities["building", "festival_esplanade"], _remap(source["buildings"]["royal_bridge"]["construction"]))


def _add_prompt_forge_catalogue(definitions, entities):
    """Déclare le catalogue du prompt avec paiement atomique en ressources joueur."""
    from import_v1 import actions_from_modules

    forge = entities["building", "royal_forge"]
    forge.update(name="La Forge du Dragon Noir", description="Catalogue du Maître Forgeron : paiement en minerais, lingots et gemmes.")
    # Les anciens tarifs monétaires restent dans les données comme historique,
    # mais aucun achat actif de la Forge ne doit débiter la monnaie du joueur.
    for product in forge["modules"].setdefault("products", []):
        if not product.get("costs"):
            product["active"] = False
    entries = [
        ("short_sword_bronze", "Épée courte du novice", "Arme légère en bronze.", "⚔️", {"bronze_ingot":4}, 1, "armes"),
        ("long_sword_iron", "Épée longue du chevalier", "Lame de fer forgée pour la garde.", "🗡️", {"iron_ingot":6}, 1, "armes"),
        ("war_axe_iron_silver", "Hache de guerre des montagnes", "Hache de guerre en fer et argent.", "🪓", {"iron_ingot":5,"silver_ingot":2}, 1, "armes"),
        ("war_hammer_iron", "Marteau de guerre du colosse", "Marteau massif en fer.", "🔨", {"iron_ingot":7}, 1, "armes"),
        ("assassin_dagger_silver", "Dague d'assassin", "Dague discrète en argent.", "🗡️", {"silver_ingot":4}, 1, "armes"),
        ("dragon_blade", "Lame du Dragon", "Épée légendaire en or sertie d'un diamant.", "🐉", {"gold_ingot":3,"diamond":1}, 1, "armes"),
        ("short_hunter_bow", "Arc court du chasseur", "Arc court en bronze.", "🏹", {"bronze_ingot":5}, 1, "armes"),
        ("long_elf_bow", "Arc long des elfes", "Arc long renforcé de fer et d'argent.", "🏹", {"iron_ingot":6,"silver_ingot":2}, 1, "armes"),
        ("war_crossbow", "Arbalète de guerre", "Arbalète robuste en fer.", "🏹", {"iron_ingot":8}, 1, "armes"),
        ("precision_crossbow", "Arbalète de précision", "Arbalète équilibrée en argent et or.", "🏹", {"silver_ingot":4,"gold_ingot":1}, 1, "armes"),
        ("iron_arrows_20", "Flèches en fer · lot de 20", "Vingt flèches à pointe de fer.", "🏹", {"iron_ingot":2}, 20, "projectiles"),
        ("broadhead_arrows_12", "Flèches à tête large · lot de 12", "Douze flèches de chasse.", "🏹", {"iron_ingot":3}, 12, "projectiles"),
        ("crossbow_bolts_15", "Carreaux · lot de 15", "Quinze carreaux pour arbalète.", "➶", {"iron_ingot":3}, 15, "projectiles"),
        ("piercing_bolts_10", "Carreaux perforants · lot de 10", "Dix carreaux renforcés à l'argent.", "➶", {"silver_ingot":2}, 10, "projectiles"),
        ("reinforced_leather_cuirass", "Cuirasse de cuir renforcé", "Armure de cuir renforcée au bronze.", "🛡️", {"bronze_ingot":5}, 1, "armures"),
        ("soldier_chainmail", "Cotte de mailles du soldat", "Cotte de mailles en fer.", "🛡️", {"iron_ingot":8}, 1, "armures"),
        ("knight_plate_armor", "Armure de plates du chevalier", "Armure en fer et argent.", "🛡️", {"iron_ingot":10,"silver_ingot":3}, 1, "armures"),
        ("closed_visor_helm", "Heaume à visage fermé", "Heaume de protection en fer.", "🪖", {"iron_ingot":4}, 1, "armures"),
        ("dragon_king_armor", "Armure royale du Roi-Dragon", "Armure d'apparat sertie de gemmes.", "🛡️", {"gold_ingot":5,"diamond":2}, 1, "armures"),
        ("round_wood_iron_shield", "Bouclier rond bois et fer", "Bouclier renforcé au fer.", "🛡️", {"iron_ingot":3}, 1, "accessoires"),
        ("heraldic_silver_shield", "Bouclier héraldique gravé", "Bouclier décoré d'argent.", "🛡️", {"silver_ingot":2}, 1, "accessoires"),
        ("combat_gauntlets", "Gantelets de combat", "Gantelets forgés en fer.", "🧤", {"iron_ingot":3}, 1, "accessoires"),
        ("knight_spurs", "Éperons de chevalier", "Éperons en argent.", "🐎", {"silver_ingot":1}, 1, "accessoires"),
        ("leather_quiver", "Carquois en cuir", "Carquois renforcé au bronze.", "🎒", {"bronze_ingot":2}, 1, "accessoires"),
    ]
    new_items = {
        "bronze_ore": ("Minerai de bronze", "⛏️", "raw_metal", 999),
        "silver_ore": ("Minerai d'argent", "⛏️", "raw_metal", 999),
        "gold_ore": ("Minerai d'or", "⛏️", "raw_metal", 999),
        "bronze_ingot": ("Lingot de bronze", "🟤", "metal", 999),
        "silver_ingot": ("Lingot d'argent", "🥈", "metal", 999),
        "gold_ingot": ("Lingot d'or", "🥇", "metal", 999),
        "diamond": ("Diamant", "💎", "gem", 99),
    }
    for key, (name, emoji, category, limit) in new_items.items():
        if ("item", key) not in entities:
            payload = {"name":name,"emoji":emoji,"description":f"Ressource de la chaîne minière et métallurgique. {BALANCE}",
                       "category":category,"stack_limit":limit,"balance_status":BALANCE}
            definitions.append({"type":"item","key":key,"payload":payload})
            entities["item", key] = payload

    products, pages = [], {}
    for key, name, description, emoji, costs, quantity, category in entries:
        if ("item", key) not in entities:
            payload = {"name":name,"emoji":emoji,"description":description,"category":"equipment" if quantity == 1 else "ammunition",
                       "stack_limit":max(quantity, 99),"balance_status":BALANCE}
            definitions.append({"type":"item","key":key,"payload":payload})
            entities["item", key] = payload
        product = {"item_key":key,"name":name,"emoji":emoji,"description":description,"category":category,
                   "price":0,"currency":"money","costs":deepcopy(costs),"initial_stock":999,
                   "maximum_per_purchase":99,"active":True,"balance_status":BALANCE}
        products.append(product)
        pages.setdefault(category, []).append(key)
    _merge(forge["modules"].setdefault("products", []), products, "item_key")
    _merge(forge["actions"], actions_from_modules("royal_forge", {"products":products}))

    # Les lingots sont des recettes de joueur : minerais apportés au forgeron,
    # ressources prélevées atomiquement et production récupérée par timer V2.
    recipes = []
    for key, ore, coal, duration in [
        ("prompt_smelt_iron_ingot", "iron_ore", 1, 35),
        ("smelt_bronze_ingot", "bronze_ore", 1, 35),
        ("smelt_silver_ingot", "silver_ore", 2, 55),
        ("smelt_gold_ingot", "gold_ore", 3, 75),
    ]:
        output_key = "iron_ingot" if key == "prompt_smelt_iron_ingot" else key.removeprefix("smelt_")
        recipes.append({"key":key,"name":f"Fondre : {entities['item', output_key]['name']}",
                        "profession":"blacksmith","required_level":1,"duration_seconds":duration,"energy_cost":5,
                        "ingredients":{ore:3,"festival_coal":coal},"output_item_key":output_key,
                        "output_quantity":1,"ingredient_source":"player_inventory","output_destination":"player",
                        "experience":15,"balance_status":BALANCE})
    _merge(forge["modules"].setdefault("recipes", []), recipes)
    recipe_actions = actions_from_modules("royal_forge", {"recipes":recipes})
    _merge(forge["actions"], recipe_actions)
    _home_link(forge, "dragon_black_catalogue", "⚔️ Catalogue du Dragon Noir")
    for category, item_keys in pages.items():
        _page(forge, f"dragon_black_{category}", f"Catalogue · {category.capitalize()}", [
            {"id":f"select_dragon_black_{category}","type":"dynamic_product_selector",
             "props":{"item_keys":item_keys,"placeholder":"Choisir une pièce et payer en minerais…"}},
        ], "dragon_black_catalogue")
    _page(forge, "dragon_black_catalogue", "Catalogue du Dragon Noir", [
        _nav(f"nav_dragon_black_{category}", category.capitalize(), f"dragon_black_{category}") for category in pages
    ])
    _home_link(forge, "dragon_black_recipes", "🔥 Fondre les lingots")
    recipe_components = []
    for action in recipe_actions:
        button = _button(forge, "royal_forge", action)
        button["visible_when"] = {"pending_action": action["key"][6:]} if action["key"].startswith("claim_") else {"profession": "blacksmith"}
        recipe_components.append(button)
    _page(forge, "dragon_black_recipes", "Fondre les lingots", recipe_components)


def _add_balance_draft_mining(definitions, entities):
    """Ajoute les ressources minières absentes de la source V1 en mode à valider."""
    from import_v1 import actions_from_modules

    mine = entities["building", "deep_mine"]
    additions = []
    for key, name, level, duration, energy, yield_min, yield_max, xp in [
        ("bronze_vein", "Filon de bronze", 1, 45, 15, 2, 4, 20),
        ("silver_vein", "Filon d'argent", 4, 75, 25, 1, 3, 35),
        ("gold_vein", "Filon d'or", 7, 120, 35, 1, 2, 50),
        ("diamond_cavern", "Géode de diamant", 10, 180, 45, 1, 1, 70),
    ]:
        if any(row.get("key") == key for row in mine["modules"].setdefault("activities", [])):
            continue
        resource = {"bronze_vein":"bronze_ore","silver_vein":"silver_ore","gold_vein":"gold_ore","diamond_cavern":"diamond"}[key]
        additions.append({"key":key,"name":name,"emoji":"⛏️","description":BALANCE,"profession":"miner",
                          "required_level":level,"duration_seconds":duration,"energy_cost":energy,
                          "durability_cost":2,"tool":"iron_pickaxe","tool_max_durability":100,
                          "experience":xp,"balance_status":BALANCE,
                          "outcomes":[{"key":resource,"weight":100,"rewards":{resource:[yield_min,yield_max]}}]})
    mine["modules"]["activities"].extend(additions)
    actions = actions_from_modules("deep_mine", {"activities":additions})
    _merge(mine["actions"], actions)
    if actions:
        _home_link(mine, "balance_metal_galleries", "⛏️ Métaux précieux · à valider")
        components = [_button(mine, "deep_mine", action) for action in actions]
        _page(mine, "balance_metal_galleries", "Galeries des métaux · BALANCE_DRAFT / À VALIDER", components)


def _set_historical_tavern_welcome(entities):
    tavern = entities["building", "edgar_tavern"]
    tavern.update(name="À la Gueuse Cocu", description="Menu de la Taverne Médiévale – Année de Grâce 1426 (et quelques). Bienvenue, noble voyageur !")
    npc = tavern["modules"].get("npc", {})
    welcome = "Bienvenue, noble voyageur ! Ici, on trinque à la santé des rois, des dragons et des bardeaux bien remplis. Que ton gosier soit assoiffé et ton estomac vaillant !"
    phrases = list(npc.get("phrases", []))
    if welcome not in phrases:
        npc["phrases"] = [welcome, *phrases]
    from import_v1 import actions_from_modules
    _merge(tavern["actions"], actions_from_modules("edgar_tavern", {"npc":npc}), replace=True)


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
