# Architecture de KingdomEngine 4

## Vue d’ensemble

```
                    ┌──────────── apps/server (un seul processus) ────────────┐
 Navigateur ──HTTP──▶ API du Studio ─┐                                         │
 (apps/studio)      │                ▼                                         │
                    │  Platform (SQLite) : comptes, serveurs, droits,          │
                    │  versions de contenu, état, joueurs, activité, audit     │
                    │                ▲                                         │
                    │  Runtimes : un Engine par serveur ◀── publication        │
                    │     │  signaux « changed / reloaded / engine »          │
                    │     ▼                                                    │
 Discord ◀──────────┤  CoreBot (discord.js) : accès vocal, entrées, interfaces │
                    │  VoiceWorkers (@discordjs/voice) : présences vocales     │
                    └──────────────────────────────────────────────────────────┘
                                     ▲
                       packages/engine (pur, sans dépendance)
                       — aussi exécuté dans le navigateur pour l’émulateur —
```

## Principes

1. **Le moteur ne connaît ni Discord ni la base.** Il reçoit un monde (`WorldDef`) et un état (`WorldState`). Il expose des opérations synchrones et atomiques et rend un arbre neutre calqué sur Components V2.
2. **Le même moteur partout.** L’émulateur du Studio fait tourner exactement le code du bot, sur le brouillon.
3. **Contenu ≠ code.** Un monde est un document JSON versionné. Publier recharge le moteur à chaud, sans perdre aucune progression.
4. **Un seul processus.** Studio, API, bot et voix partagent la même mémoire : pas de file d’attente entre services, pas de désynchronisation. La base SQLite en mode WAL est la seule source de vérité.
5. **Discord est un afficheur.** Le bot ouvre des interfaces, transmet les clics, rafraîchit les messages et ne décide de rien.
6. **La voix ne bloque jamais le jeu.** Un son ou un worker manquant laisse le bâtiment silencieux, sans erreur côté joueur.

## Données (`apps/server/src/db.ts`)

| Table | Contenu |
|---|---|
| `accounts`, `sessions` | Comptes (mots de passe scrypt), sessions (jetons hachés) |
| `servers`, `access` | Mondes, serveur Discord associé (unique), droits par compte |
| `content` | Versions du monde : un brouillon, une version publiée, des archives |
| `states` | État de jeu de chaque monde (joueurs, réserves, postes, variables) |
| `players`, `activity` | Noms Discord des joueurs, fil d’activité |
| `audit` | Historique des modifications et interventions |
| `audio`, `server_settings` | Médiathèque, salons Discord des bâtiments |

Les migrations sont numérotées et additives : une base existante n’est jamais vidée.

## Droits

| Rôle | Peut |
|---|---|
| Lecture | Tout consulter |
| Éditeur | Modifier le contenu et le publier |
| Gestionnaire | En plus : intervenir sur les joueurs, changer le scénario, Discord, sons |
| Propriétaire | En plus : gérer les accès, renommer, supprimer le monde |
| Administrateur plateforme | Tous les mondes, comptes, état des bots |

Chaque requête vérifie le droit côté serveur. Un monde inaccessible répond « introuvable » pour ne pas révéler son existence. Les écritures exigent le cookie `SameSite=Strict` et un en-tête propre au Studio.

## Contenu et publication

- **Brouillon.** Le Studio édite une copie locale du monde. La barre d’enregistrement apparaît dès qu’il y a une modification.
- **Concurrence.** L’enregistrement envoie la révision lue ; si quelqu’un a enregistré entre-temps, le serveur répond 409.
- **Publication.** `validateWorld` doit être sans erreur. La version précédente est archivée, le moteur rechargé à chaud, les panneaux d’entrée des bâtiments mis à jour sur Discord.
- **Restauration.** Toute version archivée peut redevenir le brouillon.

## Discord : entrer dans un bâtiment

Mécanique reprise de KingdomEngine2. **Aucune commande slash : tout se fait au clic.**

