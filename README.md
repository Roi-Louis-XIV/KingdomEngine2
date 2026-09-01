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
- mode smartphone orienté supervision : monde en direct, joueurs, événements, alertes, profil et interventions légères ; la création structurelle reste volontairement sur ordinateur ;
- création de compte avec connexion immédiate, écran d'attente avant attribution d'un royaume, suivi global des inscriptions et réinitialisation administrative des mots de passe ;
- tableau de bord enrichi : services, joueurs, bâtiments, objets, événements, activités, stocks, alertes et classements ;
- bâtiments entièrement no-code avec modes Simple et Avancé, pages Discord, boutons, menus, navigation et organigramme ;
- **Atelier-école no-code** isolé dans l’Académie : démonstration non publiable et non modifiable, utilisant les vrais éditeurs sans toucher au serveur Discord ;
- boutons Discord conditionnels héritant des règles de leur action : rejoindre/quitter un métier et les autres choix incompatibles sont automatiquement masqués ;
- métiers, zones, niveaux, outils, durabilité, expérience, cooldowns et activités temporisées ;
- objets, inventaires joueur et bâtiment, recettes, commerce, productions, livraisons et objectifs collectifs ;
- résultats aléatoires pondérés contenant plusieurs effets génériques ;
- événements, modificateurs du monde, calendrier autonome, saisons, météo et cycle jour/nuit ;
- lieux, connexions, voyages, exploration Discord et monde vivant ;
- bots Discord et pool de workers vocaux : les présences, profils et affectations sont des données génériques, sans identité globale imposée par bâtiment ;
- banque sonore no-code avec préécoute, ambiances, musiques, voix et SFX déclenchés par les actions ;
- administration des joueurs avec pseudos, avatars, inventaires, métiers, outils, activités et cooldowns ;
- supervision client limitée à la santé du monde et aux alertes utiles, sans PID, chemins locaux, journaux globaux ni architecture serveur ;
- import idempotent des contenus V1 : Mine, Forêt, Construction, Forge, Taverne, objets et sons historiques ;
- publication versionnée, contrôle de concurrence, synchronisation live et historique des changements ;
- Académie interactive avec bulles ancrées sur les vrais contrôles, progression par compte et serveur, reprise, saut d’étape et rejeu à volonté.
- dotation en écus des nouveaux joueurs configurable dans **Paramètres → Serment**, versée une seule fois lors du serment.
- bibliothèque visuelle d’emojis avec recherche et catégories pour choisir rapidement l’icône des bâtiments et des objets, tout en conservant la saisie libre.

### Fondations produit et séparation des responsabilités

KingdomEngine conserve les comptes et serveurs existants, puis ajoute par migration idempotente les notions extensibles `Organization`, `World`, `Discord Server`, `Plan`, `Entitlement`, `Quota` et `Usage`. Aucun abonnement commercial n’est codé en dur : le plan technique `standard` sert uniquement de fondation. Un monde appartient à une organisation et peut être relié à un ou plusieurs serveurs Discord.

L’administration interne Payen Studio est une application séparée, disponible à `/platform-admin` uniquement pour le compte défini par `KINGDOM_PLATFORM_ADMIN_USERNAME`. Elle peut voir la santé technique globale ; KingdomWeb client ne révèle ni processus, ni PID, ni chemins de base, ni journaux système globaux, ni autres clients.

Le **Support Mode** se demande depuis le profil. Le client choisit explicitement le monde, les diagnostics autorisés et une durée limitée ; il peut révoquer l’accès à tout moment. Chaque autorisation et révocation est auditée. Les tokens, secrets et conversations privées ne font jamais partie des périmètres proposés.

Les principes d’architecture et la stratégie de migration sont détaillés dans [`docs/ARCHITECTURE_PRINCIPLES.md`](docs/ARCHITECTURE_PRINCIPLES.md) et [`docs/DATA_MIGRATIONS.md`](docs/DATA_MIGRATIONS.md).

### Product Pass 2 — éditeur de monde et présences vocales

