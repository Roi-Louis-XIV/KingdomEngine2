# Inventaire KingdomEngine2 → KingdomEngine4

Source : branche `agent/kingdomengine2-v2` (commit `00778b7`), README, API de `KingdomWeb/app.py` (≈ 110 routes), modules `kingdomCore`, `KingdomVoice`, `KingdomData`, `kingdomEvent`.

Principe de portage : **on reprend les fonctionnalités, pas le code**. Chaque fonction KE2 devient soit une primitive générique du moteur, soit un service de la plateforme, soit un écran du Studio.

Légende : ✅ fait · 🟡 partiel · ⏳ planifié (phase indiquée)

## 1. Plateforme, comptes et serveurs

| KE2 | KE4 | État |
|---|---|---|
| Comptes, connexion, cookie de session (7 jours en option), inscription activable | `apps/server` : comptes (scrypt), sessions HttpOnly/SameSite, `KINGDOM_ALLOW_REGISTRATION` | ✅ P1 |
| Rôle `platform_admin` + administration Payen Studio séparée | Rôle plateforme, écran « Administration » réservé | ✅ P1 |
| Plusieurs serveurs Discord par compte, un monde indépendant par serveur, sélecteur global | Registre `servers`, sélecteur dans l’en-tête du Studio | ✅ P1 |
| Droits lecture / éditeur / gestionnaire / propriétaire | Table `access`, vérifiée à chaque requête | ✅ P1 |
| Un identifiant Discord ne peut être revendiqué deux fois | Contrainte d’unicité `guild_id` | ✅ P1 |
| Limite de serveurs par compte | `KINGDOM_MAX_SERVERS_PER_ACCOUNT` | ✅ P1 |
| Suppression d’un serveur avec confirmation par le nom | Suppression en cascade | ✅ P1 (désinstallation Discord ⏳ P2) |
| Modèles de monde (vierge, Royaume médiéval, Station spatiale, Fête du Royaume) | Modèles = dossiers `content/` ; vierge + Le Royaume livrés | 🟡 P1 (autres modèles ⏳ P3) |
| Bibliothèque communautaire / contenu officiel versionné | Publier un monde comme modèle | ⏳ P4 |
| Support Mode, journaux système, services systemd | Un seul processus `kingdom` ; journaux plateforme | ⏳ P4 |
| Organisations, plans, quotas | Hors périmètre tant qu’il n’y a pas d’offre commerciale | ⏳ P5 |

## 2. Contenu et publication

| KE2 | KE4 | État |
|---|---|---|
| Brouillon / publication / archives, contrôle de concurrence (409) | Versions de contenu, révision attendue, publication atomique | ✅ P1 |
| Validation avant publication | `validateWorld` bloque la publication en cas d’erreur | ✅ P1 |
| Historique des changements | Journal d’audit par serveur | ✅ P1 |
| Rechargement du bot sans redémarrage | Publication → rechargement à chaud du moteur | ✅ P1 |
| Import V1 | Remplacé par le modèle « Le Royaume » | — |

## 3. Supervision

| KE2 | KE4 | État |
|---|---|---|
| Tableau de bord (joueurs, bâtiments, stocks, alertes, activité) | Vue d’ensemble + activité récente | ✅ P1 |
| Fiche joueur : ressources, inventaire, métiers, outils, cooldowns, position | Fiche joueur + interventions auditées (stats, objets, métiers, niveaux) | ✅ P1 (outils/cooldowns avec le moteur P2) |
| Monde en direct : carte live, progression, santé | Variables, stocks, postes de production en direct | 🟡 P1 (carte ⏳ P3) |
| Mode mobile orienté supervision | Studio responsive | 🟡 P1 |

## 4. Mécaniques de jeu (moteur)

