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

## Fonctionnalités disponibles

- studio web responsive avec comptes, profils, collaborateurs, permissions et séparation des serveurs Discord ;
- tableau de bord enrichi : services, joueurs, bâtiments, objets, événements, activités, stocks, alertes et classements ;
- bâtiments entièrement no-code avec modes Simple et Avancé, pages Discord, boutons, menus, navigation et organigramme ;
- métiers, zones, niveaux, outils, durabilité, expérience, cooldowns et activités temporisées ;
- objets, inventaires joueur et bâtiment, recettes, commerce, productions, livraisons et objectifs collectifs ;
- résultats aléatoires pondérés contenant plusieurs effets génériques ;
- événements, modificateurs du monde, calendrier autonome, saisons, météo et cycle jour/nuit ;
- lieux, connexions, voyages, exploration Discord et monde vivant ;
- bots Discord et bots vocaux indépendants, association aux bâtiments et provisionnement des salons ;
- banque sonore no-code avec préécoute, ambiances, musiques, voix et SFX déclenchés par les actions ;
- administration des joueurs avec pseudos, avatars, inventaires, métiers, outils, activités et cooldowns ;
- supervision des services, journaux consultables, arrêt/redémarrage et état de la base SQLite ;
- import idempotent des contenus V1 : Mine, Forêt, Construction, Forge, Taverne, objets et sons historiques ;
- publication versionnée, contrôle de concurrence, synchronisation live et historique des changements ;
- tutoriels intégrés et aide contextuelle non bloquante dans le Studio.

## Démarrage

Sous Windows, le lanceur PowerShell est le point d’entrée recommandé. Après la première installation et la configuration de `.env` :

```powershell
cd E:\Dev\KingdomEngine2
.\start-test-server.ps1
```

Cette commande démarre automatiquement **KingdomWeb, KingdomCore et KingdomVoice**, écrit leurs sorties dans `var\logs` et ouvre le Studio sur `http://127.0.0.1:8000`. Elle peut être relancée sans créer un second exemplaire des services déjà actifs.

Pour travailler sans les bots vocaux :

```powershell
.\start-test-server.ps1 -WithoutVoice
```

Pour tout arrêter proprement :

```powershell
.\stop-test-server.ps1
```

## Guide serveur Debian — pour Atilla

Ce guide suffit pour installer, démarrer et mettre à jour KingdomEngine sur le serveur. Les commandes sont à exécuter dans un terminal Debian. L'installation conserve les données dans `var/` et les secrets dans `.env`.

Checklist rapide pour Atilla :

1. cloner le projet dans `/opt/KingdomEngine2` ;
2. lancer `sudo bash ./install-debian.sh` ;
3. compléter les identifiants Discord dans `.env` ;
4. redémarrer les trois services ;
5. ouvrir le port `8000` et tester KingdomWeb depuis un autre ordinateur ;
6. lancer **Installer le serveur Discord** une seule fois depuis KingdomWeb.

### 1. Première installation

Installer Git, récupérer la branche de développement puis lancer l'installateur :

```bash
sudo apt update
sudo apt install -y git
cd /opt
sudo git clone --branch agent/kingdomengine2-v2 https://github.com/Roi-Louis-XIV/KingdomEngine2.git
sudo chown -R "$USER":"$USER" /opt/KingdomEngine2
cd /opt/KingdomEngine2
sudo bash ./install-debian.sh
```

L'installateur effectue automatiquement les opérations suivantes :

- installation de Python, FFmpeg et des dépendances système ;
- création de `.venv` et installation de KingdomEngine ;
- création de `.env` s'il n'existe pas ;
- remplacement du mot de passe `change-me` par un mot de passe aléatoire ;
- exposition de KingdomWeb sur le réseau avec `KINGDOM_WEB_HOST=0.0.0.0` ;
- création et démarrage automatique des services Web, Core et Voice.

Conserver le mot de passe administrateur affiché par l'installateur. KingdomWeb est ensuite disponible à l'adresse indiquée, généralement :

```text
http://IP_DU_SERVEUR:8000
```

### 2. Configuration Discord

Ouvrir le fichier de configuration :

```bash
cd /opt/KingdomEngine2
nano .env
```

Renseigner au minimum :

```dotenv
KINGDOM_CORE_TOKEN=token_du_bot_principal
KINGDOM_APPLICATION_ID=id_application_du_bot_principal
KINGDOM_GUILD_ID=id_du_serveur_discord_principal
KINGDOM_ADMIN_USERNAME=admin
KINGDOM_ADMIN_PASSWORD=mot_de_passe_solide
```

