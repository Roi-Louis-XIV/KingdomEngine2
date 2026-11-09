# KingdomEngine 4

Plateforme **no-code** de mondes interactifs pour Discord. Elle comprend :

- **un Studio web** pour créer et superviser ses mondes : bâtiments, objets, métiers, écrans Discord, joueurs, sons ;
- **un bot Discord unique** qui sert tous les serveurs, chacun avec son propre monde ;
- **des Voice Workers**, bots vocaux qui incarnent les personnages et jouent l’ambiance des bâtiments occupés.

Un monde est **un document de données**. Le moteur ne contient aucun contenu propre à un univers : la Taverne d’Edgar est livrée comme modèle (`content/le-royaume`).

## Démarrage

Prérequis : **Node.js 22.12 ou plus récent** (`node -v`).

```sh
npm install
npm test          # moteur, Taverne, API, voix
npm start         # compile le Studio puis démarre tout
```

Ouvre **http://localhost:8080**. Au premier lancement, crée ton compte : il administre l’installation. Crée ensuite un monde depuis le modèle « Le Royaume » ou « Monde vierge ».

Sans configuration Discord, le Studio fonctionne déjà entièrement. L’onglet **Tester** fait jouer ton brouillon dans un émulateur Discord qui exécute le vrai moteur.

### Brancher Discord

1. Copie `.env.example` en `.env`.
2. **Bot principal** : crée une application sur le [Discord Developer Portal](https://discord.com/developers/applications), copie le jeton du bot dans `KINGDOM_CORE_TOKEN`.
3. **Voice Workers** (facultatif) : crée une application par connexion vocale simultanée, puis renseigne `VOICE_WORKER_1_TOKEN` et `VOICE_WORKER_1_APPLICATION_ID`, puis `VOICE_WORKER_2_TOKEN`, etc.
4. Redémarre (`npm start`). Dans le Studio, la page **Discord & voix** guide le reste en quatre étapes : associer le serveur, inviter le bot, créer les salons, inviter les workers.
5. Importe les sons dans la **Médiathèque**. Les clés attendues par la Taverne y sont listées : `taverne-calme`, `taverne-tempete`, `edgar-bienvenue`, `chope-servie`.

## Organisation

| Dossier | Rôle |
|---|---|
| `packages/engine` | Moteur pur et sans dépendance : modèle de monde, règles, transactions, rendu Components V2 neutre |
| `apps/server` | Serveur unique : API du Studio, comptes, serveurs, versions, supervision, bot Discord, Voice Workers |
| `apps/studio` | Studio web (TypeScript natif, sans framework) |
| `apps/emulator` | Émulateur autonome en une page (`npm run build`) |
| `content/` | Modèles de mondes |
| `docs/` | Architecture, feuille de route, inventaire KE2 → KE4 |

Les données vivent dans `var/` : la base `kingdom.db` (SQLite, WAL) et les sons. Pour sauvegarder, copie ce dossier serveur arrêté.

Pour aller plus loin, lis [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et [`docs/KE2_INVENTAIRE.md`](docs/KE2_INVENTAIRE.md).
