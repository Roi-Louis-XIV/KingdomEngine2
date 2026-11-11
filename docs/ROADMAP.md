# Feuille de route

Le détail fonction par fonction est dans [`KE2_INVENTAIRE.md`](KE2_INVENTAIRE.md).

## ✅ Phase 0 — Moteur
Moteur générique et atomique, Taverne d’Edgar V11 en pur contenu, émulateur.

## ✅ Phase 1 — Plateforme
- Serveur unique : comptes, sessions, droits à quatre niveaux, plusieurs mondes par compte, modèles de départ.
- Contenu versionné : brouillon, conflits, validation, publication à chaud, restauration, audit.
- Supervision : vue d’ensemble en direct, alertes, scénario, réserves, postes, activité, fiches joueurs, interventions auditées.
- Discord : bot unique multi-serveurs, accès aux bâtiments par le salon vocal (salon texte en lecture seule, panneau d’entrée, interface personnelle effacée à la sortie, aucune commande slash), création des salons des bâtiments.
- Voix : pool de Voice Workers, présences automatiques, identité du personnage, ambiance selon le scénario, sons d’action, médiathèque.
- Studio : navigation, sélecteur de serveur, éditeurs de bâtiments (modules, écrans, audio), catalogue, émulateur intégré, publication, Discord & voix, administration, mode mobile.

**À valider sur un vrai Discord** : le bot et les Voice Workers n’ont pas pu être testés dans l’environnement de développement (pas d’accès au réseau Discord).

## ✅ Phase 2 — Mécaniques et édition visuelle
- Outils : durabilité par joueur, usure, casse, réparation payante (widget « Outils du joueur »).
- Module `activity` : récoltes et travaux temporisés ou immédiats, coûts, outil, XP, recharge, tirages pondérés figés au lancement, bonus qui augmentent les récoltes.
- Module `objective` : objectif collectif, récompense par unité, meilleurs contributeurs, actions à l’achèvement (ex. retour au calme).
- Contenu : la Forêt (bûcheron, hache) et le chantier de l’Église dans « Le Royaume ».
- Studio : éditeur visuel de conditions (récursif), de règles de boutons, de textes variables, réglages des widgets ; assistants boutique, atelier, activités, objectif, personnage ; outils et activités dans la fiche joueur ; objectifs dans la vue d’ensemble.

## Phase 2 bis — Discord avancé
- ✅ Serment d’arrivée (rôle des habitants, dotation unique), une catégorie par bâtiment, nettoyage des salons des bâtiments.
- ✅ Métiers à expérience (bûcheron, mineur, forgeron, fermier, pêcheur, cuisinier) : gestes réservés aux niveaux 2 et 3, fiche du joueur.
- ✅ Échoppes : vente d’objets (outils, vivres) et rachat de ressources dans chaque lieu de la bêta.
- ✅ Lieux de récolte (mine, forêt, rivière, ferme) : sous-lieux réservés par niveau, tirages pondérés selon le lieu, le niveau et l’outil (`ActivityResult.when/bonus`), outils de qualités interchangeables (`tool.anyOf`), chances affichées au joueur.
- ✅ Équipement (`ItemDef.equipment`) : armes, armes de tir, armures, accessoires avec attaque/défense (futur combat) et économie d’endurance au travail.
- ✅ Forge du Dragon Noir (fonderie, outils, catalogue complet payé en lingots, services) et Gueuse Cocue (carte complète, brasserie et métier de brasseur, plats « à grignoter »).
- ⏳ Désinstallation des salons ; rôles d’accès par bâtiment (bâtiments réservés).

## 🟡 Phase 3 — Monde vivant
- ✅ Météo automatique : temps pondérés, durées aléatoires, annonces, forçage et suspension depuis le Studio ; elle pilote une variable dont dépendent textes, activités, ambiances.
- ✅ Événements : manuels, quotidiens (jours au choix), à intervalle, à date unique ; étapes chronologiques ; actions et annonces de début et de fin ; démarrer / pause / reprendre / arrêter / redémarrer ; programmation activable ; reprise après redémarrage du serveur.
- ✅ Page « En direct » (supervision et pilotage), éditeur « Météo & événements », salon d’annonces Discord.
- ✅ Quêtes personnelles : panneau (propositions tirées selon le niveau d’XP, une quête à la fois, nouveau tirage), étapes visiter / livrer / compter, récompenses par difficulté, fiche du joueur dans « Mon inventaire », page Studio « Quêtes ».
- ✅ Primitives de scénario : conditions sur objectif (%) / quête / comparaison de variables, actions si/sinon, compteur, pour chaque joueur, annonce, contribution directe ; objectifs à fenêtre, XP par unité ; rendements selon l’état du monde ; actions collectives limitées ; tableau d’honneur. L’essai du Studio lance les événements et fait avancer le temps.
- ✅ Bêta « La Nuit de la Sainte Pelle » (`content/sainte-pelle`, généré par `scripts/content/sainte-pelle.mjs`) : 3 h, 8 lieux, 36 quêtes, 7 objectifs, 4 fins.
- ⏳ Saisons et cycle jour/nuit ; lieux, voyages, carte ; groupes d’ambiance multicouches ; réactions vocales des personnages.

## Phase 4 — Produit
Bibliothèque de modèles (officiels et communautaires), Académie et tutoriels, journaux plateforme, Support Mode, modèles « Royaume médiéval » et « Station spatiale ».
