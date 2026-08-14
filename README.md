# KingdomEngine 2

V2 modulaire de KingdomEngine : un moteur de jeu no-code conçu pour Discord. Les bâtiments, interfaces, objets, événements, bots et réactions audio sont versionnés dans `KingdomData` et administrables depuis **Kingdom Studio**.

## Les cinq modules

| Module | Responsabilité |
|---|---|
| `kingdomCore` | Interprétation transactionnelle des actions et interface Discord dynamique |
| `KingdomVoice` | Réactions voix, musique et SFX déclenchées par événements |
| `KingdomData` | Source de vérité SQLite, validation, révisions et publication |
| `kingdomEvent` | Contrat événementiel asynchrone entre modules |
| `KingdomWeb` | Studio no-code et API sécurisée |

La règle structurante est : **les modules dépendent des contrats, jamais des écrans ni d’un bâtiment concret**. Ajouter un bâtiment ne demande donc aucun cog, repository ou service Python.

## Démarrage

```powershell
cd D:\KingdomEngine2
py -3.11 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
Copy-Item .env.example .env
.venv\Scripts\python run.py web
```

Ouvrir `http://127.0.0.1:8000`. Le jeton de développement est `change-me`; il faut définir `KINGDOM_ADMIN_TOKEN` en production.

Pour Discord, renseigner `KINGDOM_CORE_TOKEN`, puis :

```powershell
.venv\Scripts\python run.py core
```

Les bots vocaux se configurent dans **Bots Discord**. Le Studio stocke uniquement le nom de la variable d’environnement, jamais le secret. Ajoutez les tokens dans `.env`, activez et publiez les profils concernés, puis lancez :

```powershell
.venv\Scripts\python run.py voice
```

Pour inviter un bot vocal depuis le Studio, renseigner son Application ID dans `.env` (`EDGAR_APPLICATION_ID`, `ROLAND_APPLICATION_ID`, etc.), redémarrer KingdomWeb, puis cliquer sur **Inviter** sur sa carte. Chaque fiche référence uniquement le nom de cette variable. Le lien OAuth est généré automatiquement avec les permissions vocales nécessaires ; aucun token ni identifiant sensible n’est enregistré dans KingdomData.

Pour tout lancer ensemble sur la machine de test :

```powershell
.\start-test-server.ps1 -WithVoice
```

Le superviseur lance une identité Discord indépendante par profil activé. Un bot rejoint son salon quand un joueur y entre, joue son accueil et son ambiance, puis se déconnecte après le délai configuré. `FFMPEG_PATH` permet d’indiquer le chemin de FFmpeg s’il n’est pas dans le `PATH`.

Au premier lancement du Studio, les 48 objets, les cinq profils vocaux, les cinq lieux historiques et leurs cinq interfaces présents dans `KingdomEngine` V1 sont importés et publiés automatiquement : Mine, Forêt, Forge, Taverne et chantier du Pont royal. Les marchés de livraison et le catalogue de rumeurs sont également repris. L’import est idempotent : une définition V2 existante n’est jamais écrasée.

La commande `/royaume` propose automatiquement tous les bâtiments publiés et construit leurs boutons depuis les données.

## Installation sur un serveur de test Windows

Depuis PowerShell :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

Compléter ensuite `.env` avec `KINGDOM_APPLICATION_ID`, `KINGDOM_CORE_TOKEN` et `KINGDOM_GUILD_ID`. L’identifiant d’application se trouve dans **Discord Developer Portal → General Information**. Générer le lien d’invitation sécurisé :

```powershell
.venv\Scripts\python.exe run.py invite-url
```

Ouvrir ce lien, sélectionner le serveur test, puis placer le rôle du bot au-dessus des rôles KingdomEngine. Dans **Bot → Privileged Gateway Intents**, activer **Server Members Intent**. Provisionner ensuite le serveur :

```powershell
.\install.ps1 -ProvisionDiscord
```

Cette commande crée ou met à jour :

- `👑 Maître du Royaume`, attribué au propriétaire du serveur ;
- `⚔️ Aventurier`, attribué uniquement après le Serment de la Sainte Pelle ;
- `🤖 Bots du Royaume`, attribué aux comptes bots ;
- la catégorie `🏰 KINGDOM ENGINE` ;
- les salons d’accueil, de commandes et d’administration privée ;
- un salon de prestation de serment avec les règles configurées ;
- une catégorie dédiée, un salon textuel et un salon vocal pour chaque bâtiment publié.

