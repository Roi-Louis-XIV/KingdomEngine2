# KINGDOMENGINE V3 — KINGDOMWEB NEXT
## Reconstruction complète du Studio de création Discord

Tu es chargé de développer **KingdomEngine V3**, un projet de PAYEN STUDIO visant à créer un moteur universel de jeux et d'expériences interactives sur Discord, accompagné d'un logiciel de création et de supervision entièrement no-code : **KingdomWeb Next**.

### 1. Projet existant

Dépôt GitHub :
https://github.com/Roi-Louis-XIV/KingdomEngine2

Branche de référence :
`agent/kingdomengine2-v2`

Tu dois commencer par analyser cette branche et les documents fournis, notamment l'audit fonctionnel et le cahier de référence de la Taverne d'Edgar V11.

**Notre décision : reconstruire KingdomWeb depuis une page blanche, mais conserver les fonctionnalités et données existantes de KingdomEngine2.**

Développe la V3 dans une branche séparée. Ne modifie pas la version de production et ne supprime aucune fonctionnalité existante sans justification et validation.

### 2. Vision fondamentale

KingdomEngine doit permettre à n'importe quel créateur de construire un monde Discord vivant sans programmer.

Les créateurs doivent pouvoir configurer librement les bâtiments, objets, inventaires, métiers, recettes, productions, boutiques, PNJ, dialogues, quêtes, événements, scénarios et interfaces Discord.

**Aucun contenu propre au Royaume, à Edgar ou à la Tempête ne doit être codé en dur dans le moteur.**

Toutes les mécaniques doivent être génériques, réutilisables, configurables et supervisables depuis KingdomWeb.

### 3. KingdomWeb Next : nouvelle interface

Repars intégralement de zéro pour le frontend.

Direction artistique validée : **« L'équilibre des deux »**.

Nous recherchons un logiciel professionnel premium :

- Interface sombre et élégante.
- Accents vert minéral et détails subtils.
- Animations cinématographiques discrètes.
- Excellente lisibilité et ergonomie.
- Navigation instantanée.
- Composants cohérents et réutilisables.
- Gestion propre des chargements et erreurs.
- Aucune interface surchargée.
- Compatibilité ordinateur et supervision mobile.

Une refonte visuelle doit s'accompagner d'une véritable amélioration architecturale.

Privilégie une architecture TypeScript/React moderne, modulaire et testable, sous réserve de compatibilité avec le backend existant.

### 4. Navigation validée

Le logiciel possède six espaces :

**Tableau de bord**

Vue équilibrée : monde actif, statistiques essentielles, activité récente, alertes, brouillons et actions rapides.

**Monde**

Paramètres, géographie, carte, lieux, routes, calendrier, environnement et connexions Discord.

**Studio**

Bâtiments, interfaces Discord, objets, ressources, métiers, recettes, productions et PNJ.

**Scénarios**

Quêtes, événements, objectifs, conditions, actions et timeline.

**Supervision**

Joueurs, monde en direct, événements actifs, commandes de scénario et diagnostics.

**Médiathèque**

Audios, ambiances, effets, voix, présences vocales et travailleurs Discord.

Un seul monde actif est sélectionné globalement pour tous les espaces.

### 5. Éditeur de bâtiments

Chaque bâtiment s'ouvre dans **un espace de travail dédié en pleine page**.

Il possède :

- Vue générale.
- Fonctionnalités et modules.
- Interfaces Discord.
- Activité et données.
- Relations avec les autres entités.

Deux modes doivent coexister :

**Guidé :** paramètres essentiels, assistants et explications accessibles.

**Avancé :** tous les réglages, conditions, événements, actions, références et paramètres techniques.

Les deux modes doivent modifier le même modèle de données.

Un bâtiment se construit en assemblant des modules génériques : inventaire partagé, commerce, production, métiers, consommables, dialogues, quêtes, audio et interfaces Discord.

### 6. Éditeur visuel Discord complet

C'est une fonctionnalité prioritaire.

Créer un éditeur hybride à trois panneaux :

**Gauche :** pages, arborescence et bibliothèque complète des composants Discord.

**Centre :** émulateur Discord interactif, directement intégré à KingdomWeb.

**Droite :** inspecteur des propriétés et interactions.

La bibliothèque doit prendre en charge les composants Discord officiels compatibles, notamment Containers, Sections, Text Displays, Separators, Buttons, Action Rows, Select Menus, Media Galleries, Thumbnails, Files et formulaires/modales.

Vérifier les contraintes officielles avant l'implémentation.

Permettre l'ajout, la duplication, la réorganisation et la suppression de composants.

### 7. Émulateur Discord

Le créateur doit voir immédiatement, dans KingdomWeb, ce que donnera son interface sur Discord.

L'émulateur doit reproduire aussi fidèlement que possible :

- L'apparence des messages Discord.
- Les composants V2.
- Les couleurs et espacements autorisés.
- Les boutons et menus.
- Les états dynamiques.
- La navigation entre les pages.
- Les différences ordinateur/mobile.

