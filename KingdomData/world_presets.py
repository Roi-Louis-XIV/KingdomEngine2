"""Packs de démarrage génériques proposés lors de la création d'un monde.

Ces packs ne changent jamais le moteur : ils ne contiennent que des entités
no-code publiées dans la nouvelle base KingdomData.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .server_settings import default_server_settings
from .interfaces import interface_from_building


PRESET_CATALOG = [
    {"key": "blank", "name": "Monde vierge", "emoji": "◇", "description": "Une configuration propre, sans lieu ni mécanique imposée.", "tone": "neutral"},
    {"key": "medieval_kingdom", "name": "Royaume médiéval", "emoji": "🏰", "description": "Village, forêt, mine, métiers, économie, météo et événement saisonnier.", "tone": "emerald"},
    {"key": "space_station", "name": "Station spatiale", "emoji": "🛰️", "description": "Pont de commandement, hydroponie, exploration, crédits et météo spatiale.", "tone": "violet"},
]


def world_preset(key: str) -> list[dict[str, Any]]:
    builders = {"blank": _blank, "medieval_kingdom": _medieval, "space_station": _space}
    if key not in builders:
        raise ValueError("Modèle de monde inconnu.")
    return deepcopy(_make_playable(builders[key]()))


def _make_playable(definitions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Relie les données des modèles et génère leurs interfaces Discord.

    Cette étape ne crée aucune logique liée à un univers : elle projette les
    professions, outils, actions et pages avec les primitives publiques du
    moteur, exactement comme le ferait KingdomWeb.
    """
    professions = {row["key"]: row["payload"] for row in definitions if row["type"] == "profession"}
    for row in (item for item in definitions if item["type"] == "building"):
        key, building = row["key"], row["payload"]
        modules = building.setdefault("modules", {})
        for section in ("professions", "activities", "products", "recipes", "deliveries", "upgrades"):
            modules.setdefault(section, [])
        profession_key = str(building.get("relations", {}).get("primary_profession_key", ""))
        profession = professions.get(profession_key)
        if profession:
            linked = {"key": profession_key, **profession}
            modules["professions"] = [linked]
            required_item = str(profession.get("required_item", ""))
            for action in building.get("actions", []):
                effects = action.get("effects", [])
                joins = any(effect.get("type") == "profession_join" and effect.get("profession") == profession_key for effect in effects)
                earns_xp = any(effect.get("type") == "profession_experience" and effect.get("profession") == profession_key for effect in effects)
                if joins and required_item and profession.get("grant_required_item", True):
                    if not any(effect.get("type") == "reward" and effect.get("resource") == required_item for effect in effects):
                        effects.extend([
                            {"type": "reward", "resource": required_item, "amount": 1},
                            {"type": "tool_grant", "tool": required_item, "durability": 100, "max_durability": 100},
                        ])
                if earns_xp and required_item:
                    existing = action.get("conditions")
                    tool_condition = {"type": "tool_present", "tool": required_item}
                    action["conditions"] = {"all": [existing, tool_condition]} if existing else tool_condition
                    if not any(effect.get("type") == "durability" and effect.get("tool") == required_item for effect in effects):
                        effects.append({"type": "durability", "tool": required_item, "amount": 1, "max_durability": 100})
                if earns_xp:
                    rewards = [effect for effect in effects if effect.get("type") in {"reward", "stock_reward", "random_result"}]
                    random_effect = next((effect for effect in rewards if effect.get("type") == "random_result"), None)
                    outcomes = deepcopy(random_effect.get("outcomes", [])) if random_effect else [
                        {"key": "configured_result", "name": "Résultat configuré", "weight": 1, "effects": rewards}
                    ]
                    modules["activities"].append({
                        "key": action["key"], "name": action.get("name", action["key"]),
                        "profession": profession_key, "tool": required_item,
                        "energy_cost": next((int(effect.get("amount", 0)) for effect in effects if effect.get("type") == "cost" and effect.get("resource") == "energy"), 0),
                        "duration_seconds": int(action.get("duration_seconds", 0)),
                        "cooldown_seconds": int(action.get("cooldown_seconds", 0)),
                        "outcomes": outcomes,
                    })
        interface = interface_from_building(key, building, building.get("actions", []))
        interface["profession_labels"] = {profession_key: profession.get("name", profession_key)} if profession else {}
        home = interface["pages"][0]["components"]
        next_slot = 1 + max((int(component.get("slot", -1)) for component in home), default=-1)
        home.append({"id": f"nav_inventory_{key}"[:64], "type": "button", "slot": next_slot, "props": {"label": "Inventaires", "emoji": "🎒", "style": "secondary"}, "interaction": {"type": "navigate", "page": "inventories"}})
        interface["pages"].append({"key": "inventories", "name": "Inventaires", "components": [
            {"id": f"hero_inventory_{key}"[:64], "type": "hero", "props": {"title": "Inventaires", "subtitle": "Consultez votre sac et les réserves de ce lieu.", "emoji": "🎒"}},
            {"id": f"player_inventory_{key}"[:64], "type": "player_inventory", "props": {"title": "Votre inventaire"}},
            {"id": f"building_inventory_{key}"[:64], "type": "building_inventory", "props": {"title": "Stock du bâtiment", "building": key}},
            {"id": f"back_inventory_{key}"[:64], "type": "button", "slot": 0, "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}},
        ]})
        if modules["products"]:
            home.append({"id": f"nav_shop_{key}"[:64], "type": "button", "slot": next_slot + 1, "props": {"label": "Commerce", "emoji": "🛒", "style": "success"}, "interaction": {"type": "navigate", "page": "shop"}})
            interface["pages"].append({"key": "shop", "name": "Commerce", "components": [
                {"id": f"hero_shop_{key}"[:64], "type": "hero", "props": {"title": f"Comptoir · {building.get('name', key)}", "subtitle": "Choisissez un produit disponible dans le stock commun.", "emoji": "🛒"}},
                {"id": f"products_{key}"[:64], "type": "dynamic_product_selector", "slot": 0, "props": {"placeholder": "Choisir un produit…"}},
                {"id": f"back_shop_{key}"[:64], "type": "button", "slot": 5, "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}},
            ]})
        building["interface"] = interface
    return definitions


def _settings(name: str, description: str, *, category: str, player: str, master: str, primary: str, accent: str) -> dict[str, Any]:
    settings = default_server_settings()
    settings.update({"name": name, "description": description})
    settings["roles"].update({"game_master": master, "player": player, "bot": "🤖 Agents KingdomEngine"})
    settings["discord"].update({"general_category": category, "commands_channel": "commandes", "administration_channel": "administration"})
    settings["theme"].update({"primary_color": primary, "accent_color": accent})
    return settings


def _blank() -> list[dict[str, Any]]:
    return [{"type": "server_settings", "key": "kingdom_server", "payload": _settings(
        "Configuration du monde", "Paramètres génériques d'un monde KingdomEngine.", category="🌐 KINGDOM ENGINE",
        player="👤 Participant", master="🛡️ Administrateur du monde", primary="6656e8", accent="1aa7b8",
    )}]


def _medieval() -> list[dict[str, Any]]:
    definitions = _blank()
    definitions[0]["payload"] = _settings("Configuration du royaume", "Fondations d'un royaume médiéval vivant.", category="🏰 LE ROYAUME", player="⚔️ Habitants", master="👑 Maître du Royaume", primary="246b45", accent="c3913a")
    definitions[0]["payload"]["onboarding"].update({
        "channel_name": "prestation-de-serment", "title": "Le Serment de la Sainte Pelle",
        "rules_text": "Avant d'entrer dans le Royaume, lis les règles puis prête serment :\n\n• Respecte les autres habitants et leurs créations.\n• Ne triche pas et n'exploite pas les erreurs du moteur.\n• Suis les indications des Maîtres du Royaume.\n\nEn cliquant ci-dessous, tu jures fidélité au Royaume sur la Sainte Pelle.",
        "button_label": "Je prête serment", "button_emoji": "🛠️",
        "confirmation": "Serment accepté. Les portes du Royaume te sont ouvertes.",
        "action_name": "serment de la Sainte Pelle", "currency_label": "écus",
    })
    definitions += [
        {"type":"item","key":key,"payload":{"name":name,"emoji":emoji,"description":description,"category":category,"stack_limit":limit}}
        for key,name,emoji,description,category,limit in [
            ("simple_axe","Hache de forestier","🪓","Outil robuste pour les travaux sylvicoles.","tool",1),("iron_pickaxe","Pioche de mineur","⛏️","Outil d'extraction des galeries profondes.","tool",1),
            ("stone_block","Bloc de pierre","🪨","Pierre taillée destinée aux constructions.","resource",999),("medicinal_herb","Herbe médicinale","🌿","Plante utilisée par les guérisseurs.","resource",250),
            ("wheat_sack","Sac de blé","🌾","Récolte prête pour le moulin.","resource",500),("iron_ingot","Lingot de fer","🔩","Métal raffiné par la forge.","material",250),
            ("wooden_plank","Planche de chêne","🪵","Bois transformé pour les artisans.","material",500),("hunting_leather","Cuir de chasse","🟫","Peau préparée pour les équipements.","material",200),
            ("healing_potion","Potion de soin","🧪","Préparation qui redonne des forces.","consumable",20),("royal_ale","Bière royale","🍺","Boisson brassée pour les fêtes du royaume.","drink",50),
            ("cheese_wheel","Meule de fromage","🧀","Produit des fermes de Val-Rivière.","food",50),("roast_meat","Viande rôtie","🍖","Repas nourrissant servi à l'auberge.","food",30),
            ("iron_sword","Épée de fer","⚔️","Arme courante de la garde.","equipment",1),("oak_shield","Bouclier de chêne","🛡️","Protection façonnée par les artisans.","equipment",1),
            ("ancient_scroll","Parchemin ancien","📜","Fragment de savoir découvert en exploration.","quest",20),("forest_amber","Ambre sylvestre","🔶","Résine rare recherchée par les alchimistes.","rare",50),
            ("smith_hammer","Marteau de forge","🔨","Outil professionnel des forgerons.","tool",1),("herbalism_kit","Serpe d'herboriste","🌿","Trousse de récolte et de préparation des plantes.","tool",1),
        ]
    ]
    definitions += [
        {"type":"item","key":"crown_coin","payload":{"name":"Écu","emoji":"🪙","description":"Monnaie commune du royaume.","category":"currency","stack_limit":999999}},
        {"type":"item","key":"oak_timber","payload":{"name":"Bois de chêne","emoji":"🪵","description":"Bois solide récolté dans les forêts.","category":"resource","stack_limit":999}},
        {"type":"item","key":"iron_ore","payload":{"name":"Minerai de fer","emoji":"⛓️","description":"Minerai destiné aux artisans.","category":"resource","stack_limit":999}},
        {"type":"item","key":"village_bread","payload":{"name":"Pain du village","emoji":"🍞","description":"Restaure les forces des voyageurs.","category":"food","stack_limit":50,"price":6}},
        {"type":"profession","key":"forester","payload":{"name":"Forestier","emoji":"🪓","description":"Récolte et protège les ressources forestières.","max_level":20,"experience_per_level":100,"required_item":"simple_axe","grant_required_item":True}},
        {"type":"profession","key":"miner","payload":{"name":"Mineur","emoji":"⛏️","description":"Explore les galeries et extrait les minerais.","max_level":20,"experience_per_level":100,"required_item":"iron_pickaxe","grant_required_item":True}},
        {"type":"profession","key":"blacksmith","payload":{"name":"Forgeron","emoji":"⚒️","description":"Transforme minerais et bois en équipements.","max_level":20,"experience_per_level":120,"required_item":"smith_hammer","grant_required_item":True}},
        {"type":"profession","key":"herbalist","payload":{"name":"Herboriste","emoji":"🌿","description":"Récolte les plantes et prépare des remèdes.","max_level":20,"experience_per_level":90,"required_item":"herbalism_kit","grant_required_item":True}},
        {"type":"location","key":"green_realm","payload":{"name":"Le Royaume Vert","emoji":"🗺️","description":"Territoire principal du monde.","location_type":"kingdom","connections":[]}},
        {"type":"location","key":"riverhold","payload":{"name":"Val-Rivière","emoji":"🏘️","description":"Capitale bâtie autour de la grande place.","location_type":"city","parent_key":"green_realm","connections":[{"target":"whispering_woods","name":"Chemin forestier","direction":"bidirectional","visibility":"visible","duration_seconds":60},{"target":"iron_hills","name":"Route des collines","direction":"bidirectional","visibility":"visible","duration_seconds":90}]}},
        {"type":"location","key":"whispering_woods","payload":{"name":"Bois Murmurants","emoji":"🌲","description":"Forêt ancienne riche en bois et en secrets.","location_type":"forest","parent_key":"green_realm","connections":[{"target":"riverhold","name":"Chemin forestier","direction":"bidirectional","visibility":"visible","duration_seconds":60}]}},
        {"type":"location","key":"iron_hills","payload":{"name":"Collines de Fer","emoji":"⛰️","description":"Massif parcouru de galeries minières.","location_type":"mountain","parent_key":"green_realm","connections":[{"target":"riverhold","name":"Route des collines","direction":"bidirectional","visibility":"visible","duration_seconds":90}]}},
        {"type":"building","key":"market_square","payload":{"name":"Grande Place","emoji":"⛲","description":"Centre social et commercial de la capitale.","location_key":"riverhold","entity_kind":"place","color":"c3913a","modules":{"products":[{"item_key":"village_bread","price":6,"initial_stock":30},{"item_key":"royal_ale","price":8,"initial_stock":20},{"item_key":"cheese_wheel","price":10,"initial_stock":15},{"item_key":"roast_meat","price":12,"initial_stock":12}]},"actions":[{"key":"welcome_gift","name":"Recevoir son viatique","emoji":"🎁","conditions":{"type":"cooldown_available","key":"welcome_gift","seconds":86400},"effects":[{"type":"reward","resource":"money","amount":10},{"type":"message","text":"La cité vous confie 10 écus pour votre voyage."}]}]}},
        {"type":"building","key":"forester_lodge","payload":{"name":"Maison des Forestiers","emoji":"🌲","description":"Point de départ des expéditions dans les bois.","location_key":"whispering_woods","entity_kind":"institution","color":"2f855a","relations":{"primary_profession_key":"forester"},"actions":[{"key":"join_foresters","name":"Devenir forestier","emoji":"🪓","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"forester"},{"type":"message","text":"Vous rejoignez la corporation des forestiers."}]},{"key":"gather_timber","name":"Explorer la lisière","emoji":"🌲","conditions":{"type":"profession_active","profession":"forester"},"effects":[{"type":"cost","resource":"energy","amount":5},{"type":"reward","resource":"oak_timber","amount":2},{"type":"profession_experience","profession":"forester","amount":10},{"type":"message","text":"Vous rapportez du bois de chêne."}]},{"key":"saw_planks","name":"Tailler des planches","emoji":"🪵","conditions":{"type":"profession_active","profession":"forester"},"effects":[{"type":"cost","resource":"oak_timber","amount":2},{"type":"reward","resource":"wooden_plank","amount":1},{"type":"profession_experience","profession":"forester","amount":8},{"type":"message","text":"Le bois est prêt pour les artisans."}]}]}},
        {"type":"building","key":"deep_mine","payload":{"name":"Mine des Collines","emoji":"⛏️","description":"Galeries d'extraction du minerai de fer.","location_key":"iron_hills","entity_kind":"zone","color":"6b7280","relations":{"primary_profession_key":"miner"},"actions":[{"key":"join_miners","name":"Devenir mineur","emoji":"⛏️","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"miner"},{"type":"message","text":"La confrérie des mineurs vous accueille."}]},{"key":"extract_ore","name":"Extraire du minerai","emoji":"⛓️","conditions":{"type":"profession_active","profession":"miner"},"effects":[{"type":"cost","resource":"energy","amount":6},{"type":"reward","resource":"iron_ore","amount":2},{"type":"profession_experience","profession":"miner","amount":12}]}]}},
        {"type":"building","key":"royal_forge","payload":{"name":"Forge royale","emoji":"⚒️","description":"Atelier de transformation et d'équipement.","location_key":"riverhold","entity_kind":"institution","color":"b45309","relations":{"primary_profession_key":"blacksmith"},"modules":{"professions":[],"activities":[],"products":[{"item_key":"iron_sword","price":80,"initial_stock":5},{"item_key":"oak_shield","price":65,"initial_stock":5}],"recipes":[{"key":"smelt_iron","name":"Fondre un lingot","ingredients":{"iron_ore":3},"output_item_key":"iron_ingot","output_quantity":1,"duration_seconds":20}],"deliveries":[],"upgrades":[]},"actions":[{"key":"join_blacksmiths","name":"Devenir forgeron","emoji":"⚒️","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"blacksmith"}]},{"key":"smelt_iron_action","name":"Fondre du minerai","emoji":"🔥","conditions":{"type":"profession_active","profession":"blacksmith"},"effects":[{"type":"cost","resource":"iron_ore","amount":3},{"type":"reward","resource":"iron_ingot","amount":1},{"type":"profession_experience","profession":"blacksmith","amount":12},{"type":"message","text":"Le minerai devient un lingot de fer."}]},{"key":"forge_sword","name":"Forger une épée","emoji":"⚔️","conditions":{"type":"profession_active","profession":"blacksmith"},"effects":[{"type":"cost","resource":"iron_ingot","amount":2},{"type":"cost","resource":"wooden_plank","amount":1},{"type":"reward","resource":"iron_sword","amount":1},{"type":"profession_experience","profession":"blacksmith","amount":25}]}]}},
        {"type":"building","key":"healers_garden","payload":{"name":"Jardin des guérisseurs","emoji":"🌿","description":"Jardin médicinal et laboratoire de remèdes.","location_key":"riverhold","entity_kind":"institution","color":"16a34a","relations":{"primary_profession_key":"herbalist"},"actions":[{"key":"join_herbalists","name":"Devenir herboriste","emoji":"🌿","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"herbalist"}]},{"key":"gather_herbs","name":"Récolter des simples","emoji":"🌱","conditions":{"type":"profession_active","profession":"herbalist"},"effects":[{"type":"cost","resource":"energy","amount":4},{"type":"reward","resource":"medicinal_herb","amount":3},{"type":"profession_experience","profession":"herbalist","amount":10}]},{"key":"brew_healing_potion","name":"Préparer une potion","emoji":"🧪","conditions":{"type":"profession_active","profession":"herbalist"},"effects":[{"type":"cost","resource":"medicinal_herb","amount":2},{"type":"reward","resource":"healing_potion","amount":1},{"type":"profession_experience","profession":"herbalist","amount":15}]}]}},
        {"type":"environment","key":"realm_climate","payload":{"name":"Climat tempéré","emoji":"🌦️","description":"Saisons, météo et calendrier du royaume.","mode":"weighted","hour":8,"minute":0,"conditions":[{"key":"clear","name":"Éclaircies","emoji":"☀️","weight":5},{"key":"rain","name":"Pluie","emoji":"🌧️","weight":3},{"key":"fog","name":"Brume","emoji":"🌫️","weight":2}],"calendar":{"name":"Calendrier royal","weekdays":["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"],"months":[{"key":"springtide","name":"Primeflore","days":30},{"key":"suncrest","name":"Haut-Soleil","days":30},{"key":"harvestfall","name":"Moissons","days":30},{"key":"frostveil","name":"Longue-Nuit","days":30}],"seasons":[{"key":"spring","name":"Printemps","start_month_key":"springtide","start_day":1},{"key":"summer","name":"Été","start_month_key":"suncrest","start_day":1},{"key":"autumn","name":"Automne","start_month_key":"harvestfall","start_day":1},{"key":"winter","name":"Hiver","start_month_key":"frostveil","start_day":1}]} }},
        {"type":"event","key":"harvest_fair","payload":{"name":"Foire des Moissons","emoji":"🌾","description":"Les récoltes et le commerce animent tout le royaume.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"commerce.price","operator":"multiply","value":0.9,"scope":"world"}],"effects":[]}},
        {"type":"event","key":"royal_hunt","payload":{"name":"Grande chasse royale","emoji":"🏹","description":"Les bois offrent davantage de ressources rares.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"production.quantity","operator":"multiply","value":1.25,"scope":"building","targets":["forester_lodge"]}],"effects":[]}},
        {"type":"event","key":"deep_fog","payload":{"name":"Brume profonde","emoji":"🌫️","description":"La brume ralentit les expéditions extérieures.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"activity.duration","operator":"multiply","value":1.3,"scope":"world"}],"effects":[]}},
        {"type":"event","key":"forge_blessing","payload":{"name":"Bénédiction de la forge","emoji":"🔥","description":"Les artisans travaillent avec une efficacité exceptionnelle.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"production.duration","operator":"multiply","value":0.75,"scope":"building","targets":["royal_forge"]}],"effects":[]}},
        {"type":"bot","key":"realm_steward","payload":{"name":"Intendant du Royaume","emoji":"🛡️","description":"Agent Discord principal du modèle médiéval.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Veille sur le royaume","modules":["buildings","profiles","events","weather"]}},
    ]
    return definitions


def _space() -> list[dict[str, Any]]:
    definitions = _blank()
    definitions[0]["payload"] = _settings("Configuration de la station", "Fondations d'une colonie spatiale persistante.", category="🛰️ ORBITAL NETWORK", player="🧑‍🚀 Équipage", master="🛡️ Commandement", primary="4338ca", accent="22d3ee")
    definitions[0]["payload"]["onboarding"].update({
        "channel_name": "sas-d-integration", "title": "Protocole d'intégration de l'équipage",
        "rules_text": "Avant d'accéder à la station, consulte les protocoles de bord :\n\n• Respecte l'équipage et les espaces partagés.\n• Protège les systèmes vitaux et signale toute anomalie.\n• Suis les consignes du Commandement.\n\nValide ton accréditation pour recevoir ton accès d'équipage.",
        "button_label": "Valider mon accréditation", "button_emoji": "🛰️",
        "confirmation": "Accréditation confirmée. Bienvenue à bord de la station Aurora.",
        "action_name": "accréditation d'équipage", "currency_label": "crédits orbitaux",
    })
    definitions += [
        {"type":"item","key":key,"payload":{"name":name,"emoji":emoji,"description":description,"category":category,"stack_limit":limit}}
        for key,name,emoji,description,category,limit in [
            ("engineering_toolkit","Kit d'ingénierie","🧰","Outils de diagnostic et de maintenance.","tool",1),("eva_suit","Combinaison EVA","🧑‍🚀","Protection pour les sorties extravéhiculaires.","tool",1),
            ("circuit_board","Circuit quantique","💾","Composant électronique de haute précision.","component",250),("fusion_cell","Cellule à fusion","🔋","Réserve énergétique industrielle.","energy",100),
            ("water_reserve","Réserve d'eau","💧","Eau recyclée indispensable à l'équipage.","resource",500),("nutrient_gel","Gel nutritif","🥫","Ration compacte produite en hydroponie.","food",100),
            ("bio_sample","Échantillon biologique","🧫","Culture destinée au laboratoire.","research",100),("medical_pack","Pack médical","🩹","Matériel d'intervention d'urgence.","consumable",20),
            ("data_core","Noyau de données","💿","Archive récupérée dans une épave.","research",50),("plasma_cutter","Découpeur plasma","🔦","Outil de découpe pour les missions techniques.","equipment",1),
            ("drone_parts","Pièces de drone","🤖","Sous-ensembles pour robots de maintenance.","component",200),("sensor_array","Capteur longue portée","📡","Module d'analyse des phénomènes orbitaux.","equipment",5),
            ("meteorite_fragment","Fragment météoritique","☄️","Roche collectée dans la ceinture K-12.","resource",250),("quantum_fiber","Fibre quantique","🧵","Matériau rare pour systèmes avancés.","rare",100),
            ("navigation_chip","Puce de navigation","🧭","Calcule les trajectoires de mission.","component",20),("xeno_artifact","Artefact xéno","🛸","Objet inconnu placé sous quarantaine.","rare",10),
        ]
    ]
    definitions += [
        {"type":"item","key":"station_credit","payload":{"name":"Crédit orbital","emoji":"💳","description":"Unité économique de la station.","category":"currency","stack_limit":999999}},
        {"type":"item","key":"alloy_plate","payload":{"name":"Plaque d'alliage","emoji":"🔩","description":"Matériau de maintenance structurelle.","category":"resource","stack_limit":999}},
        {"type":"item","key":"oxygen_cell","payload":{"name":"Cellule d'oxygène","emoji":"🫧","description":"Réserve vitale pressurisée.","category":"consumable","stack_limit":50}},
        {"type":"item","key":"xeno_crystal","payload":{"name":"Cristal xéno","emoji":"💎","description":"Échantillon rare trouvé hors station.","category":"research","stack_limit":99}},
        {"type":"profession","key":"systems_engineer","payload":{"name":"Ingénieur systèmes","emoji":"🛠️","description":"Maintient les réseaux vitaux et énergétiques.","max_level":20,"experience_per_level":120,"required_item":"engineering_toolkit","grant_required_item":True}},
        {"type":"profession","key":"void_explorer","payload":{"name":"Explorateur spatial","emoji":"🧑‍🚀","description":"Conduit les missions extravéhiculaires.","max_level":20,"experience_per_level":120,"required_item":"eva_suit","grant_required_item":True}},
        {"type":"profession","key":"hydroponist","payload":{"name":"Hydroponiste","emoji":"🌱","description":"Maintient les cultures et les ressources vitales.","max_level":20,"experience_per_level":100,"required_item":"sensor_array","grant_required_item":True}},
        {"type":"profession","key":"xenobiologist","payload":{"name":"Xénobiologiste","emoji":"🧬","description":"Analyse les formes de vie et artefacts inconnus.","max_level":20,"experience_per_level":140,"required_item":"plasma_cutter","grant_required_item":True}},
        {"type":"location","key":"aurora_station","payload":{"name":"Station Aurora","emoji":"🛰️","description":"Habitat orbital principal.","location_type":"special","connections":[]}},
        {"type":"location","key":"command_ring","payload":{"name":"Anneau central","emoji":"🧭","description":"Commandement et communications.","location_type":"place","parent_key":"aurora_station","connections":[{"target":"hydroponic_ring","name":"Monorail intérieur","direction":"bidirectional","visibility":"visible","duration_seconds":20},{"target":"outer_airlock","name":"Coursive pressurisée","direction":"bidirectional","visibility":"visible","duration_seconds":25}]}},
        {"type":"location","key":"hydroponic_ring","payload":{"name":"Anneau hydroponique","emoji":"🌱","description":"Production biologique et recyclage de l'air.","location_type":"place","parent_key":"aurora_station","connections":[{"target":"command_ring","name":"Monorail intérieur","direction":"bidirectional","visibility":"visible","duration_seconds":20}]}},
        {"type":"location","key":"outer_airlock","payload":{"name":"Sas extérieur","emoji":"🚪","description":"Départ des missions hors station.","location_type":"gate","parent_key":"aurora_station","connections":[{"target":"command_ring","name":"Coursive pressurisée","direction":"bidirectional","visibility":"visible","duration_seconds":25},{"target":"asteroid_field","name":"Trajectoire navette","direction":"bidirectional","visibility":"discovered","duration_seconds":180}]}},
        {"type":"location","key":"asteroid_field","payload":{"name":"Champ d'astéroïdes K-12","emoji":"☄️","description":"Zone d'exploration et de collecte.","location_type":"wilderness","connections":[{"target":"outer_airlock","name":"Trajectoire navette","direction":"bidirectional","visibility":"visible","duration_seconds":180}]}},
        {"type":"building","key":"command_deck","payload":{"name":"Pont de commandement","emoji":"🖥️","description":"Supervision des opérations de la station.","location_key":"command_ring","entity_kind":"room","color":"4338ca","modules":{"products":[{"item_key":"oxygen_cell","price":8,"initial_stock":30},{"item_key":"nutrient_gel","price":6,"initial_stock":30},{"item_key":"medical_pack","price":15,"initial_stock":12}]},"actions":[{"key":"daily_briefing","name":"Consulter le briefing","emoji":"📡","effects":[{"type":"message","text":"Les systèmes sont synchronisés. Consultez les événements actifs avant votre mission."}]},{"key":"crew_allocation","name":"Recevoir l'allocation d'équipage","emoji":"💳","conditions":{"type":"cooldown_available","key":"crew_allocation","seconds":86400},"effects":[{"type":"reward","resource":"money","amount":10},{"type":"message","text":"Dix crédits orbitaux sont crédités sur votre compte."}]}]}},
        {"type":"building","key":"engineering_bay","payload":{"name":"Baie d'ingénierie","emoji":"🛠️","description":"Maintenance et fabrication de la station.","location_key":"command_ring","entity_kind":"room","color":"0891b2","relations":{"primary_profession_key":"systems_engineer"},"actions":[{"key":"join_engineering","name":"Devenir ingénieur","emoji":"🛠️","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"systems_engineer"},{"type":"message","text":"Votre accès technique est activé."}]},{"key":"salvage_alloy","name":"Recycler des composants","emoji":"🔩","conditions":{"type":"profession_active","profession":"systems_engineer"},"effects":[{"type":"cost","resource":"energy","amount":4},{"type":"reward","resource":"alloy_plate","amount":2},{"type":"profession_experience","profession":"systems_engineer","amount":10}]}]}},
        {"type":"building","key":"expedition_airlock","payload":{"name":"Centre d'exploration","emoji":"🚀","description":"Prépare les expéditions dans le vide.","location_key":"outer_airlock","entity_kind":"room","color":"7c3aed","relations":{"primary_profession_key":"void_explorer"},"actions":[{"key":"join_explorers","name":"Devenir explorateur","emoji":"🧑‍🚀","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"void_explorer"},{"type":"message","text":"Votre certification extravéhiculaire est active."}]},{"key":"survey_asteroids","name":"Explorer K-12","emoji":"☄️","conditions":{"type":"profession_active","profession":"void_explorer"},"effects":[{"type":"cost","resource":"energy","amount":8},{"type":"random_result","outcomes":[{"name":"Récupération standard","weight":8,"effects":[{"type":"reward","resource":"alloy_plate","amount":2},{"type":"profession_experience","profession":"void_explorer","amount":12}]},{"name":"Découverte xéno","weight":2,"effects":[{"type":"reward","resource":"xeno_crystal","amount":1},{"type":"profession_experience","profession":"void_explorer","amount":30},{"type":"emit","event":"space.xeno_discovered"},{"type":"message","text":"Un cristal inconnu a été sécurisé."}]}]}]}]}},
        {"type":"building","key":"hydroponics_lab","payload":{"name":"Serres hydroponiques","emoji":"🌱","description":"Cultures, eau et production alimentaire de la station.","location_key":"hydroponic_ring","entity_kind":"room","color":"16a34a","relations":{"primary_profession_key":"hydroponist"},"actions":[{"key":"join_hydroponics","name":"Devenir hydroponiste","emoji":"🌱","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"hydroponist"}]},{"key":"harvest_nutrients","name":"Récolter les cultures","emoji":"🥬","conditions":{"type":"profession_active","profession":"hydroponist"},"effects":[{"type":"cost","resource":"energy","amount":3},{"type":"reward","resource":"nutrient_gel","amount":3},{"type":"reward","resource":"bio_sample","amount":1},{"type":"profession_experience","profession":"hydroponist","amount":10}]}]}},
        {"type":"building","key":"xenoscience_lab","payload":{"name":"Laboratoire xénoscientifique","emoji":"🧬","description":"Analyse sécurisée des échantillons extraterrestres.","location_key":"command_ring","entity_kind":"room","color":"7c3aed","relations":{"primary_profession_key":"xenobiologist"},"actions":[{"key":"join_xenoscience","name":"Devenir xénobiologiste","emoji":"🧬","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"xenobiologist"}]},{"key":"analyze_sample","name":"Analyser un échantillon","emoji":"🔬","conditions":{"type":"profession_active","profession":"xenobiologist"},"effects":[{"type":"cost","resource":"bio_sample","amount":1},{"type":"profession_experience","profession":"xenobiologist","amount":18},{"type":"random_result","outcomes":[{"name":"Données exploitables","weight":8,"effects":[{"type":"reward","resource":"data_core","amount":1}]},{"name":"Percée xéno","weight":2,"effects":[{"type":"reward","resource":"xeno_artifact","amount":1},{"type":"emit","event":"space.xeno_breakthrough"}]}]}]}]}},
        {"type":"environment","key":"orbital_environment","payload":{"name":"Environnement orbital","emoji":"🌌","description":"Cycles de bord et phénomènes spatiaux.","mode":"weighted","hour":6,"minute":0,"conditions":[{"key":"stable_orbit","name":"Orbite stable","emoji":"🌌","weight":6},{"key":"solar_storm","name":"Tempête solaire","emoji":"☀️","weight":2},{"key":"debris_alert","name":"Alerte débris","emoji":"☄️","weight":2}],"calendar":{"name":"Temps de mission","weekdays":["Quart Alpha","Quart Bêta","Quart Gamma","Maintenance"],"months":[{"key":"cycle_one","name":"Cycle 1","days":20},{"key":"cycle_two","name":"Cycle 2","days":20},{"key":"cycle_three","name":"Cycle 3","days":20}],"seasons":[]}}},
        {"type":"event","key":"solar_emergency","payload":{"name":"Tempête solaire","emoji":"☀️","description":"Les radiations perturbent les sorties et l'énergie.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"exploration.energy_cost","operator":"multiply","value":1.5,"scope":"world"}],"effects":[]}},
        {"type":"event","key":"debris_wave","payload":{"name":"Vague de débris","emoji":"☄️","description":"Les coursives extérieures passent en état d'alerte.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"activity.duration","operator":"multiply","value":1.4,"scope":"building","targets":["expedition_airlock"]}],"effects":[]}},
        {"type":"event","key":"hydroponic_bloom","payload":{"name":"Floraison hydroponique","emoji":"🌺","description":"Une croissance exceptionnelle augmente la production alimentaire.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"production.quantity","operator":"multiply","value":1.5,"scope":"building","targets":["hydroponics_lab"]}],"effects":[]}},
        {"type":"event","key":"xeno_signal","payload":{"name":"Signal xéno","emoji":"📡","description":"Un signal inconnu stimule la recherche et inquiète l'équipage.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"profession.experience","operator":"multiply","value":1.25,"scope":"building","targets":["xenoscience_lab"]}],"effects":[]}},
        {"type":"bot","key":"station_ai","payload":{"name":"AURORA","emoji":"🧠","description":"Intelligence d'assistance Discord de la station.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Surveille les systèmes orbitaux","modules":["buildings","profiles","events","weather"]}},
    ]
    return definitions
