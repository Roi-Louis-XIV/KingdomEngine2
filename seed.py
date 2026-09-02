"""Contenu de démonstration minimal, créé uniquement dans une base vide."""

from KingdomData.server_settings import default_server_settings
from KingdomData.interfaces import interface_from_building

DEFINITIONS = [
    {"type":"server_settings","key":"kingdom_server","payload":default_server_settings()},
    {"type":"item","key":"gold_coin","payload":{"name":"écus","emoji":"🪙","description":"Monnaie du Royaume.","stack_limit":999999}},
    {"type":"item","key":"raw_wood","payload":{"name":"Bois brut","emoji":"🪵","description":"Ressource récoltée en forêt.","stack_limit":999}},
    {"type":"building","key":"village_square","payload":{"name":"Place du village","emoji":"⛲","description":"Le point de rencontre de tous les aventuriers.","color":"7c5cff","actions":[{"key":"daily_gift","name":"Cadeau du jour","emoji":"🎁","effects":[{"type":"reward","resource":"money","amount":10},{"type":"message","text":"Le Royaume vous offre 10 pièces."},{"type":"emit","event":"village.gift.claimed"}]}]}},
    {"type":"building","key":"royal_forest","payload":{"name":"Forêt royale","emoji":"🌲","description":"Récoltez des ressources dans les bois.","color":"22c55e","actions":[{"key":"chop_wood","name":"Couper du bois","emoji":"🪓","effects":[{"type":"cost","resource":"energy","amount":5},{"type":"random_reward","choices":[{"item":"raw_wood","min":1,"max":3,"weight":10}]},{"type":"message","text":"Vous revenez de la forêt avec du bois."},{"type":"emit","event":"forest.wood.chopped"}]}]}},
    {"type":"event","key":"harvest_festival","payload":{"name":"Fête des récoltes","emoji":"🌾","description":"Exemple d’événement saisonnier.","trigger":{"type":"manual"},"effects":[]}},
    {"type":"bot","key":"kingdom_guardian","payload":{"name":"Gardien du Royaume","emoji":"🤖","description":"Bot textuel principal.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Veille sur le Royaume","modules":["buildings","profiles"]}},
    {"type":"audio","key":"forest_chop_sound","payload":{"name":"Coup de hache","emoji":"🔊","description":"Réaction sonore de la forêt.","source":"assets/forest/axe.mp3","triggers":["forest.wood.chopped"],"volume":0.7}},
]

