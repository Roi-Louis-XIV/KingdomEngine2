"""Contenu et pages éditables des comptoirs de la Fête du Royaume.

Les actions sont compilées par le compilateur de modules existant ; aucune
règle de cuisine ou de forge n'est ajoutée au moteur d'exécution.
"""

from copy import deepcopy
import json
from pathlib import Path

from .royal_festival_content import BALANCE


def configure_workshops(definitions):
    from import_v1 import actions_from_modules

    entities = {(row["type"], row["key"]): row["payload"] for row in definitions}
    entities["server_settings", "kingdom_server"]["workshop_content_revision"] = 2

    def item(key, name, category, energy=0, price=6):
        payload = entities.get(("item", key))
        if payload is None:
            payload = {}
            definitions.append({"type": "item", "key": key, "payload": payload})
            entities["item", key] = payload
        payload.update(name=name, category=category, stack_limit=100,
                       description=f"{name} — {BALANCE}", balance_status=BALANCE,
                       price=price)
        if energy:
            payload.update(consumable=True, consumption={"effects": [
                {"type": "reward", "resource": "energy", "amount": energy},
                {"type": "message", "text": f"{{item}} : +{energy} énergie."},
            ]})
        return key

    # Le travail coûte 3 à 7 énergie : un repas couvre plusieurs activités.
    foods = [
        ("royal_ale", "Bière blonde", "beer", 12, 8),
        ("brown_ale", "Bière brune", "beer", 15, 10),
        ("strong_ale", "Bière forte", "beer", 18, 12),
        ("red_wine", "Vin rouge", "wine", 15, 10),
        ("white_wine", "Vin blanc", "wine", 15, 10),
        ("festival_mead", "Hydromel", "mead", 20, 12),
        ("water", "Eau", "soft", 3, 1),
        ("milk", "Lait", "soft", 10, 5),
        ("festival_bread", "Pain", "bread", 12, 6),
        ("peasant_soup", "Soupe paysanne", "meals", 20, 10),
        ("roast_meat", "Viande rôtie", "meats", 25, 12),
        ("meat_pie", "Tourte à la viande", "pies", 35, 16),
        ("vegetable_pie", "Tourte aux légumes", "pies", 30, 14),
        ("festival_meal", "Repas du Royaume", "meals", 45, 22),
    ]
    for args in foods:
        item(*args)
    for key, name in [("hops", "Houblon"), ("honey", "Miel"),
                      ("egg", "Œuf"), ("red_grapes", "Raisin rouge"),
                      ("white_grapes", "Raisin blanc")]:
        item(key, name, "ingredient", price=2)
    item("hunting_knife", "Couteau de chasse", "hunting_tools", price=16)

    # Sources renouvelables : récolte dans le sac, puis livraison volontaire.
    farm = entities["building", "festival_farm"]
    for key, name, quantity in [
        ("water", "Puiser de l'eau", 6), ("milk", "Traire les vaches", 4),
        ("egg", "Ramasser les œufs", 4), ("hops", "Récolter le houblon", 4),
        ("honey", "Récolter le miel des ruches", 4),
        ("red_grapes", "Vendanger le raisin rouge", 4),
        ("white_grapes", "Vendanger le raisin blanc", 4),
    ]:
        action_key = f"gather_{key}"
        action = {"key": action_key, "name": name, "emoji": "🌾",
                  "cooldown_seconds": 10, "effects": [
                      {"type": "cost", "resource": "energy", "amount": 3},
                      {"type": "reward", "resource": key, "amount": quantity},
                  ]}
        if key != "water":
            action["conditions"] = {"type": "profession_active", "profession": "farmer"}
        farm["actions"].append(action)
    # Ajouter une page de récoltes à l'interface existante, sans la remplacer.
    harvest_actions = farm["actions"][-7:]
    harvest_page = {"key": "supplies", "name": "Ressources de cuisine", "components": [
        _button(farm, "festival_farm", action) for action in harvest_actions
    ] + [_nav("supplies_back", "Retour", "home")]}
    farm["interface"]["pages"].append(harvest_page)
    farm["interface"]["pages"][0]["components"].append(_nav("supplies_nav", "Ressources de cuisine", "supplies"))

    tavern = entities["building", "edgar_tavern"]
    forge = entities["building", "royal_forge"]
    forge["name"] = "Forge Dorée"
    entities["profession", "innkeeper"]["name"] = "Cuisinier"
    for profession in tavern["modules"].get("professions", []):
        if profession["key"] == "innkeeper":
            profession["name"] = "Cuisinier"

    def recipe(key, name, category, ingredients, output, quantity, profession, energy=4):
        return {"key": key, "name": name, "category": category,
                "ingredients": ingredients, "output_item_key": output,
                "output_quantity": quantity, "profession": profession,
                "required_level": 1, "duration_seconds": 10, "energy_cost": energy,
                "experience": 10, "ingredient_source": "building_stock",
                "output_destination": "building_stock", "balance_status": BALANCE}

    cooking = [
        ("bake_festival_bread", "Pain", "bread", {"flour_sack": 2, "water": 1}, "festival_bread", 2),
        ("cook_soup", "Soupe paysanne", "meals", {"festival_vegetables": 2, "water": 1}, "peasant_soup", 2),
        ("roast_game", "Viande rôtie", "meats", {"game_meat": 2}, "roast_meat", 2),
        ("bake_meat_pie", "Tourte à la viande", "pies", {"flour_sack": 2, "game_meat": 2, "egg": 1}, "meat_pie", 2),
        ("bake_vegetable_pie", "Tourte aux légumes", "pies", {"flour_sack": 2, "festival_vegetables": 2, "egg": 1}, "vegetable_pie", 2),
        ("cook_festival_meal", "Repas du Royaume", "meals", {"festival_bread": 1, "roast_meat": 1, "festival_vegetables": 1}, "festival_meal", 1),
        ("brew_blonde", "Bière blonde", "drinks", {"hops": 1, "water": 1}, "royal_ale", 2),
        ("brew_brown", "Bière brune", "drinks", {"hops": 2, "water": 1}, "brown_ale", 2),
        ("brew_strong", "Bière forte", "drinks", {"hops": 3, "water": 1}, "strong_ale", 2),
        ("brew_festival_mead", "Hydromel", "drinks", {"honey": 2, "water": 1}, "festival_mead", 2),
        ("press_red_wine", "Vin rouge", "drinks", {"red_grapes": 2}, "red_wine", 2),
        ("press_white_wine", "Vin blanc", "drinks", {"white_grapes": 2}, "white_wine", 2),
        ("brew_festival_drinks", "Caisse pour la fête", "drinks", {"royal_ale": 2}, "festival_drink_crate", 2),
    ]
    tavern["modules"]["recipes"] = [recipe(*row, "innkeeper") for row in cooking]
    tavern["modules"]["products"] = [
        {"item_key": key, "name": name, "category": category, "price": price,
         "initial_stock": 4, "active": True} for key, name, category, _, price in foods
    ]
    tavern["modules"]["products"].append({"item_key": "festival_drink_crate", "name": "Caisse de boissons", "price": 12, "initial_stock": 0})
    forging = [
        ("smelt_festival_iron", "Lingot de fer", "iron", {"iron_ore": 2, "festival_coal": 1}, "iron_ingot", 1),
        ("forge_pickaxe", "Pioche", "harvest_tools", {"iron_ingot": 2, "oak_timber": 1}, "iron_pickaxe", 1),
        ("forge_axe", "Hache", "harvest_tools", {"iron_ingot": 2, "oak_timber": 1}, "simple_axe", 1),
        ("forge_hammer", "Marteau", "craft_tools", {"iron_ingot": 2, "oak_timber": 1}, "smith_hammer", 1),
        ("forge_knife", "Couteau de chasse", "hunting_tools", {"iron_ingot": 1, "oak_timber": 1}, "hunting_knife", 1),
        ("forge_festival_brazier", "Brasero", "festival", {"iron_ingot": 3, "oak_timber": 1}, "festival_brazier", 1),
        ("forge_support_beam", "Étai", "festival", {"iron_ingot": 1, "oak_timber": 2}, "support_beam", 1),
    ]
    forge["modules"]["recipes"] = [recipe(*row, "blacksmith", energy=5) for row in forging]
    tools = {"iron_pickaxe": "harvest_tools", "simple_axe": "harvest_tools",
             "smith_hammer": "craft_tools", "hunting_knife": "hunting_tools"}
    forge["modules"]["repairs"] = {"durability": {key: 100 for key in tools},
        "item_names": {key: entities["item", key]["name"] for key in tools}, "equipment_price_per_point": 1}
    forge["modules"]["products"] = [
        {"item_key": key, "name": entities["item", key]["name"], "category": cat,
         "price": {"iron_pickaxe": 22, "simple_axe": 18, "smith_hammer": 24, "hunting_knife": 16}[key], "initial_stock": 4}
        for key, cat in tools.items()
    ] + [{"item_key": key, "name": entities["item", key]["name"], "price": 8, "initial_stock": 0}
         for key in ("iron_ingot", "festival_brazier", "support_beam")]

    for building_key, building in [("edgar_tavern", tavern), ("royal_forge", forge)]:
        modules = building["modules"]
        ingredients = {key for entry in modules["recipes"] for key in entry["ingredients"]}
        if building_key == "edgar_tavern":
            ingredients.update({"milk", "festival_provision"})
        modules["deliveries"] = [{"item_key": key, "name": entities["item", key]["name"],
                                  "target_building_key": building_key, "unit_price": 2,
                                  "minimum_quantity": 1} for key in sorted(ingredients)]
        # Conserver les métiers et dialogues ; compiler une seule version des recettes.
        modules["activities"] = []
        for profession in modules["professions"]:
            profession["max_durability"] = 100
            profession["initial_durability"] = 100
        building["action_mode"] = "generated"
        building["interface_blueprint"] = "custom"
        if building_key == "edgar_tavern":
            # Copie éditable dans chaque monde, sans dépendance vers la V1.
            social = json.loads(Path(__file__).with_name("festival_v1_social.json").read_text(encoding="utf-8"))
            modules.update(social)
        building["actions"] = actions_from_modules(building_key, modules)
        for action in building["actions"]:
            if action["key"].startswith("repair_"):
                tool = action["key"][7:]
                action["conditions"] = {"all": [
                    {"type": "item_present", "item": tool},
                    {"type": "tool_present", "tool": tool},
                    {"type": "tool_durability", "tool": tool, "operator": "<", "value": 100},
                ]}
        building["interface"] = _workshop_pages(building_key, building, foods, tools)

    _configure_mine_galleries(entities["building", "deep_mine"])
    _configure_forest_expeditions(definitions, entities)
    dialogues = json.loads(Path(__file__).with_name("festival_v1_dialogues.json").read_text(encoding="utf-8"))
    for building_key, npc_key in [("edgar_tavern", "edgar"), ("royal_forge", "wagner"),
                                  ("deep_mine", "roland"), ("forester_lodge", "sylvain")]:
        building = entities["building", building_key]
        npc = deepcopy(dialogues[building_key])
        npc["key"] = npc_key
        if not npc["phrases"]:
            npc["phrases"] = [entities["npc", npc_key]["reactions"][0]["variants"][0]["text"]]
        building["modules"]["npc"] = npc
        talk = actions_from_modules(building_key, {"npc": npc})[0]
        building["actions"].append(talk)
        home = next(p for p in building["interface"]["pages"] if p["key"] == building["interface"].get("start_page", "home"))
        button = _button(building, building_key, talk)
        button["props"]["label"] = f"Discuter avec {entities['npc', npc_key]['name']}"
        home["components"].append(button)


