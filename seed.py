"""Contenu de démonstration minimal, créé uniquement dans une base vide."""

DEFINITIONS = [
    {"type":"item","key":"gold_coin","payload":{"name":"écus","emoji":"🪙","description":"Monnaie du Royaume.","stack_limit":999999}},
    {"type":"item","key":"raw_wood","payload":{"name":"Bois brut","emoji":"🪵","description":"Ressource récoltée en forêt.","stack_limit":999}},
    {"type":"building","key":"village_square","payload":{"name":"Place du village","emoji":"⛲","description":"Le point de rencontre de tous les aventuriers.","color":"7c5cff","actions":[{"key":"daily_gift","name":"Cadeau du jour","emoji":"🎁","effects":[{"type":"reward","resource":"money","amount":10},{"type":"message","text":"Le Royaume vous offre 10 pièces."},{"type":"emit","event":"village.gift.claimed"}]}]}},
    {"type":"building","key":"royal_forest","payload":{"name":"Forêt royale","emoji":"🌲","description":"Récoltez des ressources dans les bois.","color":"22c55e","actions":[{"key":"chop_wood","name":"Couper du bois","emoji":"🪓","effects":[{"type":"cost","resource":"energy","amount":5},{"type":"random_reward","choices":[{"item":"raw_wood","min":1,"max":3,"weight":10}]},{"type":"message","text":"Vous revenez de la forêt avec du bois."},{"type":"emit","event":"forest.wood.chopped"}]}]}},
    {"type":"event","key":"harvest_festival","payload":{"name":"Fête des récoltes","emoji":"🌾","description":"Exemple d’événement saisonnier.","trigger":{"type":"manual"},"effects":[]}},
    {"type":"bot","key":"kingdom_guardian","payload":{"name":"Gardien du Royaume","emoji":"🤖","description":"Bot textuel principal.","bot_type":"text","token_env":"KINGDOM_CORE_TOKEN","application_id_env":"KINGDOM_APPLICATION_ID","enabled":True,"presence":"Veille sur le Royaume","modules":["buildings","profiles"]}},
    {"type":"audio","key":"forest_chop_sound","payload":{"name":"Coup de hache","emoji":"🔊","description":"Réaction sonore de la forêt.","source":"assets/forest/axe.mp3","triggers":["forest.wood.chopped"],"volume":0.7}},
]