Les tokens des bots vocaux sont facultatifs. Ils utilisent les variables `EDGAR_BOT_TOKEN`, `EDOUARD_BOT_TOKEN`, `ROLAND_BOT_TOKEN`, `SYLVAIN_BOT_TOKEN` et `WAGNER_BOT_TOKEN`, avec les Application ID correspondants. Ne jamais envoyer le fichier `.env` sur GitHub.

Après une modification de `.env`, redémarrer les services :

```bash
sudo systemctl restart kingdomengine-web kingdomengine-core kingdomengine-voice
```

Dans KingdomWeb, sélectionner le serveur Discord puis utiliser **Paramètres → Installer le serveur Discord**. Cette opération crée les rôles et les salons initiaux. Ensuite, la publication d'un bâtiment crée ou actualise automatiquement ses salons textuel et vocal.

### 3. Autoriser l'accès réseau

Si UFW est utilisé sur le serveur :

```bash
sudo ufw allow 8000/tcp
sudo ufw status
```

Pour un serveur hébergé à domicile, rediriger également le port TCP `8000` de la box vers l'adresse locale du serveur Debian. Pour une mise en production publique, utiliser ensuite un nom de domaine et un reverse proxy HTTPS ; activer `KINGDOM_SECURE_COOKIES=1` uniquement lorsque HTTPS est opérationnel.

Vérifier depuis une autre machine :

```bash
curl -I http://IP_DU_SERVEUR:8000
```

### 4. Vérifier et administrer les services

Afficher leur état :

```bash
sudo systemctl status kingdomengine-web kingdomengine-core kingdomengine-voice
```

Redémarrer tout KingdomEngine :

```bash
sudo systemctl restart kingdomengine-web kingdomengine-core kingdomengine-voice
```

Arrêter ou démarrer l'ensemble :

```bash
sudo systemctl stop kingdomengine-web kingdomengine-core kingdomengine-voice
sudo systemctl start kingdomengine-web kingdomengine-core kingdomengine-voice
```

Lire les erreurs sans fenêtre éphémère :

```bash
cd /opt/KingdomEngine2
tail -f var/logs/web.err.log
tail -f var/logs/core.err.log
tail -f var/logs/voice.err.log
```

Les sorties normales sont dans `web.out.log`, `core.out.log` et `voice.out.log`, dans le même dossier.

### 5. Mettre KingdomEngine à jour

Sauvegarder les données, récupérer GitHub, réinstaller les éventuelles nouvelles dépendances et redémarrer :

```bash
cd /opt/KingdomEngine2
tar -czf "$HOME/kingdomengine-backup-$(date +%F-%H%M).tar.gz" .env var KingdomData/assets
git switch agent/kingdomengine2-v2
git pull --ff-only
sudo bash ./install-debian.sh
```

Le script peut être relancé : il conserve `.env`, les bases de données, les cartes et les fichiers audio. Après la mise à jour, vérifier que les trois services indiquent `active (running)`.

### 6. Lancement manuel de secours

Si systemd n'est pas souhaité, ou pour un diagnostic ponctuel :

```bash
cd /opt/KingdomEngine2
bash ./start-server.sh
bash ./stop-server.sh
```

Pour consulter rapidement les dernières erreurs :

```bash
tail -n 100 var/logs/web.err.log
tail -n 100 var/logs/core.err.log
tail -n 100 var/logs/voice.err.log
```

### 7. Dépannage rapide

| Symptôme | Vérification |
|---|---|
| Le site ne répond pas | `sudo systemctl status kingdomengine-web` puis `tail -n 100 var/logs/web.err.log` |
| Le site fonctionne sur Debian mais pas depuis un autre PC | vérifier `sudo ufw status`, le port `8000` et la redirection de la box |
| Le bot Discord reste hors ligne | vérifier `KINGDOM_CORE_TOKEN`, puis redémarrer `kingdomengine-core` |
| Les bots vocaux ne démarrent pas | vérifier leurs tokens, Application ID, activation dans KingdomWeb et `voice.err.log` |
| Un service indique « address already in use » | rechercher l'ancien processus avec `sudo ss -lptn 'sport = :8000'` |
| Une mise à jour échoue sur Git | ne pas supprimer `.env` ou `var/`; sauvegarder puis vérifier `git status` avant de recommencer |

En cas de demande d'aide, transmettre la sortie de ces commandes sans copier les tokens du fichier `.env` :

```bash
sudo systemctl status kingdomengine-web kingdomengine-core kingdomengine-voice --no-pager
tail -n 100 var/logs/web.err.log
tail -n 100 var/logs/core.err.log
tail -n 100 var/logs/voice.err.log
```

