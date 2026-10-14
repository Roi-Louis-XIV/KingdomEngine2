# Migration fonctionnelle V1 → V2 — état intermédiaire

La migration **n'est pas terminée**. Ce document distingue les ajouts testés
des capacités encore à porter. Aucun second modèle, bâtiment ou PNJ n'a été
créé. Le scénario reste `royal_festival`, révision 3 ; son marqueur de contenu
d'atelier passe de 1 à 2.

## Fonctions et correspondances

| Fonction V1 | Bâtiment | État V1 | V2 avant | Action réalisée | État final |
|---|---|---|---|---|---|
| Six rumeurs pondérées, mémoire et cooldowns | Taverne | Présent | Moteur disponible, données absentes du modèle | Catalogue exact, 120 s joueur / 10 s global, page dédiée | TRANSFORMÉ EN CONFIGURATION |
| Couronne, Jugement, Destinée | Taverne | Présent | Sessions génériques disponibles | Dix paris, mise 5, confirmation via sélecteur existant | RÉCUPÉRÉ |
| Achats, consommation, catégories | Taverne | Présent | Fonctionnel | Conservé, tests de stock et énergie | DÉJÀ PRÉSENT |
| Cuisine stock → stock | Taverne | Présent | Fonctionnel | Conservée et testée | DÉJÀ PRÉSENT |
| Catalogue exact des 22 produits et quatre recettes V1 | Taverne | Présent | Catalogue V2 différent | Pas encore réconcilié | À TERMINER |
| Missions communes à attribution unique | Taverne | Présent | Recettes individuelles temporisées | Aucune fausse équivalence avec les recettes | IMPOSSIBLE ACTUELLEMENT : attribution partagée générique manquante |
| Ivresse, tolérance, gueule de bois, incidents | Taverne | Présent | Jauge générique partielle | Aucun second système d'énergie ajouté | À TERMINER |
| Trois galeries, niveaux 1/2/4, loot pondéré | Mine | Présent | Activités de scénario simplifiées | Carrière, charbon, fer ajoutés sans retirer le scénario | RÉCUPÉRÉ |
| Durée, énergie, usure et XP des galeries | Mine | Présent | Primitives disponibles | Valeurs V1 30/60/90 s, 15/25/35 énergie, 1/2/3 usure | TRANSFORMÉ EN CONFIGURATION |
| Récupération et reprise après redémarrage moteur | Mine/Forêt | Présent | Primitives disponibles | Tests départ/attente/claim unique/nouvelle instance | DÉJÀ PRÉSENT |
| Trois zones de bûcheronnage et trois zones de chasse | Forêt | Présent | Activités de scénario simplifiées | Zones V1 ajoutées avec probabilités et niveaux | RÉCUPÉRÉ |
| Métier Chasseur et arc requis | Forêt | Présent | Absent du modèle | Métier, achat/recette/réparation d'arc, menus | TRANSFORMÉ EN CONFIGURATION |
| Production, achat et réparation | Forge | Présent | Fonctionnel | Conservé ; arc ajouté à la chaîne de production | AMÉLIORÉ |
| Catalogue complet, recettes et amélioration V1 | Forge | Présent | Partiel | Pas encore intégralement réconcilié | À TERMINER |
| Phrases Roland/Wagner/Sylvain | Trois bâtiments | Présent | Non exposé dans ces menus | Phrases exactes, boutons Discuter ; Edgar conserve son accueil V2 | RÉCUPÉRÉ pour le texte |
| Dialogue vocal du bouton Discuter | Tous | Présent | PNJ/audio déjà séparés | Pas de nouvelle validation Discord réelle | À VALIDER |
| Livraison quantifiée, débit sac/crédit stock | Transversal | Présent | Fonctionnel | Test extraction → livraison → fonte ; destinations nouvelles ressources | DÉJÀ PRÉSENT |
| Ensemble des tarifs et destinations V1 | Transversal | Présent | Tarifs V2 différents | Ne pas écraser silencieusement les tarifs V2 | À TERMINER |
| Conditions métier UI et backend | Nouvelles expéditions | Présent | Primitives disponibles | Tests de boutons masqués et rejet serveur sans métier | DÉJÀ PRÉSENT |

## Couverture fonctionnelle finale : non acquise

Comptage par lignes du tableau, pas par nombre de boutons ; une ligne partielle
n'est pas comptée comme récupérée.

- Taverne : 4/7 blocs couverts ; produits/recettes exacts, missions partagées et
  alcool complet restent ouverts.
- Mine : 3/3 blocs du tableau couverts (galeries, coûts et persistance) ;
  l'amélioration spécifique de pioche figure dans le chantier Forge restant.
- Forêt : 3/3 blocs du tableau couverts (zones, Chasseur, persistance) ;
  l'ancienne action de chasse du scénario reste inchangée et sa réconciliation
  avec le métier Chasseur reste à décider explicitement.
- Forge : 1/2 blocs couverts ; catalogue et améliorations à compléter.
- Transversal : 2/3 blocs couverts ; tarifs V1 non entièrement réconciliés.
- PNJ : textes récupérés, déclenchement vocal réel non validé.

## Organisation et conservation

- `festival_v1_social.json` : rumeurs et paris.
- `festival_v1_mine.json` / `festival_v1_forest.json` : zones normalisées.
- `festival_v1_dialogues.json` : phrases et identité descriptive V1.
- `festival_workshops.py` : composition des données dans les bâtiments V2
  existants. Aucun changement du backend de gameplay.
- Ressources réconciliées : `wood → oak_timber`, `coal → festival_coal`,
  `raw_stone → stone_block`, `simple_pickaxe → iron_pickaxe`,
  `woodcutter → forester`, `herbs → medicinal_herb`.
- Les valeurs originales des zones sont conservées. La recette nouvelle d'arc
  est marquée `BALANCE_DRAFT / À VALIDER`.
- Pas de copie de joueurs, secrets, tokens ou identifiants Discord V1.
- Pas de dépendance runtime vers le dossier ou le ZIP V1.

## KingdomWeb et déploiement

Les ajouts sont des modules et composants ordinaires : zones, métier, recettes,
produits, rumeurs, jeux et pages sont enregistrés dans les données instanciées
et utilisent les éditeurs existants. L'édition navigateur complète n'a pas été
revalidée dans cette passe ; ne pas assimiler un test du renderer Discord à un
test navigateur KingdomWeb.

Au démarrage, le catalogue officiel fourni par le logiciel passe du marqueur
atelier 1 à 2, sans créer un autre pack. Un second démarrage ne le modifie plus.
Les mondes existants ne sont pas écrasés. Les contenus d'administrateurs dont
l'origine n'est pas le catalogue livré restent protégés par le filtre existant.

## Tests

- Tests ciblés : rumeurs, cooldowns, jeu confirmé/idempotent, rendu des menus,
  expéditions réservées au métier, énergie, timers, démission bloquée pendant
  une expédition, récupération après reconstruction du moteur.
- Tests des ateliers : cuisine/fonte stock → stock, achat, consommation,
  réparation, livraison et restrictions d'affichage.
- Test d'intégration du scénario existant : passé ; Discord et Voice sont
  simulés dans ce test. Ce n'est pas une validation sur un serveur Discord réel.
- Suite complète : **294 tests passent** (207,96 s), deux avertissements de
  dépendances. Après les derniers ajustements et l'ajout du parcours
  extraction → livraison → fonte, les **9 tests ciblés des ateliers passent**
  (32,23 s). Contrôle `git diff --check` sans erreur et quatre JSON UTF-8 valides.
