"""Données officielles du scénario « La Fête du Royaume ».

Ce module enrichit le *même* template ``royal_festival``. Il ne contient
aucune branche runtime : chaque mécanique est exprimée avec les primitives
no-code génériques et reste donc éditable dans KingdomWeb.
"""

from __future__ import annotations

from typing import Any


BALANCE = "BALANCE_DRAFT / À VALIDER"


def _entity(definitions: list[dict[str, Any]], kind: str, key: str) -> dict[str, Any]:
    return next(row["payload"] for row in definitions if row["type"] == kind and row["key"] == key)


def _action(key: str, name: str, emoji: str, profession: str | None,
            effects: list[dict[str, Any]], *, energy: int = 0, cooldown: int = 0,
            duration: int = 0) -> dict[str, Any]:
    conditions: dict[str, Any] | None = None
    if profession:
        conditions = {"type": "profession_active", "profession": profession}
    result = {"key": key, "name": name, "emoji": emoji, "effects": []}
    if conditions:
        result["conditions"] = conditions
    if energy:
        result["effects"].append({"type": "cost", "resource": "energy", "amount": energy})
    result["effects"].extend(effects)
    if cooldown:
        result["cooldown_seconds"] = cooldown
    if duration:
        result["duration_seconds"] = duration
    result["balance_status"] = BALANCE
    return result


def _join(profession: str, label: str, emoji: str) -> dict[str, Any]:
    return {
        "key": f"join_{profession}", "name": label, "emoji": emoji,
        "conditions": {"type": "no_active_profession"},
        "effects": [{"type": "profession_join", "profession": profession}],
    }