1. Chaque bâtiment a un **salon vocal** (la porte, avec l’ambiance) et un **salon texte** caché à tous et en lecture seule.
2. Rejoindre le salon vocal donne au joueur le droit de **voir** le salon texte (permission propre au membre, sans droit d’écrire). Il y trouve un seul message : le **panneau d’entrée** commun (`entrancePanel`, texte et bouton réglables dans l’onglet Général du bâtiment).
3. « Entrer » ouvre l’**interface personnelle** du joueur (message éphémère, visible de lui seul) sur l’écran d’accueil. Chaque clic **modifie ce message sur place**. Une seule interface par joueur et par bâtiment.
4. Quitter le salon vocal **efface** ses interfaces, ferme ses sessions et retire l’accès au salon texte. Au retour, il ne voit que l’entrée.

Détails techniques :
- `discord/access.ts` : règles pures et testées (permissions, déplacements vocaux, réconciliation, nettoyage). `packages/engine/src/entrance.ts` : le panneau, partagé avec l’émulateur du Studio (« Tester » commence devant l’entrée, avec un bouton pour quitter le salon vocal).
- Le bouton d’entrée a un identifiant sans état (`ke:enter|<bâtiment>`) : il fonctionne après un redémarrage.
- Au démarrage, à la publication et via « Remettre les salons en ordre » (page Discord & voix), le bot vérifie les permissions, redonne l’accès aux joueurs réellement présents, retire celui des absents, met à jour le panneau et supprime tout autre message. Un message posté malgré tout (par un administrateur) est supprimé aussitôt.
- Un jeton d’interaction Discord vit 15 minutes : passé ce délai sans clic, l’interface n’est plus rafraîchie automatiquement (le prochain clic la remet à jour).
- Permissions du bot : Voir les salons, Envoyer des messages, Lire l’historique, Gérer les messages, Gérer les salons, Gérer les rôles (pour les permissions de salon), Se connecter. Intents : Guilds, GuildVoiceStates, GuildMessages (aucun intent privilégié).

## Voix

- `voice/planner.ts` : un bâtiment dont le salon vocal contient au moins un joueur, et qui a une configuration audio, demande une **présence** (identité du personnage, ambiance selon les variables du monde).
- `voice/pool.ts` : attribue les présences aux workers libres et installés sur le bon serveur. Une présence garde son worker tant qu’elle est souhaitée, avec 30 s de grâce après le départ du dernier joueur. Si l’ambiance change (Tempête), le son est mis à jour sans changer de worker.
- `voice/workers.ts` : applique ces décisions sur Discord. Le worker rejoint le salon, prend le nom du personnage, joue l’accueil puis l’ambiance en boucle, ainsi que les sons déclenchés par l’action `audio.play`.

## Horloge du monde

- `packages/engine/src/clock.ts` : fuseau horaire (heure de Paris par défaut, changements d’heure gérés), prochaine programmation, tirage de la météo. Fonctions pures.
- `Engine.tick()` fait avancer la météo et les événements. Le serveur l’appelle toutes les 5 s (`KINGDOM_TICK_SECONDS`). Une nouvelle révision n’est créée que si quelque chose change.
- Un événement compte son temps **hors pauses**. Ses étapes et sa fin sont rejouées au bon moment, même après un redémarrage du serveur. Les créneaux manqués pendant un arrêt ne sont pas rejoués en rafale.
- Les annonces (`EngineEvent` de type `announce`) sont journalisées et publiées dans le salon d’annonces Discord choisi.

## Le modèle d’un monde

Voir `packages/engine/src/model.ts`.

- **Global** : statistiques, objets, bonus, métiers, variables.
- **Bâtiments** : modules génériques (`inventory`, `shop`, `buyback`, `production`, `dialogue`, `dice`) + écrans faits de blocs (texte, encadré, boutons, widgets de modules) + audio.
- **Boutons** : règle *condition → actions → résultat*.
- **Textes** : conditionnels, avec variables (`{player.stat.ecus}`, `{var.phase.label}`…).