| KE2 | KE4 | État |
|---|---|---|
| Boutique, rachat dynamique, stocks partagés, objectifs de réserve | Modules `shop`, `buyback`, `inventory` | ✅ |
| Postes partagés, cuisson minutée, XP préparateur/récupérateur | Module `production` | ✅ |
| Métiers, niveaux, XP, métier unique, démission | Métiers + actions `job.*` | ✅ |
| Consommables, énergie, bonus temporaires | Statistiques, objets consommables, bonus exclusifs | ✅ |
| Dialogues PNJ conditionnels, mini-jeu de dés | Modules `dialogue`, `dice` | ✅ |
| Conditions récursives all/any/not | Conditions expliquées | ✅ |
| Outils, durabilité, réparation, amélioration | Objets-outils (durabilité par joueur), usure, réparation payante | ✅ P2 (amélioration de niveau ⏳ P3) |
| Activités temporisées, résultats aléatoires pondérés, cooldowns | Module `activity` : durée, recharge, coûts, outil, XP, tirages pondérés figés au lancement, bonus de récolte | ✅ P2 |
| Objectifs collectifs et contributions | Module `objective` : contributions, récompense par unité, meilleurs contributeurs, actions à l’achèvement | ✅ P2 |
| Livraisons rémunérées | ✅ via `buyback` | ✅ |
| Quêtes | Module `quest` | ⏳ P3 |
| Événements, Live Ops (démarrer/pause/reprendre/arrêter), timeline | Planificateur d’événements | ⏳ P3 |
| Calendrier, saisons, météo, jour/nuit | Variables temporelles automatiques | ⏳ P3 |
| Lieux, connexions, voyages, exploration | Géographie | ⏳ P3 |

## 5. Discord

| KE2 | KE4 | État |
|---|---|---|
| KingdomCore multi-serveurs, commandes générées depuis les données | Bot unique, un moteur par serveur, commandes par serveur | ✅ P1 |
| Interfaces mono-message, anciens boutons repris au redémarrage | `customId` sans état | ✅ |
| Lien d’invitation de KingdomCore | Bouton dans « Discord & voix » | ✅ P1 |
| Provisionnement : catégorie, salons texte/vocal par bâtiment, rôles | Création des salons d’un bâtiment depuis le Studio | 🟡 P1 (rôles ⏳ P2) |
| Rôle d’accès temporaire au bâtiment (entrée/sortie du vocal) | — | ⏳ P2 |
| Parcours d’arrivée (serment, dotation, monnaie) | — | ⏳ P2 |
| Nettoyage / audit des salons, désinstallation | — | ⏳ P2 |

## 6. Voix et audio

| KE2 | KE4 | État |
|---|---|---|
| Pool de Voice Workers (`VOICE_WORKER_n_TOKEN`), capacité, quota | Pool générique testé (allocation, libération, reprise) | ✅ P1 |
| Allocation automatique quand un joueur entre dans le vocal d’un bâtiment | Planificateur pur + adaptateur `@discordjs/voice` | ✅ P1 (non testé sur Discord réel) |
| Identité du worker = PNJ du bâtiment (nom, photo) | Pseudonyme du worker = PNJ | ✅ P1 |
| Banque sonore (upload, types, volume) | Médiathèque par serveur | ✅ P1 |
| Ambiance par bâtiment, variant selon le scénario (Tempête) | `audio.ambience` conditionnelle | ✅ P1 |
| Sons ponctuels déclenchés par une action | Action `audio.play` | ✅ P1 |
| Groupes d’ambiance multicouches, histoires auditives | — | ⏳ P3 |
| Réactions vocales contextuelles des PNJ | — | ⏳ P3 |

## 7. Studio

| KE2 | KE4 | État |
|---|---|---|
| Connexion, shell, thème sombre, navigation | Studio sans dépendance (TypeScript natif) | ✅ P1 |
| Éditeurs objets, métiers, statistiques | Éditeurs de catalogues | ✅ P1 |
| Builder de bâtiments plein écran, modes Simple/Avancé | Éditeur de modules, d’écrans et d’audio + édition avancée JSON + émulateur intégré | ✅ P2 |
| Builder visuel des pages Discord (glisser-déposer) | Éditeur d’écrans : blocs ordonnables, boutons et règles, conditions, textes variables, réglages des modules, aperçu en direct | ✅ P2 (glisser-déposer ⏳) |
| Boutons conditionnels, conditions all/any/not | Éditeur visuel de conditions récursif | ✅ P2 |
| Presets de bâtiments | Assistants : boutique, atelier, activités, objectif, personnage | ✅ P2 |
| Académie, tutoriels interactifs | — | ⏳ P4 |