def enrich_royal_festival(definitions: list[dict[str, Any]]) -> None:
    """Complète en place le template officiel déjà généré depuis le GDD."""
    # Le jardin médiéval de démonstration n'appartient pas au scénario GDD.
    definitions[:] = [row for row in definitions if not (
        (row["type"] == "building" and row["key"] == "healers_garden") or
        (row["type"] == "profession" and row["key"] == "herbalist")
    )]

    settings = _entity(definitions, "server_settings", "kingdom_server")
    settings["template_revision"] = 2
    settings["balance_status"] = BALANCE
    settings["onboarding"]["starting_money"] = 25
    settings["live_ops"]["status"] = "preparation"
    settings["live_ops"]["objective_states"] = ["locked", "active", "completed", "failed"]
    settings["live_ops"]["objectives"] = [
        {"key":"banquet","name":"Préparer le banquet","target":50,"unit":"portions","action_keys":["cook_festival_meal"],"increment":4,"state":"active","balance_status":BALANCE},
        {"key":"braziers","name":"Installer les braseros","target":12,"unit":"braseros","action_keys":["install_brazier"],"state":"active","balance_status":BALANCE},
        {"key":"decorations","name":"Installer les décorations","target":40,"unit":"éléments","action_keys":["install_decorations"],"increment":2,"state":"active","balance_status":BALANCE},
        {"key":"drinks","name":"Réunir les boissons","target":30,"unit":"fûts","action_keys":["deliver_festival_drinks"],"increment":2,"state":"active","balance_status":BALANCE},
        {"key":"wood","name":"Constituer la réserve de bois","target":80,"unit":"unités","action_keys":["deliver_festival_wood"],"increment":5,"state":"active","balance_status":BALANCE},
        {"key":"treasury","name":"Financer la fête","target":500,"unit":"écus","action_keys":["fund_festival"],"increment":10,"state":"active","balance_status":BALANCE},
    ]

    new_items = [
        ("festival_brazier","Brasero de fête","🔥","installation",20),
        ("festival_decoration","Décoration du Royaume","🎊","decoration",200),
        ("festival_drink_crate","Caisse de boissons","🍻","drink",100),
        ("festival_provision","Provisions de fête","🧺","food",200),
        ("festival_meal","Portion de banquet","🍲","food",200),
        ("flour_sack","Sac de farine","⚪","ingredient",200),
        ("game_meat","Gibier","🦌","ingredient",100),
        ("rain_herb","Herbe de pluie","🌧️","resource",100),
        ("support_beam","Étai de mine","🪵","material",50),
        ("festival_token","Jeton de contribution","🏅","quest",999),
    ]
    definitions.extend({"type":"item","key":key,"payload":{
        "name":name,"emoji":emoji,"description":f"Contenu du scénario La Fête du Royaume. {BALANCE}",
        "category":category,"stack_limit":limit,"balance_status":BALANCE,
    }} for key,name,emoji,category,limit in new_items)

    profession_updates = {
        "forester": ("simple_axe", 100), "miner": ("iron_pickaxe", 100),
        "blacksmith": ("smith_hammer", 120), "innkeeper": (None, 100), "farmer": (None, 100),
    }
    for key, (tool, xp) in profession_updates.items():
        payload = _entity(definitions, "profession", key)
        if tool is None:
            payload.pop("required_item", None)
            payload["grant_required_item"] = False
        payload.update({"experience_per_level": xp, "balance_status": BALANCE,
                        "starting_energy": 100, "tool_wear_enabled": bool(tool)})

    market = _entity(definitions, "building", "market_square")
    market["actions"] = [
        _action("review_preparations", "Consulter les préparatifs", "📋", None,
                [{"type":"message","text":"Consultez les six objectifs collectifs dans Monde en direct."}]),
        _action("fund_festival", "Verser 10 écus à la trésorerie", "🪙", None,
                [{"type":"cost","resource":"money","amount":10},{"type":"contribution","objective":"treasury","resource":"money","amount":10},{"type":"reward","resource":"festival_token","amount":1}], cooldown=2),
    ]
    market["interface_texts"] = {"home_title":"Intendance royale","home_subtitle":"Préparatifs, contributions et annonces du royaume."}

    forest = _entity(definitions, "building", "forester_lodge")
    forest["actions"] = [
        _join("forester", "Devenir forestier", "🪓"),
        _action("gather_festival_wood", "Bûcheronner", "🪵", "forester", [{"type":"reward","resource":"oak_timber","amount":5},{"type":"profession_experience","profession":"forester","amount":10}], energy=5, cooldown=5, duration=8),
        _action("hunt_game", "Chasser le gibier", "🦌", "forester", [{"type":"reward","resource":"game_meat","amount":2},{"type":"profession_experience","profession":"forester","amount":12}], energy=7, cooldown=10, duration=12),
        _action("craft_decorations", "Façonner des décorations", "🎊", "forester", [{"type":"cost","resource":"oak_timber","amount":2},{"type":"reward","resource":"festival_decoration","amount":2},{"type":"profession_experience","profession":"forester","amount":8}], energy=3),
        _action("gather_rain_herbs", "Récolter sous la pluie", "🌧️", "forester", [{"type":"reward","resource":"rain_herb","amount":1},{"type":"profession_experience","profession":"forester","amount":5}], energy=3, cooldown=15),
    ]

    mine = _entity(definitions, "building", "deep_mine")
    mine["actions"] = [
        _join("miner", "Devenir mineur", "⛏️"),
        _action("extract_festival_ore", "Extraire du minerai", "⛓️", "miner", [{"type":"reward","resource":"iron_ore","amount":3},{"type":"profession_experience","profession":"miner","amount":10}], energy=6, cooldown=5, duration=10),
        _action("quarry_stone", "Tailler de la pierre", "🪨", "miner", [{"type":"reward","resource":"stone_block","amount":3},{"type":"profession_experience","profession":"miner","amount":8}], energy=5),
        _action("reinforce_mine", "Sécuriser la galerie", "🪵", "miner", [{"type":"cost","resource":"oak_timber","amount":15},{"type":"cost","resource":"festival_provision","amount":5},{"type":"contribution","objective":"mine_repair","resource":"support","amount":1}], energy=8),
    ]

    forge = _entity(definitions, "building", "royal_forge")
    forge["actions"] = [
        _join("blacksmith", "Devenir forgeron", "⚒️"),
        _action("forge_festival_brazier", "Forger un brasero", "🔥", "blacksmith", [{"type":"cost","resource":"iron_ore","amount":3},{"type":"cost","resource":"oak_timber","amount":1},{"type":"reward","resource":"festival_brazier","amount":1},{"type":"profession_experience","profession":"blacksmith","amount":15}], energy=7, duration=10),
        _action("forge_support_beam", "Fabriquer un étai", "🪵", "blacksmith", [{"type":"cost","resource":"oak_timber","amount":2},{"type":"cost","resource":"iron_ore","amount":1},{"type":"reward","resource":"support_beam","amount":1},{"type":"profession_experience","profession":"blacksmith","amount":8}], energy=4),
    ]

    tavern = _entity(definitions, "building", "edgar_tavern")
    tavern["actions"] = [
        _join("innkeeper", "Devenir tavernier", "🍺"),
        _action("brew_festival_drinks", "Préparer les boissons", "🍺", "innkeeper", [{"type":"cost","resource":"wheat_sack","amount":1},{"type":"reward","resource":"festival_drink_crate","amount":2},{"type":"profession_experience","profession":"innkeeper","amount":10}], energy=4, cooldown=5),
        _action("cook_festival_meal", "Cuisiner le banquet", "🍲", "innkeeper", [{"type":"cost","resource":"flour_sack","amount":1},{"type":"cost","resource":"game_meat","amount":1},{"type":"reward","resource":"festival_meal","amount":4},{"type":"contribution","objective":"banquet","resource":"festival_meal","amount":4},{"type":"profession_experience","profession":"innkeeper","amount":14}], energy=6, duration=10),
        _action("edgar_refreshment", "Profiter de la tournée d’Edgar", "🍻", None, [{"type":"reward","resource":"energy","amount":15}], cooldown=60),
    ]

    farm = _entity(definitions, "building", "festival_farm")
    farm["actions"] = [
        _join("farmer", "Devenir cultivateur", "🌾"),
        _action("harvest_festival_wheat", "Récolter le blé", "🌾", "farmer", [{"type":"reward","resource":"wheat_sack","amount":4},{"type":"profession_experience","profession":"farmer","amount":10}], energy=4, cooldown=5),
        _action("mill_festival_flour", "Moudre la farine", "⚙️", "farmer", [{"type":"cost","resource":"wheat_sack","amount":2},{"type":"reward","resource":"flour_sack","amount":2},{"type":"profession_experience","profession":"farmer","amount":8}], energy=3),
        _action("prepare_provisions", "Préparer les provisions", "🧺", "farmer", [{"type":"cost","resource":"wheat_sack","amount":1},{"type":"reward","resource":"festival_provision","amount":2},{"type":"profession_experience","profession":"farmer","amount":8}], energy=3),
    ]

    esplanade = _entity(definitions, "building", "festival_esplanade")
    esplanade["actions"] = [
        _action("install_brazier", "Installer un brasero", "🔥", None, [{"type":"cost","resource":"festival_brazier","amount":1},{"type":"contribution","objective":"braziers","resource":"festival_brazier","amount":1},{"type":"reward","resource":"festival_token","amount":1}]),
        _action("install_decorations", "Installer les décorations", "🎊", None, [{"type":"cost","resource":"festival_decoration","amount":2},{"type":"contribution","objective":"decorations","resource":"festival_decoration","amount":2},{"type":"reward","resource":"festival_token","amount":1}]),
        _action("deliver_festival_drinks", "Livrer les boissons", "🍻", None, [{"type":"cost","resource":"festival_drink_crate","amount":2},{"type":"contribution","objective":"drinks","resource":"festival_drink_crate","amount":2},{"type":"reward","resource":"money","amount":4}]),
        _action("deliver_festival_wood", "Livrer le bois", "🪵", None, [{"type":"cost","resource":"oak_timber","amount":5},{"type":"contribution","objective":"wood","resource":"oak_timber","amount":5},{"type":"reward","resource":"money","amount":5}]),
        _action("secure_festival", "Sécuriser l’esplanade", "⛈️", None, [{"type":"cost","resource":"support_beam","amount":1},{"type":"contribution","objective":"storm_security","resource":"support_beam","amount":1}]),
        _action("inspect_preparations", "Voir l’état de la fête", "📋", None, [{"type":"message","text":"La progression collective est disponible dans Monde en direct."}]),
    ]

    # Commerce, stocks, recettes et livraisons sont déclarés dans les modules
    # publics afin d'être visibles dans l'éditeur de bâtiment KingdomWeb.
    forest.setdefault("modules", {}).update({
        "products": [{"item_key":"simple_axe","price":18,"initial_stock":8}],
        "deliveries": [],
    })
    mine.setdefault("modules", {}).update({
        "products": [{"item_key":"iron_pickaxe","price":22,"initial_stock":8}],
        "deliveries": [],
    })
    forge.setdefault("modules", {}).update({
        "products": [{"item_key":"smith_hammer","price":24,"initial_stock":6},{"item_key":"festival_brazier","price":15,"initial_stock":0}],
        "recipes": [{"key":"forge_festival_brazier","name":"Forger un brasero","profession":"blacksmith","required_level":1,"duration_seconds":10,"energy_cost":7,"ingredients":{"iron_ore":3,"oak_timber":1},"output_item_key":"festival_brazier","output_quantity":1,"output_destination":"player","balance_status":BALANCE}],
        "deliveries": [{"item_key":"iron_ore","target_building_key":"royal_forge","unit_price":2,"minimum_quantity":1}],
    })
    tavern.setdefault("modules", {}).update({
        "products": [{"item_key":"royal_ale","price":8,"initial_stock":20},{"item_key":"festival_meal","price":10,"initial_stock":0}],
        "recipes": [{"key":"cook_festival_meal","name":"Cuisiner le banquet","profession":"innkeeper","required_level":1,"duration_seconds":10,"energy_cost":6,"ingredients":{"flour_sack":1,"game_meat":1},"output_item_key":"festival_meal","output_quantity":4,"output_destination":"player","balance_status":BALANCE}],
        "deliveries": [{"item_key":"festival_provision","target_building_key":"edgar_tavern","unit_price":2,"minimum_quantity":1}],
    })
    farm.setdefault("modules", {}).update({
        "products": [{"item_key":"wheat_sack","price":3,"initial_stock":12},{"item_key":"festival_provision","price":6,"initial_stock":5}],
        "recipes": [{"key":"mill_festival_flour","name":"Moudre la farine","profession":"farmer","required_level":1,"duration_seconds":5,"energy_cost":3,"ingredients":{"wheat_sack":2},"output_item_key":"flour_sack","output_quantity":2,"output_destination":"player","balance_status":BALANCE}],
        "deliveries": [],
    })
    esplanade.setdefault("modules", {}).update({
        "products": [], "recipes": [],
        "deliveries": [
            {"item_key":"oak_timber","target_building_key":"festival_esplanade","unit_price":1,"minimum_quantity":1},
            {"item_key":"festival_brazier","target_building_key":"festival_esplanade","unit_price":4,"minimum_quantity":1},
            {"item_key":"festival_drink_crate","target_building_key":"festival_esplanade","unit_price":2,"minimum_quantity":1},
        ],
    })

    # Les fiches personnage et les présences utilisent les éditeurs génériques
    # PNJ / Voix & présence. Les clips absents sont explicitement documentés.
    npc_specs = [
        ("edgar","Edgar","🍺","edgar_tavern","riverhold","Le tavernier coordonne repas et boissons.","brew_festival_drinks"),
        ("roland","Roland","⛏️","deep_mine","iron_hills","Le contremaître veille sur les galeries.","extract_festival_ore"),
        ("wagner","Wagner","⚒️","royal_forge","riverhold","Le maître forgeron prépare les installations.","forge_festival_brazier"),
        ("sylvain","Sylvain","🌲","forester_lodge","whispering_woods","Le garde forestier connaît Valbrume.","gather_festival_wood"),
        ("agathe","Agathe","🌾","festival_farm","riverhold","La régisseuse organise les récoltes.","harvest_festival_wheat"),
        ("maelis","Maëlis","📜","market_square","riverhold","L’intendante suit les contributions du royaume.","fund_festival"),
    ]
    for key, name, emoji, building, location, description, action_key in npc_specs:
        profile_key, presence_key = f"voice_{key}", f"presence_{key}"
        definitions.extend([
            {"type":"voice_profile","key":profile_key,"payload":{"name":f"Voix de {name}","emoji":"🗣️","description":f"Profil prêt à recevoir les répliques de {name}.","clips":[],"tags":["royal_festival","audio_a_fournir"],"volume":1,"missing_assets_status":"À fournir"}},
            {"type":"voice_presence","key":presence_key,"payload":{"name":name,"emoji":emoji,"description":description,"presence_type":"npc","voice_profile_key":profile_key,"scene_key":f"preset_{'village' if building == 'market_square' else 'forest' if building == 'forester_lodge' else 'mine' if building == 'deep_mine' else 'forge' if building == 'royal_forge' else 'tavern' if building == 'edgar_tavern' else 'farm'}_scene","location_key":location,"assignment_mode":"automatic","release_timeout_seconds":8,"metadata":{"building_key":building,"source_npc_key":key,"missing_audio":"À fournir"}}},
            {"type":"npc","key":key,"payload":{"name":name,"emoji":emoji,"description":description,"location_key":location,"building_key":building,"voice_profile_key":profile_key,"voice_presence_key":presence_key,"reactions":[
                {"key":"welcome","trigger":"talk","variants":[{"key":"welcome_text","text":f"{name} vous accueille et vous explique son rôle dans les préparatifs."}]},
                {"key":"work_reaction","trigger":"activity_success","conditions":[{"type":"action","value":action_key}],"variants":[{"key":"encouragement","text":f"{name} approuve votre contribution à la Fête du Royaume."}]},
            ],"metadata":{"template":"royal_festival","audio_assets":"À fournir"}}},
        ])

    event_updates = {
        "festival_rain": {"trigger":{"type":"scheduled","minute":45},"duration_minutes":45,"weather_key":"rain","audio_layers":[{"group_key":"preset_forest_scene","building_keys":["forester_lodge"]}],"modifiers":[{"property":"production.quantity","operator":"multiply","value":0.85,"target":{"type":"building","key":"forester_lodge"}}]},
        "mine_incident": {"trigger":{"type":"scheduled","minute":70},"duration_minutes":20,"modifiers":[{"property":"production.quantity","operator":"multiply","value":0.5,"target":{"type":"building","key":"deep_mine"}}],"resolution":{"requirements":{"oak_timber":15,"support_beam":3,"festival_provision":5},"balance_status":BALANCE}},
        "edgar_round": {"trigger":{"type":"scheduled","minute":110},"duration_minutes":15,"modifiers":[{"property":"energy.cost","operator":"multiply","value":0.8,"target":{"type":"kingdom","key":""}}]},
        "festival_storm": {"trigger":{"type":"scheduled","minute":135},"duration_minutes":35,"modifiers":[{"property":"activity.duration","operator":"multiply","value":1.4,"target":{"type":"kingdom","key":""}}],"temporary_objective":{"key":"storm_security","target":6,"unit":"étais","state":"active","balance_status":BALANCE}},
        "festival_opening": {"trigger":{"type":"scheduled","minute":170},"duration_minutes":10,"activation_conditions":{"all_objectives_completed":True},"audio_layers":[{"group_key":"preset_festival_scene","building_keys":["festival_esplanade"]}]},
    }
    for event_key, values in event_updates.items():
        _entity(definitions, "event", event_key).update({**values,"balance_status":BALANCE})
    definitions.append({"type":"event","key":"royal_convocation","payload":{"name":"Convocation royale","emoji":"👑","description":"Clôture du scénario et bilan collectif.","trigger":{"type":"scheduled","minute":180},"enabled":False,"modifiers":[],"effects":[],"balance_status":BALANCE}})

    environment = _entity(definitions, "environment", "realm_climate")
    environment["name"] = "Calendrier et météo de la Fête"
    environment["scenario_schedule"] = [{"minute":45,"condition":"rain"},{"minute":90,"condition":"clear"},{"minute":135,"condition":"storm"}]
    environment["balance_status"] = BALANCE

    page_sets = {
        "market_square": [("preparations","Préparatifs","📋"),("contribution","Contribution","🪙"),("announcements","Annonces","📣")],
        "edgar_tavern": [("common_room","Salle commune","🍻"),("menu","Menu","📜"),("kitchen","Cuisine","🍲"),("delivery","Livraison","📦")],
        "deep_mine": [("extraction","Extraction","⛏️"),("stock_delivery","Stock et livraison","📦"),("incident","Incident minier","⚠️")],
        "royal_forge": [("workshop","Atelier","⚒️"),("repairs","Réparation","🔧"),("festival_orders","Commandes de la Fête","🔥"),("stock_delivery","Stock et livraisons","📦")],
        "forester_lodge": [("logging","Bûcheronnage","🪓"),("hunting","Chasse","🦌"),("rain_resources","Ressources de pluie","🌧️"),("delivery","Livraison","📦")],
        "festival_farm": [("fields","Champs","🌾"),("mill","Moulin et préparation","⚙️"),("delivery","Livraison","📦")],
        "festival_esplanade": [("installation","Installation","🏗️"),("storm_alert","Alerte tempête","⛈️"),("festival_active","Fête active","🎉")],
    }
    for building_key, pages in page_sets.items():
        _entity(definitions, "building", building_key)["interface_sections"] = [
            {"key": key, "name": name, "emoji": emoji,
             "description": f"Écran configurable du scénario La Fête du Royaume. {BALANCE}"}
            for key, name, emoji in pages
        ]