def _configure_forest_expeditions(definitions, entities):
    """Zones V1 réconciliées avec les ressources et identités du scénario."""
    from import_v1 import actions_from_modules

    for key, name, price in [("curved_bow", "Arc courbé", 55),
                             ("fine_wood", "Bois de qualité", 7),
                             ("wild_boar_meat", "Viande de sanglier", 6)]:
        if ("item", key) not in entities:
            payload = {"name": name, "price": price, "category": "equipment" if key == "curved_bow" else "resources",
                       "stack_limit": 1 if key == "curved_bow" else 100, "description": "Ressource des expéditions de Sylvain."}
            definitions.append({"type": "item", "key": key, "payload": payload})
            entities["item", key] = payload
    hunter = {"key": "hunter", "name": "Chasseur", "required_item": "curved_bow",
              "grant_required_item": False, "max_durability": 90, "initial_durability": 90,
              "experience_per_level": 100}
    if ("profession", "hunter") not in entities:
        definitions.append({"type": "profession", "key": "hunter", "payload": {k: v for k, v in hunter.items() if k != "key"}})
    building = entities["building", "forester_lodge"]
    building["modules"]["professions"].append(hunter)
    activities = json.loads(Path(__file__).with_name("festival_v1_forest.json").read_text(encoding="utf-8"))
    building["modules"]["activities"].extend(activities)
    compiled = actions_from_modules("forester_lodge", {"professions": [hunter], "activities": activities})
    building["actions"].extend(compiled)
    pages = building["interface"]["pages"]
    home = next(p for p in pages if p["key"] == building["interface"].get("start_page", "home"))
    for profession, title in [("forester", "Zones de bûcheronnage"), ("hunter", "Chasse et métier Chasseur")]:
        page_key = f"zones_{profession}"
        home["components"].append(_nav(f"nav_{page_key}", title, page_key))
        keys = {a["key"] for a in activities if a["profession"] == profession}
        components = [{"id": f"title_{page_key}", "type": "hero", "props": {"title": title}},
                      _nav(f"back_{page_key}", "⬅️ Retour", home["key"])]
        for action in compiled:
            if action["key"] not in keys | {f"claim_{key}" for key in keys} | ({"join_hunter", "leave_hunter"} if profession == "hunter" else set()):
                continue
            button = _button(building, "forester_lodge", action)
            if action["key"].startswith("claim_"):
                button["visible_when"] = {"pending_action": action["key"][6:]}
            components.append(button)
        pages.append({"key": page_key, "name": title, "components": components})

    # L'arc est achetable et reproductible, pas un objet inaccessible.
    forge = entities["building", "royal_forge"]
    additions = {"products": [{"item_key": "curved_bow", "name": "Arc courbé", "price": 55, "initial_stock": 4}],
                 "recipes": [{"key": "craft_curved_bow", "name": "Fabriquer un arc courbé", "profession": "blacksmith",
                              "ingredients": {"fine_wood": 3, "iron_ingot": 1}, "output_item_key": "curved_bow",
                              "output_quantity": 1, "duration_seconds": 60, "energy_cost": 15,
                              "experience": 25, "ingredient_source": "building_stock", "output_destination": "building_stock",
                              "category": "hunting_tools", "balance_status": BALANCE}]}
    for field, rows in additions.items():
        forge["modules"][field].extend(rows)
    forge["modules"]["repairs"]["durability"]["curved_bow"] = 90
    additions["repairs"] = {"durability": {"curved_bow": 90}, "item_names": {"curved_bow": "Arc courbé"}, "equipment_price_per_point": 1}
    compiled = actions_from_modules("royal_forge", additions)
    forge["actions"].extend(compiled)
    # Débouchés explicites pour les ressources supplémentaires des expéditions.
    for destination, item_key, price in [("royal_forge", "fine_wood", 7),
                                          ("edgar_tavern", "wild_boar_meat", 6),
                                          ("edgar_tavern", "medicinal_herb", 2)]:
        target = entities["building", destination]
        target["modules"]["deliveries"].append({
            "item_key": item_key, "name": entities["item", item_key]["name"],
            "target_building_key": destination, "unit_price": price, "minimum_quantity": 1,
        })
    for page in forge["interface"]["pages"]:
        if page["key"] == "shop_hunting_tools":
            next(c for c in page["components"] if c["type"] == "dynamic_product_selector")["props"]["item_keys"].append("curved_bow")
        if page["key"] in {"craft_hunting_tools", "repairs"}:
            prefix = "repair_" if page["key"] == "repairs" else "craft_"
            for action in compiled:
                if action["key"].startswith(prefix) or (prefix == "craft_" and action["key"].startswith("claim_")):
                    button = _button(forge, "royal_forge", action)
                    if action["key"].startswith("claim_"):
                        button["visible_when"] = {"pending_action": action["key"][6:]}
                    page["components"].append(button)


