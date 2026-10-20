# Bâtiments V1 — inventaire fonctionnel et correspondance V2

Sources : archive `KingdomEngine.zip` et dossier `KingdomData` fournis par Louis.
L'archive contient 116 fichiers Python, les vues, services, repositories,
migrations, tests, configurations Voice et médias. Les secrets `.env`, les
comptes et historiques joueurs ne sont pas des contenus à migrer.
Les JSON de gameplay, absents du ZIP, ont été fournis séparément.

## Taverne — Edgar

Sources : `views/tavern_views.py`, `repositories/tavern_*`,
`services/tavern_*`, `buildings/tavern.json`, `tavern_rumors.json`.

| Fonction constatée | Comportement V1 | Correspondance V2 avant enrichissement |
|---|---|---|
| Hall | Commander, stock, rumeurs, jeux, Edgar, quitter ; retours | A : pages, navigation et fermeture |
| Comptoir | 22 produits, 4 catégories ; prix 4–12 écus, stocks initiaux 8–25 | A/D : produits et sélecteurs ; catalogue différent |
| Consommation | Achat dans le sac, consommation distincte ; décrément unique | A : purchase/consumption |
| Garde-manger | Ingrédients distingués des plats ; quantités nulles visibles | A/B : inventaire bâtiment, filtrage à vérifier |
| Métier | Cuisinier exclusif, recrutement, démission confirmée ; refus pendant préparation | A : professions, exigences et tâches différées |
| Missions | Accepter une préparation ouverte, réservée à un seul joueur ; une seule en cours ; réclamer après délai | B : recettes temporisées ; réservation commune de mission distincte |
| Cuisine | Stock bâtiment → ingrédients réservés au départ → stock bâtiment au résultat | A : recettes avec sources/destinations |
| Rumeurs | 6 textes pondérés, exclusion de la précédente ; 120 s joueur, 10 s global | A/D : random_message et cooldowns persistants |
| Dialogue | Conversation textuelle, navigation vers recrutement/missions/démission | A/D : modules NPC et actions |
| Dés | Couronne face 1–6 ×6 ; Jugement pair/impair ×2 ; Destinée 1–3/4–6 ×2 ; mise 5 | A/D : jeux génériques avec session et confirmation |
| Sécurité dés | Préparation sans débit ; annulation ; propriétaire ; validation et règlement atomiques, pas de double paiement | A : sessions génériques à tester |
| Énergie/alcool | Nourriture +20 énergie, −12 alcool ; bière +18 alcool, vin +24, spiritueux +34 ; boisson alcoolisée +2 énergie | B : statistiques génériques, à raccorder sans doubler l'énergie |

Missions exactes : soupe à l'oignon ×5, 60 s, 12 écus/25 XP ; poulet au miel
×4, 90 s, 18/35 ; pâté de sanglier ×4, 75 s, 16/30 ; saucisses fumées ×4,
70 s, 14/28. Coût constaté dans le repository : 15 énergie. XP/niveau : 100.
Le stock initial d'ingrédients est configuré dans `cook_job`.

## Mine — Roland

Sources : `views/mine_views.py`, `repositories/mine_repository.py`,
`services/mine_service.py`, `buildings/mine.json`.

Recrutement exclusif, pioche novice offerte (20 durabilité), état du métier,
choix de galerie, récupération, inventaire/retour/quitter. Une expédition à
la fois ; refus sans métier, niveau, outil utilisable ou énergie. Butin tiré
au départ, conservé en base, réclamable une seule fois après le timer.
Démission refusée pendant expédition, progression et outil conservés ensuite.

| Galerie | Niveau | Secondes | Énergie | Usure | XP | Tirage |
|---|---:|---:|---:|---:|---:|---|
| Carrière extérieure | 1 | 30 | 15 | 1 | 20 | pierre 3–6 (80%), fer 1–2 (20%) |
| Galerie du charbon | 2 | 60 | 25 | 2 | 35 | charbon 3–6 (80%), pierre 1–3 (20%) |
| Filon ferrugineux | 4 | 90 | 35 | 3 | 55 | fer 2–5 (75%), charbon 1–3 (20%), pierre 2–4 (5%) |

A : activités/outcomes, requirements, outils, pending_actions, inventaire.
D : textes de Roland, galeries et probabilités. Le template actuel propose
des extractions simplifiées : il faut ajouter ces choix sans dupliquer la Mine.

## Forêt — Sylvain

Sources : `views/forest_views.py`, `repositories/forest_repository.py`,
`services/forest_service.py`, `buildings/forest.json`.

