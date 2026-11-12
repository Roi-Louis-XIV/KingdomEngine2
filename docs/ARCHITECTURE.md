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
| `accounts`, `sessions` | Comptes (mot de passe scrypt facultatif, compte Discord relié), sessions (jetons hachés, appareil, dernière activité) |
| `api_tokens`, `oauth_states` | Jetons d’accès des IA (hachés, niveau lecture / brouillon / publication), connexions Discord en cours (usage unique, 10 min) |
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

## Comptes, IA et suivi

- **Connexion** (`account-api.ts`, `discord/oauth.ts`) : identifiant et mot de passe, ou Discord en OAuth2.
  - Discord ne demande que le scope `identify`, et son jeton n'est pas conservé.
  - L'état OAuth est lié au navigateur par un cookie `Lax` limité à `/api/auth/discord`, et ne sert qu'une fois.
  - Pour relier un compte, on se fie à l'état enregistré côté serveur : le cookie de session `Strict` n'est pas envoyé au retour de Discord.
- **Profil** (`#/profil`) : toute opération sensible exige le mot de passe actuel. Un compte sans mot de passe la confirme par une connexion Discord de moins de 15 minutes (`Platform.confirmIdentity`). Changer de mot de passe ferme les autres sessions.
- **MCP** (`mcp.ts`, `POST /mcp`, JSON-RPC 2.0 sans flux) :
  - authentification par `Bearer ke4_…`, sans cookie ni contrôle CSRF ;
  - un en-tête `Origin` étranger est refusé ;
  - le niveau du jeton filtre les outils, et les droits du compte sur chaque monde s'appliquent en plus ;
  - les écritures passent par `saveDraft` / `publish`, avec contrôle de révision, et sont auditées ;
  - `preview_play` joue un essai dans un moteur neuf et isolé ;
  - guide pour l'IA : `docs/MCP_GUIDE.md`.
- **Statistiques** (`stats.ts`, `GET /api/stats`) :
  - jeton `KINGDOM_STATS_TOKEN` comparé à temps constant ;
  - chiffres agrégés et liste des mondes, sans donnée personnelle ;
  - lues par RoyaumeOS (Observatoire › KingdomEngine) ;
  - `KINGDOM_STATS_LISTEN` ouvre une écoute qui ne sert que cette route.

## Fermeture du monde et salon d'aide

- `world.closure` (`{ when, text }`, Studio › Objets & règles › Règles générales) : tant que la condition est vraie, chaque interface n'affiche que le texte et toute action est refusée. Les interfaces ouvertes basculent au rafraîchissement suivant.
- `{salon.aide}` dans un texte (écran, annonce, fermeture) devient `<#id>` du salon choisi dans Discord & voix › Salon d'aide (`discord.helpChannel`), « #aide » sinon (`discord/access.ts › channelTokens`).

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

**Arrivée et catégories.** Si le monde demande un serment (`world.onboarding`, Studio › Objets & règles › Serment d’arrivée), « Créer les salons manquants » crée une catégorie d’accueil avec le salon du serment (lisible par tous, personne n’y écrit) et le rôle des habitants. Le bouton « Je le jure » (`ke:oath`) donne ce rôle et verse la dotation une seule fois (`Engine.acceptOath`). Chaque bâtiment a **sa propre catégorie** (salon texte + salon vocal côte à côte) ; avec un serment, catégories et salons vocaux ne sont visibles que des habitants. Les salons existants sont déplacés dans la catégorie de leur bâtiment. Le rôle du bot doit être placé au-dessus du rôle des habitants.

Détails techniques :
- `discord/access.ts` : règles pures et testées (permissions, déplacements vocaux, réconciliation, nettoyage). `packages/engine/src/entrance.ts` : le panneau, partagé avec l’émulateur du Studio (« Tester » commence devant l’entrée, avec un bouton pour quitter le salon vocal).
- Le bouton d’entrée a un identifiant sans état (`ke:enter|<bâtiment>`) : il fonctionne après un redémarrage.
- Au démarrage, à la publication et via « Remettre les salons en ordre » (page Discord & voix), le bot vérifie les permissions, redonne l’accès aux joueurs réellement présents, retire celui des absents, met à jour le panneau et supprime tout autre message. Un message posté malgré tout (par un administrateur) est supprimé aussitôt.
- Un jeton d’interaction Discord vit 15 minutes : passé ce délai sans clic, l’interface n’est plus rafraîchie automatiquement (le prochain clic la remet à jour).
- Permissions du bot : Voir les salons, Envoyer des messages, Lire l’historique, Gérer les messages, Gérer les salons, Gérer les rôles (pour les permissions de salon), Se connecter. Intents : Guilds, GuildVoiceStates, GuildMessages (aucun intent privilégié).

## Quêtes personnelles

- `world.quests` : statistique d’XP, niveaux (chances ★ / ★★ / ★★★), nombre de propositions, délai de nouveau tirage, récompenses par difficulté, liste des quêtes (fenêtre de disponibilité, étapes, récompenses propres).
- Le widget `quest.board` affiche les propositions (tirage reproductible : stables d’un affichage à l’autre, renouvelées après une quête, un abandon ou un nouveau tirage). Le joueur en choisit **une**. Le widget `player.sheet` montre endurance, ivresse, XP, niveau et la quête en cours, avec un bouton « Livrer » dans le bon bâtiment.
- L’avancement passe par des **repères** émis par le moteur (activité récupérée, apport à un objectif, achat, dialogue, dés gagnés, objet consommé, réparation) ou par l’action `quest.tag`. Entrer dans un lieu compte pour les étapes « visiter ». Une quête dont la fenêtre se ferme est rendue sans pénalité.

## Voix

- `voice/planner.ts` : pour chaque salon vocal de bâtiment où il y a des joueurs, **un Voice Worker par personnage présent**, à son nom (`world.characters` : domicile + déplacements conditionnels, ex. tous à l'église pour la messe ; à défaut, le `npc` de chaque bâtiment). L'ambiance est jouée par le personnage qui habite le lieu, sinon par un autre présent, sinon par un worker au nom du bâtiment. Un personnage qui se déplace garde son worker, qui change de salon.
- `voice/mixer.ts` : chaque worker **mixe** l'ambiance en boucle et les répliques par-dessus (ffmpeg → PCM 48 kHz, somme par trames de 20 ms → Opus). Les répliques d'un même worker s'enchaînent. Un worker sans ambiance n'émet que pendant ses répliques (on voit sur Discord qui parle).
- `audio.play` avec `character` = réplique dite par ce personnage là où il se trouve ; sans, le son est joué par le worker qui tient l'ambiance du bâtiment.
- **Ambiance permanente** (`world.settings.voiceAlways`) : les workers restent même dans les salons vides (désactivé dans la bêta).
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
