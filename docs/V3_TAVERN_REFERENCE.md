# KingdomWeb Next — Taverne V11 : bâtiment de référence

Source analysée : archive utilisateur `edgar_ux_lab_v11(1).zip`, contenant `bot.py` (≈64 Ko), `requirements.txt`, `README.md`. Inventaire statique du prototype, **sans exécution sur Discord**.

## Principe de recette
Le créateur doit pouvoir reproduire **intégralement** le comportement et l'affichage de la V11 **dans l'éditeur** sans saisir ou modifier de code Python/JS/JSON. La Taverne est un *pack de données* composé d'objets génériques, non un nouveau type de bâtiment codé en dur.

## Écrans à composer
1. **Accueil** : nom, décor, répliques du PNJ et variations temporelles ; activités, navigation, profession active, marmites, inventaire.
2. **Boissons** : catalogue filtrable par catégorie et bonus, prix et effets, achat sur place ou à emporter, fiche joueur séparée.
3. **Repas** : même catalogue alimenté par les portions produites ; filtres, état du joueur, achat et consommation.
4. **Cuisine** : statut partagé des marmites, temps restant, plats à produire par priorité, recettes débloquées/réalisables, lancement et récupération.
5. **Parler à Edgar** : arbre de dialogue, variantes conditionnelles, sujets, retours, jeu de dés amical.
6. **Stocks & livraisons** : matières premières en premier, ressources en rupture/critique/faibles, inventaire complet, tarifs dynamiques, vente de ressources rémunérée.

Écrans secondaires de parcours : embauche, démission/confirmation, recettes, confirmation de cuisson, achat/confirmation, inventaire personnel, consommation d'objet, préparation de livraison/confirmation, jeu de dés. **L'éditeur ne doit pas être limité artificiellement à six pages**.

## Bibliothèque d'entités et relations à éditer
- **Monde** contient bâtiments, scénario, joueurs, horloge, états.
- **Bâtiment** référence lieux, inventaire collectif, pages Discord, modules, NPC, métier(s), postes, catalogues.
- **Interface** comporte pages → composants → interactions → conditions/actions.
- **PNJ** référence arbre(s) de dialogue, variantes selon phases du monde, quêtes et voix.
- **Métier** référence joueurs, niveau, XP, compétences, actions autorisées.
- **Recette** référence ingrédients/quantités (objets), niveau métier, temps de préparation, production/portions, expérience.
- **Poste de production** référence recette en cours, initiateur, heure de fin, récupérateur, stock cible.
- **Objet** référence catégories, prix, inventaires, consommable et effets/bonus, éventuelle version transportable.
- **Commerce** référence catalogue, stock, montant, modes de service, prix de rachat calculé, transactions.
- **Quête / scénario** référence événements, conditions, objectifs, états et variables ; la Taverne doit réagir à ces états.
- **État joueur** référence bourse, énergie, alcoolémie, métier actif, progression, inventaire, bonus, sessions.