La navigation de KingdomWeb est organisée comme un éditeur de monde générique : entités et lieux, espaces interactifs, personnages, activités, objets et ressources, événements, calendrier, environnement, audio et Discord. Le Design System partagé est documenté dans [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

**Présences vocales** distingue clairement l’identité audible de la capacité Discord qui l’exécute. Le Studio permet de créer des présences `Personnage`, `Ambiance` ou `Personnalisée`, de choisir leur lieu, profil vocal, scène audio, priorité, affectation et délai de libération. Les profils regroupent langue, clips, volume, fallback et tags. Sur mobile, ces informations restent consultables mais leur édition structurelle est réservée à l’ordinateur.

Le contenu historique **Le Royaume** est désormais identifié comme content pack de compatibilité dans [`content_packs/le_royaume`](content_packs/le_royaume). `seed.py` et `import_v1.py` restent temporairement le pont de chargement pour ne pas altérer les mondes installés.

### Aide et tutoriels interactifs

Le menu **Aide & tutoriels** affiche deux progressions complémentaires : les étapes guidées déjà parcourues et les objectifs réellement présents dans le royaume. Les parcours disponibles couvrent le premier royaume complet, la création d’un bâtiment, les actions, les métiers et zones, l’interface Discord, l’audio, la météo et les grands Events.

Pendant un parcours, KingdomWeb met en lumière le contrôle réel à utiliser et place une bulle à proximité. Lorsqu’un clic précis est attendu, seule la zone indiquée reste active et l’étape suivante apparaît automatiquement après l’ouverture de la page, de l’onglet ou de la fenêtre. **Passer cette étape** continue le parcours ; **Quitter** le ferme en conservant l’avancement. Un parcours terminé peut être rejoué depuis l’Académie.

Le parcours **Métier et zones** reste entièrement dans le mode Simple : création du métier, choix de l’outil, création de la zone, durée, niveau, énergie et résultats. Le voile pédagogique n’applique aucun flou et laisse la fiche en cours parfaitement lisible.

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

> Règle de maintenance : toute modification d'une commande de lancement, d'une variable `.env`, d'un service systemd, du stockage ou du déploiement doit être répercutée dans ce guide au même moment que le code.

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
sudo bash ./install-debian.sh \
  --data-dir /mnt/hdd/kingdomengine-data \
  --domain kingdom.votre-domaine.fr \
  --email admin@votre-domaine.fr
```

L'installateur effectue automatiquement les opérations suivantes :

- installation de Python, FFmpeg et des dépendances système ;
- création de `.venv` et installation de KingdomEngine ;
- création de `.env` s'il n'existe pas ;
- stockage des bases, sons et images dans le dossier indiqué par `--data-dir` ;
- remplacement du mot de passe `change-me` par un mot de passe aléatoire ;
- exposition de KingdomWeb sur le réseau avec `KINGDOM_WEB_HOST=0.0.0.0` ;
- création et démarrage automatique des services Web, Core et Voice.
- configuration HTTPS automatique avec Caddy lorsque `--domain` est renseigné ;
- activation de la synchronisation GitHub toutes les cinq minutes.

Conserver le mot de passe administrateur affiché par l'installateur. KingdomWeb est ensuite disponible à l'adresse indiquée, généralement :

```text
http://IP_DU_SERVEUR:8000
```

Le paramètre `--data-dir` est facultatif, mais recommandé si le système est sur SSD et qu'un HDD plus volumineux est monté. Le code et `.venv` restent dans `/opt/KingdomEngine2`, tandis que les données évolutives sont placées sur le HDD :

```text
/mnt/hdd/kingdomengine-data/
├── kingdom.db          # base principale
├── servers/            # bases des autres serveurs Discord
└── assets/
    ├── audio/          # sons téléversés
    └── maps/           # fonds de carte
```

Le disque doit être monté avant le démarrage des services. Son montage permanent doit donc être déclaré dans `/etc/fstab` sur le serveur Debian.

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
KINGDOM_PLATFORM_ADMIN_USERNAME=admin
# Facultatif : plafond de présences vocales, sinon capacité physique du pool.
KINGDOM_MAX_CONCURRENT_VOICE_PRESENCES=
```

Les tokens des bots vocaux sont facultatifs. Ils utilisent les variables `EDGAR_BOT_TOKEN`, `EDOUARD_BOT_TOKEN`, `ROLAND_BOT_TOKEN`, `SYLVAIN_BOT_TOKEN` et `WAGNER_BOT_TOKEN`, avec les Application ID correspondants. Ne jamais envoyer le fichier `.env` sur GitHub.

Après une modification de `.env`, redémarrer les services :

```bash
sudo systemctl restart kingdom-web kingdom-core kingdom-voice
```

Dans KingdomWeb, sélectionner le serveur Discord puis utiliser **Paramètres → Installer le serveur Discord**. Cette opération crée les rôles et les salons initiaux. Ensuite, la publication d'un bâtiment crée ou actualise automatiquement ses salons textuel et vocal.

### 3. Rendre KingdomWeb accessible depuis Internet

La méthode recommandée utilise un nom de domaine et Caddy. Caddy obtient et renouvelle automatiquement le certificat HTTPS. Avant l'installation :

1. attribuer une adresse IP locale fixe au serveur Debian, par exemple `192.168.1.50` ;
2. créer chez le fournisseur DNS un enregistrement **A** pour `kingdom.votre-domaine.fr` pointant vers l'adresse IPv4 publique de la connexion ;
3. si IPv6 est utilisée, créer également un enregistrement **AAAA** correct ;
4. rediriger sur la box les ports TCP publics `80` et `443` vers les ports `80` et `443` du serveur Debian ;
5. vérifier que l'opérateur ne bloque pas l'hébergement entrant et que l'IP publique n'est pas placée derrière un CGNAT.

Ouvrir ensuite uniquement HTTP et HTTPS dans UFW :

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Puis lancer ou relancer l'installation avec le domaine :

```bash
cd /opt/KingdomEngine2
sudo bash ./install-debian.sh \
  --data-dir /mnt/hdd/kingdomengine-data \
  --domain kingdom.votre-domaine.fr \
  --email admin@votre-domaine.fr
```

Dans ce mode, KingdomWeb écoute seulement sur `127.0.0.1:8000`. Caddy est le seul service exposé et transmet les requêtes HTTPS. `KINGDOM_SECURE_COOKIES=1` et `KINGDOM_PUBLIC_URL` sont configurés automatiquement.

Vérifier depuis un téléphone en 4G/5G, et non depuis le Wi-Fi local :

```text
https://kingdom.votre-domaine.fr
```

Diagnostic HTTPS :

```bash
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
curl -I https://kingdom.votre-domaine.fr
```

Sans domaine, omettre `--domain` et `--email`. KingdomWeb restera disponible en HTTP sur `http://IP_PUBLIQUE:8000`, après ouverture et redirection du port `8000`. Ce mode est réservé aux tests car les identifiants ne bénéficient pas du chiffrement HTTPS.

### 4. Vérifier et administrer les services

Afficher leur état :

```bash
sudo systemctl status kingdom-web kingdom-core kingdom-voice
```

Redémarrer tout KingdomEngine :

```bash
sudo systemctl restart kingdom-web kingdom-core kingdom-voice
```

Arrêter ou démarrer l'ensemble :

```bash
sudo systemctl stop kingdom-web kingdom-core kingdom-voice
sudo systemctl start kingdom-web kingdom-core kingdom-voice
```

Lire les erreurs sans fenêtre éphémère :

```bash
cd /opt/KingdomEngine2
tail -f var/logs/web.err.log
tail -f var/logs/core.err.log
tail -f var/logs/voice.err.log
```

Les sorties normales sont dans `web.out.log`, `core.out.log` et `voice.out.log`, dans le même dossier.

### 5. Synchronisation automatique avec GitHub

L'installation active `kingdomengine-update.timer`. Toutes les cinq minutes, le serveur :

1. vérifie la branche `agent/kingdomengine2-v2` sur GitHub ;
2. ne fait rien si le code est déjà à jour ;
3. refuse la mise à jour si des fichiers suivis ont été modifiés sur le serveur ;
4. refuse tout historique divergent et n'accepte qu'une avance rapide ;
5. sauvegarde `.env`, les bases et les médias ;
6. récupère le nouveau code et les dépendances Python ;
7. redémarre Web, Core et Voice.

Vérifier le timer et son dernier passage :

```bash
sudo systemctl status kingdomengine-update.timer --no-pager
sudo systemctl status kingdomengine-update.service --no-pager
sudo journalctl -u kingdomengine-update.service -n 100 --no-pager
```

Déclencher immédiatement la même procédure :

```bash
cd /opt/KingdomEngine2
sudo bash ./update-server.sh
```

Pour désactiver volontairement les mises à jour automatiques :

```bash
sudo systemctl disable --now kingdomengine-update.timer
```

Elles peuvent aussi être désactivées lors de l'installation avec `--no-auto-update`.

Si le dépôt GitHub devient privé, configurer une clé de déploiement en lecture seule dans le compte Linux propriétaire de `/opt/KingdomEngine2`, puis utiliser une URL distante SSH. Ne jamais enregistrer un token GitHub dans le README ou dans le dépôt :

```bash
git remote set-url origin git@github.com:Roi-Louis-XIV/KingdomEngine2.git
ssh -T git@github.com
```

### 6. Mise à jour manuelle complète

Sauvegarder les données, récupérer GitHub, réinstaller les éventuelles nouvelles dépendances et redémarrer :

```bash
cd /opt/KingdomEngine2
bash ./backup-server.sh
git switch agent/kingdomengine2-v2
git pull --ff-only
sudo bash ./install-debian.sh \
  --data-dir /mnt/hdd/kingdomengine-data \
  --domain kingdom.votre-domaine.fr \
  --email admin@votre-domaine.fr
```

Le script peut être relancé : il conserve `.env`, les bases de données, les cartes et les fichiers audio. Après la mise à jour, vérifier que les trois services indiquent `active (running)`.

### 7. Déplacer une installation existante du SSD vers le HDD

Arrêter les services avant toute copie de base SQLite :

```bash
cd /opt/KingdomEngine2
sudo systemctl stop kingdom-web kingdom-core kingdom-voice
sudo mkdir -p /mnt/hdd/kingdomengine-data
sudo cp -a var/kingdom.db* /mnt/hdd/kingdomengine-data/ 2>/dev/null || true
sudo cp -a var/servers /mnt/hdd/kingdomengine-data/ 2>/dev/null || true
sudo cp -a KingdomData/assets /mnt/hdd/kingdomengine-data/
sudo bash ./install-debian.sh --data-dir /mnt/hdd/kingdomengine-data
```

Vérifier le fonctionnement dans KingdomWeb avant de supprimer les anciennes copies du SSD. L'installateur enregistre automatiquement `KINGDOM_DATA_DIR` et `KINGDOM_DATABASE` dans `.env`.

### 8. Lancement manuel de secours

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

### 9. Dépannage rapide

| Symptôme | Vérification |
|---|---|
| Le site ne répond pas | `sudo systemctl status kingdom-web` puis `tail -n 100 var/logs/web.err.log` |
| Le site fonctionne sur Debian mais pas depuis un autre PC | vérifier `sudo ufw status`, le port `8000` et la redirection de la box |
| Le domaine ne reçoit pas de certificat HTTPS | vérifier les DNS A/AAAA, les ports 80/443 et `journalctl -u caddy` |
| Le bot Discord reste hors ligne | vérifier `KINGDOM_CORE_TOKEN`, puis redémarrer `kingdom-core` |
| Les bots vocaux ne démarrent pas | vérifier leurs tokens, Application ID, activation dans KingdomWeb et `voice.err.log` |
| Un service indique « address already in use » | rechercher l'ancien processus avec `sudo ss -lptn 'sport = :8000'` |
| Une mise à jour échoue sur Git | ne pas supprimer `.env` ou `var/`; sauvegarder puis vérifier `git status` avant de recommencer |
| La synchronisation GitHub ne se lance pas | vérifier `kingdomengine-update.timer` puis les logs de `kingdomengine-update.service` |

En cas de demande d'aide, transmettre la sortie de ces commandes sans copier les tokens du fichier `.env` :

```bash
sudo systemctl status kingdom-web kingdom-core kingdom-voice --no-pager
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

L'écran de connexion propose **Créer un compte**. Après l'inscription, le nouveau compte est connecté directement et ne voit que son profil et l'ajout de serveur. Il renseigne le nom et l'identifiant de son serveur Discord, devient automatiquement propriétaire de cet espace, puis débloque tous les modules KingdomWeb. Un administrateur peut aussi lui attribuer un serveur existant depuis **Mon profil & serveurs**.

Par défaut, un compte peut administrer jusqu'à 10 serveurs. Cette limite peut être adaptée sur une installation hébergée :

```dotenv
KINGDOM_MAX_SERVERS_PER_ACCOUNT=10
```

L'inscription publique est activée par défaut et limitée contre les créations répétées. Pour la désactiver sur une installation privée :

```dotenv
KINGDOM_ALLOW_REGISTRATION=0
```

Redémarrer `kingdom-web` après modification de cette variable.

La page **Mon profil & serveurs** affiche les serveurs accessibles au compte, l'état d'installation du bot et le rôle détenu sur chacun. Le sélecteur de l'en-tête change de royaume sans mélanger les données : chaque serveur supplémentaire possède sa propre base SQLite sous `var/servers/`, tandis que le registre des comptes et des accès reste centralisé dans KingdomData.

L'administrateur peut créer les profils, ajouter un serveur Discord et attribuer un niveau d'accès : lecture, éditeur, gestionnaire ou propriétaire. Depuis la fiche du serveur, **Installer KingdomEngine sur ce serveur** ouvre l'autorisation Discord de KingdomCore et programme automatiquement la création des rôles, salons généraux et salons de bâtiments. Les bots vocaux sont ensuite ajoutés individuellement, Discord exigeant une autorisation OAuth pour chaque application.

Le bouton **Supprimer ce serveur** demande de recopier son nom avant de lancer la désinstallation. KingdomCore retire dans l'ordre les bots vocaux configurés, les salons et rôles gérés, puis quitte lui-même le serveur Discord. La supervision locale n'est archivée qu'après la réussite de cette opération. Les salons ajoutés manuellement dans une catégorie KingdomEngine sont conservés et signalés. La base KingdomData du royaume reste également sur disque afin d'éviter toute perte irréversible.

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

La gestion audio propose maintenant trois espaces distincts :

- **Banque sonore** : fichiers audio unitaires, écoute, classement et attribution aux bots ;
- **Groupes d’ambiance** : compositions réutilisables associant plusieurs couches (ambiance, musique, voix et SFX), leurs volumes, boucles et transitions. Une fiche Event peut appliquer un groupe à tout le royaume ou à une sélection de bâtiments pendant son occurrence ;
- **Histoires auditives** : chronologies no-code composées d’étapes ordonnées, de sons, de délais, de textes narratifs et d’une option d’attente. Elles constituent le contrat réutilisable prévu pour les expéditions et scénarios audio à venir.

Les anciens groupes enregistrés directement dans les bâtiments restent pris en charge. Les nouveaux groupes autonomes sont versionnés dans KingdomData et peuvent être partagés entre plusieurs bâtiments sans dupliquer leur configuration.

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

Le **Tableau de bord** résume la disponibilité du monde, les bâtiments, objets, stocks, joueurs, événements, tâches, alertes, classements et l’activité récente. **Santé du monde** présente les capacités utiles au client et les alertes fonctionnelles, sans exposer les processus, PID, chemins ou journaux globaux. Ces informations techniques sont réservées à l’administration séparée Payen Studio. **Paramètres serveur** centralise le serment, les règles, les rôles, les catégories, les salons, les messages d’entrée et les couleurs. Les rafraîchissements restent isolés de la navigation active.

Le Studio conserve chaque modification en brouillon. La publication archive la version active précédente. Le contrôle de version empêche deux administrateurs d’écraser silencieusement leurs changements.

## Fiabilité

- transactions SQLite et mode WAL ;
- journal d’action avec identifiant Discord unique contre les doubles clics ;
- publication atomique d’une seule révision active ;
- séparation API/runtime : le Studio peut redémarrer sans couper le bot ;
- sessions sécurisées et rôle `platform_admin` obligatoire sur les routes d’administration interne ;
- accès multi-client filtré par organisation, monde et droits serveur ;
- bus événementiel remplaçable ultérieurement par Redis/NATS.

## Limites assumées de cette fondation

Un client vocal Discord ne lit qu’un flux PCM à la fois : un SFX ou une voix interrompt brièvement le fond sonore, puis l’ambiance reprend automatiquement. La planification cron des événements reste un adaptateur à compléter. Pour plusieurs machines, remplacer la file SQLite et le bus mémoire par Redis/NATS sans modifier les définitions de jeu.
