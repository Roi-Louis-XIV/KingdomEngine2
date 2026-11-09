# KingdomEngine 4 — consignes pour Claude Code

Plateforme no-code de mondes interactifs pour Discord, pour Payen Studio (Louis). Reconstruction complète de KingdomEngine2 (Python, devenu trop complexe), en TypeScript.

## Commandes
- `npm install` puis `npm test` : moteur, Taverne, API, voix. Tout doit rester vert.
- `npm start` : compile le Studio (`scripts/build-studio.mjs`) et lance le serveur unique sur http://localhost:8080.
- `npm run typecheck` : TypeScript strict (serveur + Studio).
- `npm run build` : Studio + émulateur autonome (`apps/emulator/dist/index.html`).

## Architecture (détails : docs/ARCHITECTURE.md)
- `packages/engine` : moteur **pur, synchrone, sans dépendance**. Modèle de monde (`model.ts`), règles et actions atomiques (`rules.ts`), widgets des modules (`widgets.ts`), sessions et interactions (`engine.ts`), validation (`validate.ts`). Il tourne aussi dans le navigateur (émulateur du Studio).
- `apps/server` : un seul processus. `platform.ts` (SQLite via `node:sqlite` : comptes, serveurs, droits, versions, état, audit), `runtime.ts` (un Engine par serveur), `api.ts` (routes), `http.ts` (micro-routeur), `discord/core.ts` (bot unique multi-serveurs), `voice/` (pool pur testé + adaptateur `@discordjs/voice`).
- `apps/studio` : Studio web en TypeScript natif **sans framework** (`ui.ts` fournit `h()`), compilé par `tsc` en modules ES.
- `content/` : modèles de mondes en JSON. `le-royaume/world.json` = Taverne d'Edgar V11, la recette d'acceptation.

## Règles du projet
1. **Aucun contenu d'univers dans le code.** Edgar, la Tempête, etc. sont des données. Toute nouvelle mécanique devient une primitive générique (module, action, condition, widget) configurable dans le Studio.
2. **Toute modification d'état passe par une transaction du moteur** (copie, puis validation en tout-ou-rien). Jamais d'écriture partielle.
3. **Migrations SQLite additives et numérotées** (`apps/server/src/db.ts`). On n'efface jamais une base existante.
4. **La voix et l'audio ne bloquent jamais le jeu.**
5. **Interface en français**, phrases simples, vocabulaire de l'utilisateur (pas de jargon technique). Direction visuelle : sombre, vert-de-gris `#6fb59a`, laiton `#c9a45c`, titres en serif.
6. Chaque fonctionnalité arrive avec ses tests (`node:test`). Les limites Discord Components V2 sont vérifiées par `validateRendered`.
7. Ne pas fusionner dans `main` ni déployer en production sans l'accord de Louis.

## État actuel
- Phase 0 (moteur + Taverne) et phase 1 (plateforme, Studio, bot, voix) terminées. Voir `docs/ROADMAP.md`.
- **Jamais testé sur un vrai Discord** : le bot principal et les Voice Workers sont à valider en premier (`.env.example`).
- Inventaire complet de ce qui reste à porter depuis KE2 : `docs/KE2_INVENTAIRE.md`. Ancien code de référence : branche `agent/kingdomengine2-v2` de ce dépôt.

## Prochaines étapes (phase 2)
Outils et durabilité ; module `activity` (récoltes temporisées, résultats aléatoires pondérés, cooldowns) ; module `objective` (objectifs collectifs) ; rôles d'accès aux bâtiments et serment d'arrivée ; éditeur visuel des règles de boutons et des conditions (supprimer le besoin du JSON) ; assistants « Ajouter une cuisine / une boutique ».
