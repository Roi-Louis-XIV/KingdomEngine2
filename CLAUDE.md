# KingdomEngine 4 — consignes pour Claude Code

Plateforme no-code de mondes interactifs pour Discord, pour Payen Studio (Louis). Reconstruction complète de KingdomEngine2 (Python, devenu trop complexe), en TypeScript.

## Commandes
- `npm install` puis `npm test` : moteur, Taverne, API, voix. Tout doit rester vert.
- `npm start` : compile le Studio (`scripts/build-studio.mjs`) et lance le serveur unique sur http://localhost:8080.
- `npm run typecheck` : TypeScript strict (serveur + Studio).
- `npm run build` : Studio + émulateur autonome (`apps/emulator/dist/index.html`).
- Production Debian : `deploy/install-debian.sh` (service systemd `kingdomengine`, code dans `/opt/kingdomengine`, données dans `/var/lib/kingdomengine`, config `/etc/kingdomengine.env`), `deploy/update.sh`, `deploy/backup.sh`. Guide : `docs/DEPLOIEMENT.md`.

## Architecture (détails : docs/ARCHITECTURE.md)
- `packages/engine` : moteur **pur, synchrone, sans dépendance**. Modèle de monde (`model.ts`), règles et actions atomiques (`rules.ts`), widgets des modules (`widgets.ts`), sessions et interactions (`engine.ts`), validation (`validate.ts`). Il tourne aussi dans le navigateur (émulateur du Studio).
- `apps/server` : un seul processus. `platform.ts` (SQLite via `node:sqlite` : comptes, serveurs, droits, versions, état, audit), `runtime.ts` (un Engine par serveur), `api.ts` (routes), `http.ts` (micro-routeur), `discord/core.ts` (bot unique multi-serveurs), `voice/` (pool pur testé + adaptateur `@discordjs/voice`).
- `apps/studio` : Studio web en TypeScript natif **sans framework** (`ui.ts` fournit `h()`), compilé par `tsc` en modules ES.
- `content/` : modèles de mondes en JSON. `le-royaume/world.json` = Taverne d'Edgar V11 (recette d'acceptation) + la Forêt et le chantier de l'Église.

## Règles du projet
1. **Aucun contenu d'univers dans le code.** Edgar, la Tempête, etc. sont des données. Toute nouvelle mécanique devient une primitive générique (module, action, condition, widget) configurable dans le Studio.
2. **Toute modification d'état passe par une transaction du moteur** (copie, puis validation en tout-ou-rien). Jamais d'écriture partielle.
3. **Migrations SQLite additives et numérotées** (`apps/server/src/db.ts`). On n'efface jamais une base existante.
4. **La voix et l'audio ne bloquent jamais le jeu.**
5. **Interface en français**, phrases simples, vocabulaire de l'utilisateur (pas de jargon technique). Direction visuelle (demandée par Louis) : fond noir, texte blanc très contrasté, **vert bouteille `#0a6b45`** en aplat aux seuls endroits forts (actif, actions principales, blason), vert clair `#34c27d` pour liens et focus, laiton `#e0b04f` et rouge `#f05252` pour les alertes, titres en serif. L'aperçu Discord garde les couleurs de Discord.
6. Chaque fonctionnalité arrive avec ses tests (`node:test`). Les limites Discord Components V2 sont vérifiées par `validateRendered`.
7. Ne pas fusionner dans `main` ni déployer en production sans l'accord de Louis.

## État actuel
- Phases 0, 1 et 2 terminées (moteur, plateforme, Studio, bot, voix, outils, activités, objectifs, édition visuelle). Phase 3 en cours : météo et événements programmés faits (`packages/engine/src/clock.ts`, `Engine.tick()` appelé toutes les 5 s par `apps/server/src/main.ts`, page Studio « En direct »). Voir `docs/ROADMAP.md`.
- **Jamais testé sur un vrai Discord** : le bot principal et les Voice Workers sont à valider en premier (`.env.example`).
- Inventaire complet de ce qui reste à porter depuis KE2 : `docs/KE2_INVENTAIRE.md`. Ancien code de référence : branche `agent/kingdomengine2-v2` de ce dépôt.

## Prochaines étapes
1. Brancher le bot et les Voice Workers sur un serveur Discord de test et corriger ce qui doit l'être.
2. Phase 2 bis : rôles d'accès aux bâtiments, serment d'arrivée, nettoyage des salons.
3. Suite de la phase 3 : quêtes, saisons et jour/nuit, géographie et voyages (voir `docs/KE2_INVENTAIRE.md`).