Deux métiers exclusifs : Bûcheron (hache simple requise), Chasseur (arc courbé
requis). Expédition unique, niveau minimal, énergie, usure, tirage au départ,
récupération dans le sac, XP, refus de démission tant qu'une expédition court.
Hache : 80 durabilité ; arc : 90 et usure 1 par chasse. Dialogue : 5 phrases.

| Voie/zone | Niveau | Durée | Énergie | Usure | XP | Résultats |
|---|---:|---:|---:|---:|---:|---|
| Lisière royale | 1 | 30 | 12 | 2 | 20 | bois normal 85%, bois fin 15% |
| Sous-bois ancien | 2 | 60 | 20 | 3 | 35 | normal 70%, fin 30% |
| Chênaie profonde | 4 | 90 | 30 | 4 | 55 | normal 55%, fin 45% |
| Clairière | 1 | 30 | 12 | 1 | 20 | échec 20%, gibier 70%, herbes 10% |
| Bois touffu | 2 | 60 | 20 | 1 | 35 | échec 15%, gibier 70%, exceptionnel 15% |
| Forêt profonde | 4 | 90 | 30 | 1 | 55 | échec 20%, gibier 55%, sanglier 25% |

A : activités génériques. B/D : métier Chasseur séparé, zones et contenus à
raccorder aux identifiants existants (`forester_lodge`, `forester`, `sylvain`).

## Forge Dorée — Wagner

Sources : `views/forge_views.py`, `repositories/forge_repository.py`,
`services/forge_service.py`, `buildings/forge.json`.

Accueil, boutique, stock, espace métier, recettes par catégorie, réparation
avec sélection de l'équipement et confirmation, amélioration de pioche,
livraison, conversation, retour/quitter. 8 produits, stock initial 4 chacun.
Fabrication : métier/niveau, énergie, ingrédients du stock, attente puis
récupération dans le stock ; écus et XP au travailleur. Achat : stock −1,
argent débité, objet dans le sac. Réparation : coût par point manquant,
refus si outil absent, déjà neuf ou bourse insuffisante.

Recettes V1 : pioche 60 s/niv.1/15 énergie/12 écus/25 XP ; épée 75 s/1/18/18/35 ;
hache 70 s/2/18/15/30 ; hallebarde 110 s/3/25/28/55.
Amélioration novice → renforcée : 30 écus, 3 fer +1 bois du sac, durabilité 40,
bonus de butin +1. Réparation pioche novice : 2 écus/point ; équipement : 1.
Durabilités : épée 100, hallebarde 120, arc 90, espadon 150, pioche/hache 80,
lanterne 60. Les lingots cuivre/argent/or ne figurent PAS dans cette V1.

A : recettes, stock, commerce, repair/upgrade ; D : catalogue/valeurs.

## Livraison et garanties transversales

`delivery_views.py` : sélectionner une ressource possédée → destinataire parmi
les acheteurs configurés → quantité saisie (1..stock personnel) → confirmation.
`delivery_service.py` restreint les ressources/destinations. Repository :
transaction immédiate, identifiant d'interaction obligatoire et unique,
quantité positive, prix non négatif, objet/destinataire existants, stock suffisant ;
débit sac, crédit stock destinataire, salaire `quantité × prix`, historique.
Les anciens raccourcis Forêt/Forge livrent tout ; le sélecteur universel permet
une quantité. Les prix du marché universel diffèrent des raccourcis historiques :
ne pas les fusionner silencieusement (ex. fer → Forge : 9 contre 5).

A : execute_delivery, sélection dynamique et transactions V2.
A : inventaire, stock, professions exclusives, tâches persistées, idempotence.
B : énergie générique existante ; ivresse V1 complète (tolérance, titres,
gueule de bois, incidents) dépasse une simple jauge d'alcool et doit être
signalée si non reprise. V1 : énergie max100/+10h, alcool −4h, ivresse30min,
gueule de bois4h/max80 ; tolérance décroissante après7jours.

## Périmètre et décision de migration

Ne pas recopier les repositories V1, les tokens, les bases de joueurs, ni les
IDs Discord. Réutiliser le compilateur `actions_from_modules`, le moteur et
les composants no-code V2. Conserver tous les IDs V2 des bâtiments et PNJ.
Ajouter les données normalisées dans le paquet V2 : aucune lecture runtime
du dossier V1. Préserver le scénario et les mondes déjà instanciés.
La couverture finale et les limites doivent être mesurées dans le rapport,
sans assimiler une recette réutilisable à une mission partagée à exemplaire unique.
