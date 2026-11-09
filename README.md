# KingdomEngine 4

Moteur **no-code** de mondes interactifs pour Discord. Un monde complet (bâtiments, objets, métiers, boutiques, cuisines, dialogues, mini-jeux, écrans Discord) est **un simple fichier JSON**. Le moteur ne contient aucun contenu propre à un univers.

> Preuve de concept : la Taverne d’Edgar V11 est entièrement reconstruite dans `content/le-royaume/world.json`. Elle ne contient aucune ligne de code spécifique et ses mécaniques sont couvertes par 23 tests.

## Démarrage rapide

Prérequis : **Node.js 22.6 ou plus récent** (`node -v`).

```sh
npm install
npm test            # 23 tests : moteur + Taverne + format Discord
npm run emulator    # génère apps/emulator/dist/index.html
```

Ouvre `apps/emulator/dist/index.html` dans ton navigateur. Tu peux alors jouer la Taverne avec plusieurs joueurs, accélérer le temps, changer la phase du scénario et inspecter l’état. Il n’y a ni serveur ni bot à lancer.

### Lancer le bot Discord

1. Copie `.env.example` en `.env`, puis renseigne `DISCORD_TOKEN` et `DISCORD_GUILD_ID` (ton serveur de test).
2. `npm run bot`
3. Sur Discord, tape `/taverne`. La commande `/admin` (réservée aux administrateurs) change la phase, le métier ou le niveau.

L’état est sauvegardé après chaque action dans `var/le-royaume.state.json`, avec une copie `.bak`. Un redémarrage ne perd rien, et les anciens boutons continuent de fonctionner.

## Organisation

| Dossier | Rôle |
|---|---|
| `packages/engine` | Le moteur pur : modèle de monde, règles, transactions, rendu. Aucune dépendance. |
| `content/` | Les mondes (données). `le-royaume/world.json` = Taverne d’Edgar. |
| `apps/bot` | Adaptateur Discord (discord.js) : affiche, transmet les clics, sauvegarde. |
| `apps/emulator` | Émulateur Discord dans le navigateur, qui exécute le vrai moteur. |
| `docs/` | Architecture et feuille de route. |

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour comprendre comment un bâtiment se construit.
