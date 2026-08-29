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
    "description": "Bâtiment de référence : métier, conditions, activité, hasard, XP, inventaires et navigation.",
    "source": "KingdomEngine 2", "is_reference": True, "action_mode": "generated",
    "modules": {
        "professions": [{
            "key": "academy_apprentice", "name": "Artisan stagiaire", "emoji": "🎓",
            "description": "Métier pédagogique montrant niveaux, expérience et accès exclusif.",
            "experience_per_level": 100, "max_level": 10, "grant_required_item": False,
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
        "audio": {
            "default_group_key": "global_ambience", "groups": [{
                "key": "global_ambience", "name": "Ambiance de l'atelier", "volume": 0.7,
                "tracks": {"music": [], "ambience": ["forest_chop_sound"], "sfx": [], "voice": []},
            }], "event_routes": [],
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