def _configure_mine_galleries(building):
    """Enrichit la Mine existante sans remplacer ses actions de scénario."""
    from import_v1 import actions_from_modules

    activities = json.loads(Path(__file__).with_name("festival_v1_mine.json").read_text(encoding="utf-8"))
    modules = building["modules"]
    existing = {activity["key"] for activity in modules["activities"]}
    modules["activities"].extend(activity for activity in activities if activity["key"] not in existing)
    # Ne pas recompiler les actions du scénario : elles portent ses conditions
    # et ses effets particuliers, déjà configurés par le template.
    compiled = actions_from_modules("deep_mine", {"activities": activities})
    action_keys = {action["key"] for action in building["actions"]}
    building["actions"].extend(action for action in compiled if action["key"] not in action_keys)
    pages = building["interface"]["pages"]
    home = next(page for page in pages if page["key"] == building["interface"].get("start_page", "home"))
    home["components"].append(_nav("nav_galleries", "⛏️ Galeries de Roland", "galleries"))
    components = [{"id": "gallery_title", "type": "hero", "props": {
        "title": "Galeries de Roland",
        "subtitle": "Niveaux 1, 2 et 4 · 30, 60 et 90 secondes. Le butin rejoint votre sac après récupération.",
    }}, _nav("back_galleries", "⬅️ Retour", home["key"])]
    for action in compiled:
        button = _button(building, "deep_mine", action)
        if action["key"].startswith("claim_"):
            button["visible_when"] = {"pending_action": action["key"][6:]}
        components.append(button)
    pages.append({"key": "galleries", "name": "Galeries de Roland", "components": components})