Les membres non assermentés ne voient pas le Royaume. Après le serment, ils voient les bâtiments autorisés par leurs rôles. Le salon textuel d'un bâtiment devient visible pendant leur présence dans son salon vocal ; le message d'entrée et l'interface interactive y sont alors publiés automatiquement. Les noms, textes, rôles, catégories et règles se modifient dans **Paramètres serveur**.

Le rôle du bot doit rester au-dessus de ces trois rôles, car Discord interdit à un bot de gérer un rôle supérieur au sien. Le provisionneur ne demande pas la permission `Administrateur` et peut être relancé sans créer de doublons. Cette contrainte suit la [hiérarchie officielle des permissions Discord](https://docs.discord.com/developers/topics/permissions) et les [permissions de salons discord.py](https://discordpy.readthedocs.io/en/stable/api.html).

Pour lancer le Studio et le Core :

```powershell
.\start-test-server.ps1
```

Avec les bots vocaux :

```powershell
.\start-test-server.ps1 -WithVoice
```

Arrêt propre :

```powershell
.\stop-test-server.ps1
```

## Modèle no-code

Une action contient une liste d’effets génériques :

- `message` : réponse au joueur ;
- `reward` / `cost` : monnaie, énergie ou inventaire ;
- `random_reward` : table de butin pondérée ;
- `random_bundle` / `random_message` : lots ou dialogues pondérés ;
- `stock_cost` / `stock_reward` : stocks communs d’un bâtiment ;
- `profession` / `durability` : métiers, expérience et usure ;
- `repair` / `upgrade` : réparation et amélioration paramétrées ;
- `emit` : événement consommable par Voice ou un futur module.

Un bâtiment peut utiliser des actions manuelles ou le mode `generated`. Dans ce second mode, le moteur régénère ses actions à chaque lecture depuis sa configuration `modules`. Tous les paramètres V1 — PNJ, énergie, métiers, niveaux, durées, butins, stocks, produits, recettes, livraisons, réparations, améliorations, rumeurs, jeux et chantiers — sont modifiables dans **Configuration modulaire complète** depuis KingdomWeb. Une publication suffit pour changer le comportement du Core ; aucune constante métier n’est recopiée dans un cog Discord.

## Éditeur visuel, tableau de bord et supervision

L'interface et la mécanique sont réunies dans la même fiche **Bâtiment**. L'onglet **Fonctionnement** gère actions, modules et conditions d'accès ; l'onglet **Interface & navigation** gère les pages et les composants réutilisables (`hero`, texte, carte, indicateur, séparateur, image, bouton et menu déroulant). Les composants sont ajoutés et réordonnés par glisser-déposer. La grille Discord matérialise les 25 emplacements disponibles, sur cinq lignes. Un bouton ou une option de menu peut :

- ouvrir une autre page de la même interface ;
- lancer n’importe quelle action publiée d’un bâtiment.

Le bâtiment publié contient directement ce document visuel et il est interprété par Discord : le canvas KingdomWeb et le bot utilisent donc le même contrat, sans vue spécifique codée par bâtiment. Les anciennes entités `interface` sont migrées automatiquement et restent lisibles pour compatibilité.

Le **Tableau de bord** résume services, bâtiments, joueurs, événements et actions importantes. **Supervision** expose le pilotage des services configurés dans `KingdomWeb/services.json`, leurs journaux, les publications, tâches, stocks, joueurs, inventaires et l'activité récente. **Paramètres serveur** centralise le serment, les règles, les rôles, les catégories, les salons, les messages d'entrée et les couleurs. La supervision se rafraîchit automatiquement sans interrompre le Core.

Le Studio conserve chaque modification en brouillon. La publication archive la version active précédente. Le contrôle de version empêche deux administrateurs d’écraser silencieusement leurs changements.

## Fiabilité

- transactions SQLite et mode WAL ;
- journal d’action avec identifiant Discord unique contre les doubles clics ;
- publication atomique d’une seule révision active ;
- séparation API/runtime : le Studio peut redémarrer sans couper le bot ;
- jeton Bearer obligatoire sur toutes les routes d’administration ;
- bus événementiel remplaçable ultérieurement par Redis/NATS.

## Limites assumées de cette fondation

Le transport vocal Discord complet et la planification cron des événements sont des adaptateurs à brancher sur les contrats présents. Le modèle, le Studio, l’exécution transactionnelle, le bot dynamique et les réactions audio événementielles sont déjà opérationnels. Pour plusieurs processus ou plusieurs machines, remplacer le bus mémoire par Redis et SQLite par PostgreSQL sans modifier les définitions de jeu.
