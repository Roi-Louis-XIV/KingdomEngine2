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

## ✅ Phase 2 — Mécaniques et édition visuelle
- Outils : durabilité par joueur, usure, casse, réparation payante (widget « Outils du joueur »).
- Module `activity` : récoltes et travaux temporisés ou immédiats, coûts, outil, XP, recharge, tirages pondérés figés au lancement, bonus qui augmentent les récoltes.
- Module `objective` : objectif collectif, récompense par unité, meilleurs contributeurs, actions à l’achèvement (ex. retour au calme).
- Contenu : la Forêt (bûcheron, hache) et le chantier de l’Église dans « Le Royaume ».
- Studio : éditeur visuel de conditions (récursif), de règles de boutons, de textes variables, réglages des widgets ; assistants boutique, atelier, activités, objectif, personnage ; outils et activités dans la fiche joueur ; objectifs dans la vue d’ensemble.

## Phase 2 bis — Discord avancé (après validation sur un vrai serveur)
- Rôles d’accès aux bâtiments (entrée/sortie du vocal), parcours d’arrivée (serment, dotation), nettoyage et désinstallation des salons.

## 🟡 Phase 3 — Monde vivant
- ✅ Météo automatique : temps pondérés, durées aléatoires, annonces, forçage et suspension depuis le Studio ; elle pilote une variable dont dépendent textes, activités, ambiances.
- ✅ Événements : manuels, quotidiens (jours au choix), à intervalle, à date unique ; étapes chronologiques ; actions et annonces de début et de fin ; démarrer / pause / reprendre / arrêter / redémarrer ; programmation activable ; reprise après redémarrage du serveur.
- ✅ Page « En direct » (supervision et pilotage), éditeur « Météo & événements », salon d’annonces Discord.
- ⏳ Quêtes ; saisons et cycle jour/nuit ; lieux, voyages, carte ; groupes d’ambiance multicouches ; réactions vocales des personnages.

## Phase 4 — Produit
Bibliothèque de modèles (officiels et communautaires), Académie et tutoriels, journaux plateforme, Support Mode, modèles « Royaume médiéval » et « Station spatiale ».