## Mécaniques test de validation
### Métiers et production
- Un seul métier actif ; démission conserve XP/niveau ; elle n'interrompt pas les cuissons.
- Seuls les cuisiniers actifs manipulent les marmites ; un autre peut récupérer une préparation finie.
- Recettes visibles si débloquées, mais sélectionnables uniquement si réalisables ; contrôle final avant consommation d'ingrédients.
- Stocks d'ingrédients consommés atomiquement ; timer basé sur temps réel ; marmites partagées ; récupération unique.
- XP : 80 % au lancement, 20 % à la récupération (100 % au même joueur si les deux actions).
- Production déposée dans stock commun ; indicateur de priorité selon niveau de réserve souhaité, en tenant compte du contenu des marmites.
### Commerce / stocks
- Stockage illimité ; objectifs de réserve **non bloquants**, seuils de pénurie et coefficients configurables.
- Toute livraison/dépôt accepté paie le joueur ; prix unitaire recalculé selon le stock évoluant pour chaque unité vendue.
- Confirmation affiche montant exact ; paiement et mouvement d'inventaire atomiques, résistants aux actions concurrentes.
- Sur place : consommation immédiate ; emport : objet transportable avec éventuel supplément, consommé plus tard.
- Affichage instantané avant/après bourse, énergie, alcoolémie ; bonus temporaire exclusif et expiration temps réel.
### Écrans et réactions
- Interface personnelle mono-message, données partagées ; rafraîchissement ciblé environ toutes les 5 secondes pour compteurs utiles.
- Navigation conditionnelle (pas de bouton de retour/sujet inutile, pas d'action dupliquée).
- Scénario en phases calme/tempête/après ; dialogues/ambiance/besoins adaptés par données configurées.
- Jeu de dés à deux D6 contre Edgar, gratuit dans le prototype.

## Inventaire précis du code V11
- `Recipe` : `key, name, level, seconds, portions, ingredients` ; 5 recettes de démonstration.
- `Profile` : `job, levels, xp, wallet, energy, alcohol, inventory, resources, buff_key, buff_expires`.
- `Pot` : `recipe_key, chef_id, ends_at` ; 3 marmites initiales de démonstration.
- `World` : `lock, pots, stock, meals, profiles, phase, sessions` ; état **en mémoire** par guild.
- `Session` : propriétaire, page, sélection, navigation, filtres, transaction en cours, état de dialogue, minuterie/rafraîchissement.
- Catalogues : `RECIPES`, `DRINKS`, `MEALS`, `BONUSES`, `SUPPLIES`, `RESOURCE_PRICE`, `STOCK_TARGET`, `MEAL_TARGET`, `DIALOGUES`, `RESPONSES`.
- Référence UX discord.py : `discord.ui.LayoutView`, `Container`, `Section`, `TextDisplay`, `Separator`, `ActionRow`, `Button`, `Select`.
- Vues/classes principales : `HomeView`, `KitchenView`, `RecipeView`, `DrinkView`, `MealView`, `PurchaseView`, `InventoryView`, `DialogueView`, `DiceView`, `StockView`, `DeliveryView`, `JobView`, `ResignView`.
- Commandes laboratoire : `/taverne`, `/metier_test`, `/niveau_test`, `/synchroniser` ; les commandes test et changements forcés de phase **ne doivent pas devenir des commandes joueur du moteur**.

## Outils nécessaires dans KingdomWeb Next
1. **Bibliothèque** avec tous les composants Discord réellement supportés, et assemblages réutilisables (fiche joueur, carte marmite, catalogue, stocks).
2. **Editeur d'écran hybride** : arborescence ordonnée + rendu Discord instantané au centre + inspecteur à droite ; synchronisation bidirectionnelle sélection/réordonnancement.
3. **Références typées** : choisir un objet, une recette, un métier, un PNJ, un stock, une variable, une quête existants via sélecteurs ; jamais ressaisir leurs IDs à la main.
4. **Éditeur de règles** : événement d'entrée/clic/fin de timer → conditions → opérations atomiques → navigation/feedback ; branches succès/échec.
5. **Éditeur de listes dynamiques** : répétition par recettes, boissons, marmites, ressources, en fonction de données/tri/filtres/niveaux.
6. **Inspecteur de données** : voir « utilisé par », dépendances, références cassées, cycles, contenu publié/brouillon.
7. **Simulation** avec profil de joueur fictif, états de stock/métier/quêtes, déroulement du temps, tests multi-joueurs ; aucun impact sur vraies données.
8. **Aperçu fidèle PC/mobile** + validation de compatibilité Discord ; test via bot isolé, avec statut « simulé » vs « validé Discord ».
9. **Publication transactionnelle** : valider contrat, publier les données et mettre à jour les panneaux Discord sans réinitialiser les stocks/progressions.
10. **Éditeurs spécialisés** recettes, consommables, commerce, dialogue, métier, scénarios, mais partageant un seul modèle de données.

## Démonstration obligatoire (critère d'acceptation)
Partir d'un **bâtiment entièrement vide**, sans template Edgar. Créer son inventaire, ses références, les 3 marmites, les 5 recettes, les catalogues, ses pages, ses règles et ses liens au scénario depuis l'interface. Prévisualiser les 6 pages et parcours secondaires, simuler deux joueurs (un cuisinier, un livreur), publier dans un monde de test, puis vérifier un cycle complet : livrer légumes → prix mis à jour → cuire soupe → stock repas incrémenté → achat → énergie actualisée → dialogue conditionnel selon tempête. Aucun edit de code entre ces étapes.

## Garde-fous
Le prototype est une spécification comportementale, **pas un stockage persistant** : ses dictionnaires, données d'équilibrage et commandes d'essai ne doivent pas être copiés comme logique spécifique du moteur. Conserver le runtime KingdomEngine2 et mapper chaque fonctionnalité sur des primitives génériques existantes ; compléter les lacunes via API et éditeur. Inventorier les limites des Components V2, ne pas prétendre intégrer l'authentique moteur graphique du client Discord.
