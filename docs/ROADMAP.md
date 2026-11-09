# Feuille de route

Le détail fonction par fonction est dans [`KE2_INVENTAIRE.md`](KE2_INVENTAIRE.md).

## ✅ Phase 0 — Moteur
Moteur générique et atomique, Taverne d’Edgar V11 en pur contenu, émulateur.

## ✅ Phase 1 — Plateforme
- Serveur unique : comptes, sessions, droits à quatre niveaux, plusieurs mondes par compte, modèles de départ.
- Contenu versionné : brouillon, conflits, validation, publication à chaud, restauration, audit.
- Supervision : vue d’ensemble en direct, alertes, scénario, réserves, postes, activité, fiches joueurs, interventions auditées.
- Discord : bot unique multi-serveurs, commandes générées, création des salons des bâtiments.
- Voix : pool de Voice Workers, présences automatiques, identité du personnage, ambiance selon le scénario, sons d’action, médiathèque.
- Studio : navigation, sélecteur de serveur, éditeurs de bâtiments (modules, écrans, audio), catalogue, émulateur intégré, publication, Discord & voix, administration, mode mobile.

**À valider sur un vrai Discord** : le bot et les Voice Workers n’ont pas pu être testés dans l’environnement de développement (pas d’accès au réseau Discord).

## Phase 2 — Mécaniques et Discord avancé
- Objets à état : outils, durabilité, réparation, amélioration.
- Module `activity` : récoltes et expéditions temporisées, résultats aléatoires pondérés, cooldowns.
- Module `objective` : objectifs collectifs et contributions.
- Rôles d’accès aux bâtiments (entrée/sortie du vocal), parcours d’arrivée (serment, dotation).
- Éditeur visuel complet des écrans : règles de boutons et conditions sans JSON, textes variables.
- Assistants : « Ajouter une cuisine », « Ajouter une boutique » créent le module et ses écrans.

## Phase 3 — Monde vivant
Quêtes ; événements et Live Ops (démarrer / pause / reprendre / arrêter) ; timeline de scénario ; calendrier, saisons, météo ; lieux, voyages, carte ; groupes d’ambiance multicouches ; réactions vocales des personnages.

## Phase 4 — Produit
Bibliothèque de modèles (officiels et communautaires), Académie et tutoriels, journaux plateforme, Support Mode, modèles « Royaume médiéval » et « Station spatiale ».