Lors d’une toute première installation seulement :

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

Ouvrir `http://127.0.0.1:8000`, puis se connecter avec `KINGDOM_ADMIN_USERNAME` et `KINGDOM_ADMIN_PASSWORD` (par défaut `admin` / `change-me` en développement). Le compte administrateur initial est créé au premier démarrage. Il faut impérativement changer ces valeurs en production. `KINGDOM_ADMIN_TOKEN` reste disponible pour les scripts et les anciens clients API, mais l'interface n'enregistre plus ce secret dans le navigateur.

### Comptes et serveurs Discord

La page **Mon profil & serveurs** affiche les serveurs accessibles au compte, l'état d'installation du bot et le rôle détenu sur chacun. Le sélecteur de l'en-tête change de royaume sans mélanger les données : chaque serveur supplémentaire possède sa propre base SQLite sous `var/servers/`, tandis que le registre des comptes et des accès reste centralisé dans KingdomData.

L'administrateur peut créer les profils, ajouter un serveur Discord et attribuer un niveau d'accès : lecture, éditeur, gestionnaire ou propriétaire. Les liens d'installation Discord sont générés pour le serveur sélectionné. KingdomCore confirme ensuite automatiquement dans le profil les serveurs sur lesquels le bot est réellement présent.

Pour Discord, renseigner `KINGDOM_CORE_TOKEN`, puis :

```powershell
.venv\Scripts\python run.py core
```

Les bots vocaux se configurent dans **Bots Discord**. Le Studio stocke uniquement le nom de la variable d’environnement, jamais le secret. Ajoutez les tokens dans `.env`, activez et publiez les profils concernés, puis lancez :

```powershell
.venv\Scripts\python run.py voice
```

Pour inviter un bot vocal depuis le Studio, renseigner son Application ID dans `.env` (`EDGAR_APPLICATION_ID`, `ROLAND_APPLICATION_ID`, etc.), redémarrer KingdomWeb, puis cliquer sur **Inviter** sur sa carte. Chaque fiche référence uniquement le nom de cette variable. Le lien OAuth est généré automatiquement avec les permissions vocales nécessaires ; aucun token ni identifiant sensible n’est enregistré dans KingdomData.

Le lancement manuel reste disponible pour diagnostiquer un module isolé, mais n’est pas nécessaire au quotidien :

```powershell
.venv\Scripts\python.exe run.py voice
```

Le superviseur lance une identité Discord indépendante par profil activé. Un bot rejoint son salon quand un joueur y entre, joue son accueil et son ambiance, puis se déconnecte après le délai configuré. `FFMPEG_PATH` permet d’indiquer le chemin de FFmpeg s’il n’est pas dans le `PATH`.

### Banque sonore no-code

Le menu **Voix & audio** importe les fichiers MP3, WAV, OGG, FLAC, M4A, AAC et OPUS directement dans `KingdomData/assets/audio`. Chaque son possède un type (voix, musique, ambiance ou SFX), des mots-clés, un volume et, si nécessaire, un bot parlant. Le menu **Bots Discord** attribue un bot vocal à un bâtiment ; après provisionnement, l’identifiant réel du salon vocal est conservé dans KingdomData et utilisé automatiquement.

Dans la fiche d’un bâtiment, l’onglet **Gestion sonore** compose des groupes de musique, ambiance, SFX et voix. Un groupe général démarre quand des joueurs entrent dans le vocal. Une action ou un résultat aléatoire peut jouer un son ponctuel ou changer de groupe, et une règle événementielle peut basculer l’ambiance. Ces demandes transitent par la file SQLite `audio_queue`, afin que KingdomCore et KingdomVoice restent fiables lorsqu’ils tournent dans des processus séparés.

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

Ouvrir ce lien, sélectionner le serveur test, puis placer le rôle du bot au-dessus des rôles KingdomEngine. Dans **Bot → Privileged Gateway Intents**, activer **Server Members Intent**. Démarrer KingdomCore, puis installer ou mettre à jour le serveur depuis **Paramètres → Installer le serveur Discord**, ou avec cette commande :

```powershell
.venv\Scripts\python.exe run.py discord-sync
```

La demande est traitée par KingdomCore déjà connecté, ce qui évite de lancer une seconde session du bot. Après l'installation initiale, chaque publication de bâtiment crée ou met à jour automatiquement sa catégorie et ses salons Discord correspondants.

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

Pour lancer tout KingdomEngine :

```powershell
.\start-test-server.ps1
```

Sans les bots vocaux :