# Cette définition n'est jamais semée dans un royaume. KingdomWeb l'expose
# comme une démonstration isolée et non enregistrable depuis l'Académie.
REFERENCE_BUILDING = {
    "name": "Atelier-école no-code", "emoji": "🎓", "color": "22c55e",
    "description": "Laboratoire pédagogique isolé : découvrez les principales primitives no-code sans toucher à votre royaume.",
    "source": "KingdomEngine 2", "is_reference": True, "action_mode": "generated",
    "academy_showcase": {
        "promise": "Comprendre comment une idée devient une expérience Discord, sans écrire de code.",
        "chapters": [
            {"key": "overview", "icon": "🧭", "name": "Vue d'ensemble", "tab": "overview", "summary": "Identité, modules actifs et parcours du joueur."},
            {"key": "gameplay", "icon": "⚙️", "name": "Fonctionnement", "tab": "mechanics", "summary": "Deux métiers, zones, outils, niveaux, cooldowns et résultats multi-effets."},
            {"key": "discord", "icon": "🧩", "name": "Interface Discord", "tab": "visual", "summary": "Pages, navigation, inventaires et boutons visibles selon la situation du joueur."},
            {"key": "relations", "icon": "↔️", "name": "Relations", "tab": "relations", "summary": "Objets produits, consommés, livrés et dépendances entre bâtiments."},
            {"key": "audio", "icon": "🔊", "name": "Audio", "tab": "sound", "summary": "Ambiance globale, SFX d'action et changement d'atmosphère par événement."},
            {"key": "advanced", "icon": "🧰", "name": "Boîte à outils", "tab": "advanced", "summary": "Réparation, amélioration, stock collectif et configuration détaillée."},
        ],
        "player_journey": [
            "Choisir un métier : Artisan ou Explorateur",
            "Débloquer une zone selon son niveau et son outil",
            "Lancer une activité temporisée avec énergie, usure et cooldown",
            "Recevoir un résultat pondéré combinant objet, XP, message et événement",
            "Transformer, vendre, livrer ou stocker la production",
        ],
        "guarantees": ["Lecture seule", "Hors de tous les royaumes", "Jamais publié sur Discord"],
    },
    "modules": {
        "professions": [{
            "key": "academy_apprentice", "name": "Artisan stagiaire", "emoji": "🎓",
            "description": "Métier pédagogique montrant niveaux, expérience et accès exclusif.",
            "experience_per_level": 100, "max_level": 10, "grant_required_item": False,
        }, {
            "key": "academy_explorer", "name": "Explorateur stagiaire", "emoji": "🧭",
            "description": "Second métier démontrant que plusieurs parcours indépendants cohabitent dans un bâtiment.",
            "required_item": "training_compass", "tool_level": 1,
            "initial_durability": 40, "max_durability": 40, "grant_required_item": True,
            "experience_per_level": 80, "max_level": 5,
        }],
        "activities": [{
            "key": "training_expedition", "name": "Expédition d'entraînement", "emoji": "🧭",
            "description": "Une activité temporisée avec coût, niveau, résultats pondérés et effets multiples.",
            "profession": "academy_apprentice", "required_level": 1, "duration_seconds": 10,
            "energy_cost": 2, "cooldown_seconds": 15, "limit_scope": "player_action",
            "destination": "player", "outcomes": [
                {"name": "Exercice réussi", "weight": 8, "effects": [
                    {"type": "reward", "resource": "raw_wood", "amount": 2},
                    {"type": "profession_experience", "profession": "academy_apprentice", "amount": 10},
                    {"type": "message", "text": "Exercice réussi : bois et expérience gagnés."},
                ]},
                {"name": "Trouvaille rare", "weight": 2, "effects": [
                    {"type": "stock_reward", "resource": "raw_wood", "amount": 4},
                    {"type": "profession_experience", "profession": "academy_apprentice", "amount": 25},
                    {"type": "emit", "event": "academy.rare_result"},
                    {"type": "message", "text": "Trouvaille rare : stock, XP et événement appliqués ensemble."},
                ]},
            ],
        }, {
            "key": "advanced_exploration", "name": "Exploration avancée", "emoji": "🔭",
            "description": "Zone verrouillée avant le niveau 2, avec outil, durabilité, limite par catégorie et production en stock.",
            "profession": "academy_explorer", "tool": "training_compass", "required_level": 2,
            "duration_seconds": 30, "energy_cost": 5, "cooldown_seconds": 45,
            "durability_cost": 3, "minimum_durability": 3, "tool_max_durability": 40,
            "activity_limit": {"scope": "category", "max_active": 1, "category": "academy_expedition"},
            "destination": "building_stock", "outcomes": [
                {"name": "Relevé cartographique", "weight": 7, "effects": [
                    {"type": "stock_reward", "resource": "academy_fragment", "amount": 2},
                    {"type": "profession_experience", "profession": "academy_explorer", "amount": 15},
                    {"type": "message", "text": "La carte de l'atelier s'enrichit."},
                ]},
                {"name": "Découverte exceptionnelle", "weight": 1, "effects": [
                    {"type": "reward", "resource": "academy_relic", "amount": 1},
                    {"type": "profession_experience", "profession": "academy_explorer", "amount": 40},
                    {"type": "emit", "event": "academy.discovery"},
                    {"type": "message", "text": "Une découverte rare déclenche plusieurs effets simultanés."},
                ]},
            ],
        }],
        "products": [{"item_key": "raw_wood", "price": 5, "initial_stock": 20, "max_stock": 100}],
        "recipes": [{
            "key": "training_bundle", "name": "Lot d'entraînement", "emoji": "📦",
            "ingredients": {"raw_wood": 2},
            "output_item_key": "raw_wood", "output_quantity": 1, "duration_seconds": 5,
        }],
        "deliveries": [{
            "key": "academy_delivery", "name": "Livraison pédagogique", "item_key": "raw_wood",
            "minimum_quantity": 1, "maximum_quantity": 10, "target_building_key": "village_square",
            "source": "player_inventory", "destination": "building_stock", "unit_price": 2,
        }],
        "repairs": {"training_compass_price_per_point": 1, "durability": {"training_compass": 40}},
        "upgrades": [{
            "tool_key": "training_compass", "from_level": 1, "to_level": 2,
            "name": "Boussole pédagogique renforcée", "price": 25,
            "max_durability": 70, "loot_bonus": 5, "ingredients": {"academy_fragment": 3},
        }],
        "audio": {
            "default_group_key": "global_ambience", "groups": [{
                "key": "global_ambience", "name": "Ambiance de l'atelier", "volume": 0.7,
                "tracks": {"music": [], "ambience": ["forest_chop_sound"], "sfx": [], "voice": []},
            }, {
                "key": "academy_discovery", "name": "Découverte mystérieuse", "volume": 0.8,
                "tracks": {"music": [], "ambience": [], "sfx": ["forest_chop_sound"], "voice": []},
            }], "event_routes": [{"event": "academy.discovery", "group_key": "academy_discovery"}],
        },
    },
    "relations": {"primary_profession_key": "academy_apprentice", "ambience_audio_key": "forest_chop_sound"},
    "actions": [
        {"key": "join_apprentice", "name": "Devenir Artisan stagiaire", "emoji": "📜",
         "conditions": {"type": "no_active_profession"},
         "effects": [{"type": "profession_join", "profession": "academy_apprentice"}, {"type": "message", "text": "Bienvenue à l'atelier-école."}]},
        {"key": "training_expedition", "name": "Lancer un exercice", "emoji": "🧭", "duration_seconds": 10,
         "conditions": {"type": "profession_active", "profession": "academy_apprentice"},
         "effects": [{"type": "play_audio", "audio_key": "forest_chop_sound"}, {"type": "cost", "resource": "energy", "amount": 2}, {"type": "schedule", "delay_seconds": 10, "effects": [
             {"type": "random_result", "outcomes": [
                 {"weight": 8, "name": "Réussite", "effects": [{"type": "reward", "resource": "raw_wood", "amount": 2}, {"type": "profession_experience", "profession": "academy_apprentice", "amount": 10}, {"type": "message", "text": "Exercice réussi : bois et expérience gagnés."}]},
                 {"weight": 2, "name": "Trouvaille rare", "effects": [{"type": "reward", "resource": "raw_wood", "amount": 4}, {"type": "profession_experience", "profession": "academy_apprentice", "amount": 25}, {"type": "message", "text": "Belle trouvaille ! Plusieurs effets ont été appliqués."}]}
             ]}
         ]}]},
        {"key": "leave_apprentice", "name": "Démissionner", "emoji": "🚪",
         "conditions": {"type": "profession_active", "profession": "academy_apprentice"},
         "effects": [{"type": "profession_leave", "profession": "academy_apprentice"}, {"type": "message", "text": "Tu as quitté le métier de démonstration."}]},
        {"key": "join_explorer", "name": "Devenir Explorateur stagiaire", "emoji": "🧭",
         "conditions": {"type": "no_active_profession"},
         "effects": [{"type": "profession_join", "profession": "academy_explorer"}, {"type": "tool_grant", "tool": "training_compass", "max_durability": 40}, {"type": "message", "text": "La boussole d'entraînement vous est confiée."}]},
        {"key": "repair_compass", "name": "Réparer la boussole", "emoji": "🛠️",
         "conditions": {"type": "profession_active", "profession": "academy_explorer"},
         "effects": [{"type": "repair", "tool": "training_compass", "max_durability": 40, "price_per_point": 1}]},
    ],
    "interface": {
        "name": "Interface · Atelier-école no-code", "target_building_key": "nocode_academy",
        "start_page": "home", "entry_page": "home", "theme": {"color": "22c55e"},
        "profession_labels": {"academy_apprentice": "Artisan stagiaire"},
        "pages": [
            {"key": "home", "name": "Découvrir le moteur", "components": [
                {"id": "academy_hero", "type": "hero", "props": {"title": "Atelier-école no-code", "emoji": "🎓", "subtitle": "Teste les primitives puis ouvre ce bâtiment dans KingdomWeb pour comprendre leur configuration."}},
                {"id": "academy_help", "type": "card", "props": {"title": "Ce modèle montre", "text": "Un métier exclusif, des boutons conditionnels, une activité temporisée, un résultat pondéré multi-effets, de l'XP et des inventaires."}},
                {"id": "academy_join", "type": "button", "slot": 0, "props": {"label": "Devenir Artisan stagiaire", "emoji": "📜", "style": "success"}, "interaction": {"type": "action", "building": "nocode_academy", "action": "join_apprentice"}},
                {"id": "academy_training", "type": "button", "slot": 1, "props": {"label": "Lancer un exercice", "emoji": "🧭", "style": "primary"}, "interaction": {"type": "action", "building": "nocode_academy", "action": "training_expedition"}},
                {"id": "academy_leave", "type": "button", "slot": 2, "props": {"label": "Démissionner", "emoji": "🚪", "style": "danger"}, "interaction": {"type": "action", "building": "nocode_academy", "action": "leave_apprentice"}},
                {"id": "academy_inventory", "type": "player_inventory", "props": {"title": "Inventaire du joueur"}},
                {"id": "academy_stock", "type": "building_inventory", "props": {"title": "Stock du bâtiment"}},
                {"id": "academy_refresh", "type": "button", "slot": 5, "props": {"label": "Actualiser", "emoji": "🔄", "style": "secondary"}, "interaction": {"type": "refresh"}}
            ]},
            {"key": "professions", "name": "Choisir un parcours", "components": [
                {"id": "academy_jobs_title", "type": "card", "props": {"title": "Deux métiers, deux progressions", "text": "Les conditions masquent automatiquement les choix incompatibles avec le métier actif."}},
                {"id": "academy_jobs_menu", "type": "select", "props": {"placeholder": "Choisir un métier", "options": [{"label": "Artisan stagiaire", "value": "join_apprentice", "emoji": "🎓"}, {"label": "Explorateur stagiaire", "value": "join_explorer", "emoji": "🧭"}]}, "interaction": {"type": "action_select", "building": "nocode_academy"}},
                {"id": "academy_jobs_back", "type": "button", "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}}
            ]},
            {"key": "workshop", "name": "Atelier et stock", "components": [
                {"id": "academy_workshop_title", "type": "card", "props": {"title": "Économie et équipement", "text": "Production joueur ou stock, recette, commerce, livraison, réparation et amélioration utilisent les mêmes primitives génériques."}},
                {"id": "academy_workshop_stock", "type": "building_inventory", "props": {"title": "Stock pédagogique"}},
                {"id": "academy_workshop_back", "type": "button", "props": {"label": "Retour", "emoji": "↩️", "style": "secondary"}, "interaction": {"type": "navigate", "page": "home"}}
            ]}
        ]
    }
}

# Les bâtiments natifs utilisent le même document unifié que ceux créés dans
# KingdomWeb. Les anciennes entités `interface` restent uniquement un format de
# compatibilité pour les bases déjà existantes.
for _definition in DEFINITIONS:
    if _definition["type"] == "building" and "interface" not in _definition["payload"]:
        _definition["payload"]["interface"] = interface_from_building(
            _definition["key"], _definition["payload"], _definition["payload"].get("actions", [])
        )