def _nav(key, label, page, **extra):
    return {"id": key, "type": "button", "props": {"label": label},
            "interaction": {"type": "navigate", "page": page}, **extra}


def _button(building, building_key, action):
    result = {"id": f"act_{action['key']}", "type": "button",
            "props": {"label": action["name"], "emoji": action.get("emoji", "⚙️")},
            "interaction": {"type": "action", "building": building_key, "action": action["key"]}}
    if action.get("conditions"):
        result["visibility_conditions"] = deepcopy(action["conditions"])
    if action["key"].startswith("repair_"):
        result["props"]["durability_tool"] = action["key"][7:]
    return result


def _workshop_pages(key, building, foods, tools):
    """Pages no-code ordinaires : Action → Catégorie → sélection dynamique."""
    interface = deepcopy(building["interface"])
    pages = interface["pages"] = []
    actions = {a["key"]: a for a in building["actions"]}

    def page(page_key, name, parent="home"):
        components = [{"id": f"title_{page_key}", "type": "hero", "props": {"title": name}}]
        if page_key != "home":
            components.append(_nav(f"back_{page_key}", "⬅️ Retour", parent))
        pages.append({"key": page_key, "name": name, "components": components})
        return components

    home = page("home", building["name"])
    tavern = key == "edgar_tavern"
    profession = "innkeeper" if tavern else "blacksmith"
    categories = {"beer": "🍺 Bière", "wine": "🍷 Vin", "mead": "🍯 Hydromel", "soft": "💧 Sans alcool",
                  "bread": "🥖 Pain et produits simples", "meals": "🍲 Plats", "pies": "🥧 Tourtes", "meats": "🍖 Viandes",
                  "drinks": "🍺 Boissons", "iron": "⚙️ Fer", "harvest_tools": "⛏️ Outils de récolte",
                  "craft_tools": "🔨 Outils d’artisanat", "hunting_tools": "🗡️ Outils de chasse", "festival": "🔥 Installations"}
    branches = [("drink", "🍺 Boire", ["beer", "wine", "mead", "soft"]),
                ("eat", "🍖 Manger", ["bread", "meals", "pies", "meats"])] if tavern else [
                ("shop", "🛒 Acheter", ["harvest_tools", "craft_tools", "hunting_tools"])]
    for branch, title, cats in branches:
        home.append(_nav(f"nav_{branch}", title, branch))
        index = page(branch, title)
        for cat in cats:
            target = f"{branch}_{cat}"
            index.append(_nav(f"nav_{target}", categories[cat], target))
            content = page(target, categories[cat], branch)
            keys = [row[0] for row in foods if row[2] == cat] if tavern else [k for k, c in tools.items() if c == cat]
            content.append({"id": f"buy_{target}", "type": "dynamic_product_selector", "props": {"item_keys": keys, "placeholder": "Acheter dans le stock disponible"}})
            if tavern:
                content.append({"id": f"consume_{target}", "type": "dynamic_consumable_selector", "props": {"item_keys": keys, "placeholder": "Consommer depuis mon sac"}})

    for branch, title, cats in ([("kitchen", "👨‍🍳 Cuisiner", ["bread", "meals", "pies", "meats", "drinks"])] if tavern else [
        ("smelt", "🔥 Fondre", ["iron"]), ("craft", "🔨 Fabriquer", ["harvest_tools", "craft_tools", "hunting_tools", "festival"]) ]):
        home.append(_nav(f"nav_{branch}", title, branch, visible_when={"profession": profession}))
        index = page(branch, title)
        for cat in cats:
            target = f"{branch}_{cat}"
            index.append(_nav(f"nav_{target}", categories[cat], target))
            content = page(target, categories[cat], branch)
            for recipe in building["modules"]["recipes"]:
                if recipe["category"] != cat:
                    continue
                content.append(_button(building, key, actions[recipe["key"]]))
                claim = actions.get(f"claim_{recipe['key']}")
                if claim:
                    content.append({**_button(building, key, claim), "visible_when": {"pending_action": recipe["key"]}})

    for target, title, component_type in [("delivery", "📦 Livrer", "dynamic_inventory_selector"), ("stock", "📊 Stock", "building_inventory")]:
        home.append(_nav(f"nav_{target}", title, target))
        page(target, title).append({"id": target, "type": component_type, "props": {"building": key}})
    home.append(_nav("nav_profession", "Métier", "profession"))
    page("profession", "Métier").extend(_button(building, key, a) for a in building["actions"] if a["key"] in {f"join_{profession}", f"leave_{profession}"})
    if tavern:
        home.append(_nav("nav_stories", "🗣️ Les rumeurs d’Edgar", "stories"))
        page("stories", "Les rumeurs d’Edgar").append(_button(building, key, actions["hear_rumor"]))
        home.append(_nav("nav_games", "🎲 Jugement des Six Faces", "games"))
        page("games", "Jugement des Six Faces").append({
            "id": "choose_bet", "type": "dynamic_game_selector",
            "props": {"placeholder": "Choisir un pari — mise de 5 écus"},
        })
    if not tavern:
        home.append(_nav("nav_repairs", "🛠️ Réparer", "repairs"))
        page("repairs", "Outils usés de votre inventaire").extend(_button(building, key, a) for a in building["actions"] if a["key"].startswith("repair_"))
    for entry in pages:
        entry["components"].append({"id": f"exit_{entry['key']}", "type": "button",
            "props": {"label": "🚪 Quitter"}, "interaction": {"type": "close"}})
    return interface