```powershell
.\start-test-server.ps1 -WithoutVoice
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
- `play_audio` / `set_audio_group` : lecture ponctuelle et changement d’ambiance dans le bâtiment courant ;
- `profession_join` / `profession_leave` / `profession_experience` : cycle de vie explicite d'un métier ;
- `tool_grant` / `tool_modify` : état initial, niveau, bonus et durabilité d'un outil ;
- `production` : ressource dirigée explicitement vers le joueur ou un stock de bâtiment ;
- `schedule` / `claim_scheduled` : activité différée dont le hasard est figé au lancement ;
- `contribution` : historique détaillé d'un objectif collectif.

Les actions acceptent des conditions récursives `all`, `any` et `not`, avec les opérateurs `=`, `!=`, `>`, `>=`, `<` et `<=`. Elles peuvent vérifier ressources, inventaire, métier, niveau, outil, durabilité, vocal, rôle Discord, activités, cooldowns, stocks et états joueur. Les hooks `on_start`, `on_success`, `on_failure` et `on_claim` émettent des événements configurés dans les données.

Un bâtiment peut utiliser des actions manuelles ou le mode `generated`. Dans ce second mode, le moteur régénère ses actions à chaque lecture depuis sa configuration `modules`. Les usages courants — métiers, zones, prérequis, outils, niveaux, durées, limites, résultats multi-effets, destinations et événements — disposent d'éditeurs structurés dans KingdomWeb. La zone de configuration intégrale reste uniquement un outil avancé de compatibilité pour les modules historiques. Une publication suffit pour changer le comportement du Core ; aucune constante métier n’est recopiée dans un cog Discord.

### Migration du contrat Phase 0

Au démarrage, `ContentStore.initialize()` ajoute sans perte `result_json` et `claim_hooks_json` aux activités existantes ainsi que la table `collective_contributions`. Les anciennes portées `building` et `action` sont interprétées comme `player_building` et `player_action`. Les effets historiques `profession`, `durability`, `reward`, `stock_reward`, `random_reward` et `random_bundle` restent compatibles. Les nouvelles activités tirent leurs résultats aléatoires une seule fois au lancement ; une activité déjà en attente avant la migration conserve son ancien document jusqu'à sa récupération.

## Éditeur visuel, tableau de bord et supervision

L'interface et la mécanique sont réunies dans la même fiche **Bâtiment**. L'onglet **Fonctionnement** gère actions, modules et conditions d'accès ; l'onglet **Interface & navigation** gère les pages et les composants réutilisables (`hero`, texte, carte, indicateur, séparateur, image, bouton et menu déroulant). Les composants sont ajoutés et réordonnés par glisser-déposer. La grille Discord matérialise les 25 emplacements disponibles, sur cinq lignes. Un bouton ou une option de menu peut :

- ouvrir une autre page de la même interface ;
- lancer n’importe quelle action publiée d’un bâtiment.

Le bâtiment publié contient directement ce document visuel et il est interprété par Discord : le canvas KingdomWeb et le bot utilisent donc le même contrat, sans vue spécifique codée par bâtiment. Les anciennes entités `interface` sont migrées automatiquement et restent lisibles pour compatibilité.

Le **Tableau de bord** résume services, bâtiments, objets, stocks, joueurs, événements, tâches, alertes, classements et activité récente. **Services & journaux** expose le pilotage des services configurés dans `KingdomWeb/services.json`, leur état visuel, leurs PID, les commandes fiables de démarrage/arrêt/redémarrage, les journaux copiables, les publications, tâches, stocks, joueurs, inventaires et l'activité récente. **Paramètres serveur** centralise le serment, les règles, les rôles, les catégories, les salons, les messages d'entrée et les couleurs. La supervision se rafraîchit automatiquement sans interrompre le Core et suspend son rafraîchissement pendant la lecture des logs.

Le Studio conserve chaque modification en brouillon. La publication archive la version active précédente. Le contrôle de version empêche deux administrateurs d’écraser silencieusement leurs changements.

## Fiabilité

- transactions SQLite et mode WAL ;
- journal d’action avec identifiant Discord unique contre les doubles clics ;
- publication atomique d’une seule révision active ;
- séparation API/runtime : le Studio peut redémarrer sans couper le bot ;
- jeton Bearer obligatoire sur toutes les routes d’administration ;
- bus événementiel remplaçable ultérieurement par Redis/NATS.

## Limites assumées de cette fondation

Un client vocal Discord ne lit qu’un flux PCM à la fois : un SFX ou une voix interrompt brièvement le fond sonore, puis l’ambiance reprend automatiquement. La planification cron des événements reste un adaptateur à compléter. Pour plusieurs machines, remplacer la file SQLite et le bus mémoire par Redis/NATS sans modifier les définitions de jeu.