Le moteur de simulation doit permettre de cliquer sur les éléments, d'exécuter les conditions et de simuler les conséquences sur des données fictives isolées.

Ne pas présenter l'émulation comme le moteur de rendu officiel de Discord.

Prévoir un mode de test sur un véritable salon Discord isolé, sans modifier les données de production.

### 8. Conditions, actions et relations

Construire un système no-code permettant de relier tous les éléments :

**Déclencheur → Conditions → Actions → Résultat**

Les créateurs doivent pouvoir sélectionner les entités existantes : joueurs, métiers, objets, inventaires, bâtiments, recettes, quêtes, événements, variables et interfaces.

L'éditeur doit disposer d'un mode visuel pour les comportements complexes, avec graphe de relations et diagnostic.

Chaque action doit pouvoir être testée dans le simulateur.

Le système doit expliquer pourquoi une condition est satisfaite ou refusée.

### 9. Taverne d'Edgar V11 : référence obligatoire

Le prototype Edgar UX Lab V11 représente notre objectif fonctionnel.

Le Studio doit pouvoir reconstruire ce bâtiment intégralement depuis une configuration vide.

Il doit permettre de créer :

- Six écrans Discord avec navigation mono-message.
- Catalogue de boissons et repas.
- Achats sur place et à emporter.
- Énergie, alcoolémie et bonus temporaires.
- Inventaires de bâtiment partagés et sans plafond de stockage.
- Objectifs de réserve et prix de rachat dynamiques.
- Livraisons systématiquement rémunérées.
- Métier de cuisinier avec progression conservée.
- Marmites partagées et cuissons temporisées.
- Répartition de l'XP 80 % préparateur / 20 % récupérateur.
- Recettes déverrouillées par niveaux.
- Priorités de production selon les réserves.
- Dialogues arborescents avec Edgar.
- Jeux de dés.
- Conditions de quêtes et de scénario.
- Changements d'ambiance lors de la Tempête du Royaume.

Il doit être possible de reproduire ces mécaniques pour d'autres bâtiments, sans développement spécifique.

### 10. Fiabilité et persistance

Conserver et protéger les systèmes existants :

- Données SQLite et migrations.
- Progression des joueurs.
- Inventaires.
- Économie.
- Quêtes.
- Production et timers.
- Voice Workers.
- Actifs audio.
- Comptes et permissions.
- Publication Discord.
- Versions des contenus.

Les opérations économiques et les changements d'état concurrents doivent être atomiques.

Les actions doivent être idempotentes quand nécessaire.

Aucun redémarrage ou republication ne doit provoquer une perte de progression.

### 11. Méthode de développement

Ne tente pas de réaliser tout le logiciel en une seule opération.

Travaille par étapes courtes, testables et publiées dans Git.

**Première tranche de développement :**

1. Auditer le backend et ses contrats.
2. Créer une branche dédiée V3.
3. Initialiser KingdomWeb Next.
4. Créer le design system.
5. Construire la navigation générale.
6. Implémenter le sélecteur global de monde.
7. Créer le tableau de bord équilibré.
8. Connecter les données réelles du moteur.
9. Créer la bibliothèque des bâtiments.
10. Créer le premier éditeur de bâtiment en pleine page.
11. Implémenter un premier cycle réel de sauvegarde et publication.
12. Ajouter les tests de non-régression.

Le travail ne sera considéré comme terminé que lorsque l'interface sera réellement utilisable et connectée au moteur, pas simplement statique.

### 12. Suivi et reprise du développement

Créer et maintenir :

- `docs/V3_ARCHITECTURE.md`
- `docs/V3_FEATURE_INVENTORY.md`
- `docs/V3_ROADMAP.md`
- `docs/V3_PROGRESS.md`

Le dernier fichier doit contenir les modifications, tests, commits, blocages et prochaines actions.

Conserver un historique Git propre.

Ne pas faire de déploiement sur le serveur de production ni de fusion dans la branche principale sans autorisation.

Limiter les analyses répétitives et le travail inutile afin d'utiliser efficacement les sessions et les quotas.

### 13. Résultat attendu

À terme, je veux pouvoir ouvrir KingdomWeb Next et construire entièrement une expérience Discord depuis son interface.

Je dois pouvoir créer un bâtiment, configurer ses mécaniques, concevoir son interface Discord avec l'émulateur, relier les conditions et les actions, tester le résultat et le publier.

**KingdomWeb Next ne doit pas être un simple panneau d'administration. Il doit être un véritable environnement de création de mondes interactifs.**

Commence immédiatement par analyser le dépôt existant puis réaliser la première tranche fonctionnelle de KingdomEngine V3. Ne t'arrête pas à la rédaction d'un plan.

À la fin, fournis un état précis des modifications réalisées, tests, commits et instructions permettant de lancer la nouvelle interface.