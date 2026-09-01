"""Packs de démarrage génériques proposés lors de la création d'un monde.

Ces packs ne changent jamais le moteur : ils ne contiennent que des entités
no-code publiées dans la nouvelle base KingdomData.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .server_settings import default_server_settings


PRESET_CATALOG = [
    {"key": "blank", "name": "Monde vierge", "emoji": "◇", "description": "Une configuration propre, sans lieu ni mécanique imposée.", "tone": "neutral"},
    {"key": "medieval_kingdom", "name": "Royaume médiéval", "emoji": "🏰", "description": "Village, forêt, mine, métiers, économie, météo et événement saisonnier.", "tone": "emerald"},
    {"key": "space_station", "name": "Station spatiale", "emoji": "🛰️", "description": "Pont de commandement, hydroponie, exploration, crédits et météo spatiale.", "tone": "violet"},
]


def world_preset(key: str) -> list[dict[str, Any]]:
    builders = {"blank": _blank, "medieval_kingdom": _medieval, "space_station": _space}
    if key not in builders:
        raise ValueError("Modèle de monde inconnu.")
    return deepcopy(builders[key]())


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
    definitions += [
        {"type":"item","key":"crown_coin","payload":{"name":"Écu","emoji":"🪙","description":"Monnaie commune du royaume.","category":"currency","stack_limit":999999}},
        {"type":"item","key":"oak_timber","payload":{"name":"Bois de chêne","emoji":"🪵","description":"Bois solide récolté dans les forêts.","category":"resource","stack_limit":999}},
        {"type":"item","key":"iron_ore","payload":{"name":"Minerai de fer","emoji":"⛓️","description":"Minerai destiné aux artisans.","category":"resource","stack_limit":999}},
        {"type":"item","key":"village_bread","payload":{"name":"Pain du village","emoji":"🍞","description":"Restaure les forces des voyageurs.","category":"food","stack_limit":50,"price":6}},
        {"type":"profession","key":"forester","payload":{"name":"Forestier","emoji":"🪓","description":"Récolte et protège les ressources forestières.","max_level":20,"experience_per_level":100}},
        {"type":"profession","key":"miner","payload":{"name":"Mineur","emoji":"⛏️","description":"Explore les galeries et extrait les minerais.","max_level":20,"experience_per_level":100}},
        {"type":"location","key":"green_realm","payload":{"name":"Le Royaume Vert","emoji":"🗺️","description":"Territoire principal du monde.","location_type":"kingdom","connections":[]}},
        {"type":"location","key":"riverhold","payload":{"name":"Val-Rivière","emoji":"🏘️","description":"Capitale bâtie autour de la grande place.","location_type":"city","parent_key":"green_realm","connections":[{"target":"whispering_woods","name":"Chemin forestier","direction":"bidirectional","visibility":"visible","duration_seconds":60},{"target":"iron_hills","name":"Route des collines","direction":"bidirectional","visibility":"visible","duration_seconds":90}]}},
        {"type":"location","key":"whispering_woods","payload":{"name":"Bois Murmurants","emoji":"🌲","description":"Forêt ancienne riche en bois et en secrets.","location_type":"forest","parent_key":"green_realm","connections":[{"target":"riverhold","name":"Chemin forestier","direction":"bidirectional","visibility":"visible","duration_seconds":60}]}},
        {"type":"location","key":"iron_hills","payload":{"name":"Collines de Fer","emoji":"⛰️","description":"Massif parcouru de galeries minières.","location_type":"mountain","parent_key":"green_realm","connections":[{"target":"riverhold","name":"Route des collines","direction":"bidirectional","visibility":"visible","duration_seconds":90}]}},
        {"type":"building","key":"market_square","payload":{"name":"Grande Place","emoji":"⛲","description":"Centre social et commercial de la capitale.","location_key":"riverhold","entity_kind":"place","color":"c3913a","actions":[{"key":"welcome_gift","name":"Recevoir son viatique","emoji":"🎁","conditions":{"type":"cooldown_available","key":"welcome_gift","seconds":86400},"effects":[{"type":"reward","resource":"money","amount":10},{"type":"message","text":"La cité vous confie 10 écus pour votre voyage."}]}]}},
        {"type":"building","key":"forester_lodge","payload":{"name":"Maison des Forestiers","emoji":"🌲","description":"Point de départ des expéditions dans les bois.","location_key":"whispering_woods","entity_kind":"institution","color":"2f855a","relations":{"primary_profession_key":"forester"},"actions":[{"key":"join_foresters","name":"Devenir forestier","emoji":"🪓","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"forester"},{"type":"message","text":"Vous rejoignez la corporation des forestiers."}]},{"key":"gather_timber","name":"Explorer la lisière","emoji":"🌲","conditions":{"type":"profession_active","profession":"forester"},"effects":[{"type":"cost","resource":"energy","amount":5},{"type":"reward","resource":"oak_timber","amount":2},{"type":"profession_experience","profession":"forester","amount":10},{"type":"message","text":"Vous rapportez du bois de chêne."}]}]}},
        {"type":"building","key":"deep_mine","payload":{"name":"Mine des Collines","emoji":"⛏️","description":"Galeries d'extraction du minerai de fer.","location_key":"iron_hills","entity_kind":"zone","color":"6b7280","relations":{"primary_profession_key":"miner"},"actions":[{"key":"join_miners","name":"Devenir mineur","emoji":"⛏️","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"miner"},{"type":"message","text":"La confrérie des mineurs vous accueille."}]},{"key":"extract_ore","name":"Extraire du minerai","emoji":"⛓️","conditions":{"type":"profession_active","profession":"miner"},"effects":[{"type":"cost","resource":"energy","amount":6},{"type":"reward","resource":"iron_ore","amount":2},{"type":"profession_experience","profession":"miner","amount":12}]}]}},
        {"type":"environment","key":"realm_climate","payload":{"name":"Climat tempéré","emoji":"🌦️","description":"Saisons, météo et calendrier du royaume.","mode":"weighted","hour":8,"minute":0,"conditions":[{"key":"clear","name":"Éclaircies","emoji":"☀️","weight":5},{"key":"rain","name":"Pluie","emoji":"🌧️","weight":3},{"key":"fog","name":"Brume","emoji":"🌫️","weight":2}],"calendar":{"name":"Calendrier royal","weekdays":["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"],"months":[{"key":"springtide","name":"Primeflore","days":30},{"key":"suncrest","name":"Haut-Soleil","days":30},{"key":"harvestfall","name":"Moissons","days":30},{"key":"frostveil","name":"Longue-Nuit","days":30}],"seasons":[{"key":"spring","name":"Printemps","start_month_key":"springtide","start_day":1},{"key":"summer","name":"Été","start_month_key":"suncrest","start_day":1},{"key":"autumn","name":"Automne","start_month_key":"harvestfall","start_day":1},{"key":"winter","name":"Hiver","start_month_key":"frostveil","start_day":1}]} }},
        {"type":"event","key":"harvest_fair","payload":{"name":"Foire des Moissons","emoji":"🌾","description":"Les récoltes et le commerce animent tout le royaume.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"commerce.price","operator":"multiply","value":0.9,"scope":"world"}],"effects":[]}},
        {"type":"bot","key":"realm_steward","payload":{"name":"Intendant du Royaume","emoji":"🛡️","description":"Agent Discord principal du modèle médiéval.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Veille sur le royaume","modules":["buildings","profiles","events","weather"]}},
    ]
    return definitions


def _space() -> list[dict[str, Any]]:
    definitions = _blank()
    definitions[0]["payload"] = _settings("Configuration de la station", "Fondations d'une colonie spatiale persistante.", category="🛰️ ORBITAL NETWORK", player="🧑‍🚀 Équipage", master="🛡️ Commandement", primary="4338ca", accent="22d3ee")
    definitions += [
        {"type":"item","key":"station_credit","payload":{"name":"Crédit orbital","emoji":"💳","description":"Unité économique de la station.","category":"currency","stack_limit":999999}},
        {"type":"item","key":"alloy_plate","payload":{"name":"Plaque d'alliage","emoji":"🔩","description":"Matériau de maintenance structurelle.","category":"resource","stack_limit":999}},
        {"type":"item","key":"oxygen_cell","payload":{"name":"Cellule d'oxygène","emoji":"🫧","description":"Réserve vitale pressurisée.","category":"consumable","stack_limit":50}},
        {"type":"item","key":"xeno_crystal","payload":{"name":"Cristal xéno","emoji":"💎","description":"Échantillon rare trouvé hors station.","category":"research","stack_limit":99}},
        {"type":"profession","key":"systems_engineer","payload":{"name":"Ingénieur systèmes","emoji":"🛠️","description":"Maintient les réseaux vitaux et énergétiques.","max_level":20,"experience_per_level":120}},
        {"type":"profession","key":"void_explorer","payload":{"name":"Explorateur spatial","emoji":"🧑‍🚀","description":"Conduit les missions extravéhiculaires.","max_level":20,"experience_per_level":120}},
        {"type":"location","key":"aurora_station","payload":{"name":"Station Aurora","emoji":"🛰️","description":"Habitat orbital principal.","location_type":"special","connections":[]}},
        {"type":"location","key":"command_ring","payload":{"name":"Anneau central","emoji":"🧭","description":"Commandement et communications.","location_type":"place","parent_key":"aurora_station","connections":[{"target":"hydroponic_ring","name":"Monorail intérieur","direction":"bidirectional","visibility":"visible","duration_seconds":20},{"target":"outer_airlock","name":"Coursive pressurisée","direction":"bidirectional","visibility":"visible","duration_seconds":25}]}},
        {"type":"location","key":"hydroponic_ring","payload":{"name":"Anneau hydroponique","emoji":"🌱","description":"Production biologique et recyclage de l'air.","location_type":"place","parent_key":"aurora_station","connections":[{"target":"command_ring","name":"Monorail intérieur","direction":"bidirectional","visibility":"visible","duration_seconds":20}]}},
        {"type":"location","key":"outer_airlock","payload":{"name":"Sas extérieur","emoji":"🚪","description":"Départ des missions hors station.","location_type":"gate","parent_key":"aurora_station","connections":[{"target":"command_ring","name":"Coursive pressurisée","direction":"bidirectional","visibility":"visible","duration_seconds":25},{"target":"asteroid_field","name":"Trajectoire navette","direction":"bidirectional","visibility":"discovered","duration_seconds":180}]}},
        {"type":"location","key":"asteroid_field","payload":{"name":"Champ d'astéroïdes K-12","emoji":"☄️","description":"Zone d'exploration et de collecte.","location_type":"wilderness","connections":[{"target":"outer_airlock","name":"Trajectoire navette","direction":"bidirectional","visibility":"visible","duration_seconds":180}]}},
        {"type":"building","key":"command_deck","payload":{"name":"Pont de commandement","emoji":"🖥️","description":"Supervision des opérations de la station.","location_key":"command_ring","entity_kind":"room","color":"4338ca","actions":[{"key":"daily_briefing","name":"Consulter le briefing","emoji":"📡","effects":[{"type":"message","text":"Les systèmes sont synchronisés. Consultez les événements actifs avant votre mission."}]}]}},
        {"type":"building","key":"engineering_bay","payload":{"name":"Baie d'ingénierie","emoji":"🛠️","description":"Maintenance et fabrication de la station.","location_key":"command_ring","entity_kind":"room","color":"0891b2","relations":{"primary_profession_key":"systems_engineer"},"actions":[{"key":"join_engineering","name":"Devenir ingénieur","emoji":"🛠️","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"systems_engineer"},{"type":"message","text":"Votre accès technique est activé."}]},{"key":"salvage_alloy","name":"Recycler des composants","emoji":"🔩","conditions":{"type":"profession_active","profession":"systems_engineer"},"effects":[{"type":"cost","resource":"energy","amount":4},{"type":"reward","resource":"alloy_plate","amount":2},{"type":"profession_experience","profession":"systems_engineer","amount":10}]}]}},
        {"type":"building","key":"expedition_airlock","payload":{"name":"Centre d'exploration","emoji":"🚀","description":"Prépare les expéditions dans le vide.","location_key":"outer_airlock","entity_kind":"room","color":"7c3aed","relations":{"primary_profession_key":"void_explorer"},"actions":[{"key":"join_explorers","name":"Devenir explorateur","emoji":"🧑‍🚀","conditions":{"type":"no_active_profession"},"effects":[{"type":"profession_join","profession":"void_explorer"},{"type":"message","text":"Votre certification extravéhiculaire est active."}]},{"key":"survey_asteroids","name":"Explorer K-12","emoji":"☄️","conditions":{"type":"profession_active","profession":"void_explorer"},"effects":[{"type":"cost","resource":"energy","amount":8},{"type":"random_result","outcomes":[{"name":"Récupération standard","weight":8,"effects":[{"type":"reward","resource":"alloy_plate","amount":2},{"type":"profession_experience","profession":"void_explorer","amount":12}]},{"name":"Découverte xéno","weight":2,"effects":[{"type":"reward","resource":"xeno_crystal","amount":1},{"type":"profession_experience","profession":"void_explorer","amount":30},{"type":"emit","event":"space.xeno_discovered"},{"type":"message","text":"Un cristal inconnu a été sécurisé."}]}]}]}]}},
        {"type":"environment","key":"orbital_environment","payload":{"name":"Environnement orbital","emoji":"🌌","description":"Cycles de bord et phénomènes spatiaux.","mode":"weighted","hour":6,"minute":0,"conditions":[{"key":"stable_orbit","name":"Orbite stable","emoji":"🌌","weight":6},{"key":"solar_storm","name":"Tempête solaire","emoji":"☀️","weight":2},{"key":"debris_alert","name":"Alerte débris","emoji":"☄️","weight":2}],"calendar":{"name":"Temps de mission","weekdays":["Quart Alpha","Quart Bêta","Quart Gamma","Maintenance"],"months":[{"key":"cycle_one","name":"Cycle 1","days":20},{"key":"cycle_two","name":"Cycle 2","days":20},{"key":"cycle_three","name":"Cycle 3","days":20}],"seasons":[]}}},
        {"type":"event","key":"solar_emergency","payload":{"name":"Tempête solaire","emoji":"☀️","description":"Les radiations perturbent les sorties et l'énergie.","trigger":{"type":"manual"},"enabled":False,"modifiers":[{"property":"exploration.energy_cost","operator":"multiply","value":1.5,"scope":"world"}],"effects":[]}},
        {"type":"bot","key":"station_ai","payload":{"name":"AURORA","emoji":"🧠","description":"Intelligence d'assistance Discord de la station.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Surveille les systèmes orbitaux","modules":["buildings","profiles","events","weather"]}},
    ]
    return definitions
