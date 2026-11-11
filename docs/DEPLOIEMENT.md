# Installer KingdomEngine 4 sur un serveur Debian

Testé pour Debian 12 (Bookworm) et 13 (Trixie). Il faut un accès root (ou `sudo`) et une connexion Internet.

## 1. Installation (5 minutes)

```sh
curl -fsSLO https://raw.githubusercontent.com/Roi-Louis-XIV/KingdomEngine2/kingdomengine4/deploy/install-debian.sh
sudo bash install-debian.sh
```

Tout est installé sous le nom **kingdomengineNext**, séparé de KingdomEngine2 (`/opt/kingdomengine` n’est jamais touché, et le script refuse d’écraser un dossier qui n’est pas le sien) :

| Élément | Emplacement |
|---|---|
| Code | `/opt/kingdomengineNext` |
| Données (base, sons) | `/var/lib/kingdomengineNextNext` |
| Configuration (secrets) | `/etc/kingdomengineNext.env` |
| Sauvegardes | `/var/backups/kingdomengineNextNext` |
| Service systemd | `kingdomengineNext` (utilisateur système `kingdomnext`) |
| Port local | 8090 (ou le suivant libre) |

Le script installe Node.js 22, git, FFmpeg et sqlite3. Il compile le Studio, **lance les tests** (et s’arrête si l’un échoue), crée le service `kingdomengineNext` et une sauvegarde quotidienne. On peut le relancer sans risque : il ne touche ni aux données ni à la configuration existantes.

> **KingdomEngine2 peut continuer à tourner à côté.** Seule règle : n’utilise jamais le même jeton de bot Discord dans les deux versions en même temps. Crée de nouvelles applications Discord pour KE4, ou arrête d’abord les services de KE2.

## 2. Configuration

```sh
sudo nano /etc/kingdomengineNext.env
sudo systemctl restart kingdomengineNext
```

| Réglage | Rôle |
|---|---|
| `KINGDOM_CORE_TOKEN` | Jeton du bot principal (Discord Developer Portal → Bot → Reset Token) |
| `VOICE_WORKER_1_TOKEN`, `VOICE_WORKER_1_APPLICATION_ID`, … | Un bot par connexion vocale simultanée |
| `KINGDOM_PORT` | Port local du Studio (8090 par défaut ici) |
| `KINGDOM_HOST` | `127.0.0.1` derrière nginx (défaut), `0.0.0.0` pour un accès direct sur le réseau local |
| `KINGDOM_SECURE_COOKIES` | `1` dès que le Studio est servi en HTTPS |
| `KINGDOM_ALLOW_REGISTRATION` | `0` par défaut sur un serveur : tu crées toi-même les comptes dans Administration |
| `KINGDOM_PUBLIC_URL` | Adresse du Studio, ex. `https://studio.exemple.fr` (connexion Discord, adresse MCP) |
| `KINGDOM_DISCORD_CLIENT_ID`, `KINGDOM_DISCORD_CLIENT_SECRET` | Active « Se connecter avec Discord » (voir ci-dessous) |
| `KINGDOM_STATS_TOKEN` | Jeton du suivi par RoyaumeOS (32 caractères minimum) |
| `KINGDOM_STATS_LISTEN` | Facultatif : écoute réservée aux statistiques, ex. `172.17.0.1:8091` |

Ce fichier contient des secrets : il n’est lisible que par root et le service.

## 3. Accéder au Studio

**Avec un nom de domaine (recommandé)** : HTTPS gratuit avec nginx et Let’s Encrypt.

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
sudo bash /opt/kingdomengineNext/deploy/update.sh       # génère /etc/nginx/sites-available/kingdomengineNext si nginx vient d'être installé
sudo nano /etc/nginx/sites-available/kingdomengineNext  # remplace studio.exemple.fr par ton domaine
sudo ln -s /etc/nginx/sites-available/kingdomengineNext /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ton-domaine.fr
```

Puis mets `KINGDOM_SECURE_COOKIES=1` dans `/etc/kingdomengineNext.env` et redémarre le service.

**Sans domaine** : passe par un tunnel SSH depuis ton PC, sans rien ouvrir sur Internet.

```sh
ssh -L 8090:127.0.0.1:8090 utilisateur@ip-du-serveur
```

Ouvre ensuite http://localhost:8090 sur ton PC (le script affiche le port exact à la fin).

Au premier accès, crée ton compte : **le premier compte est administrateur**.

## 4. Comptes, IA et suivi

### Se connecter avec Discord

1. Discord Developer Portal → l’application du **bot principal** (ou une autre) → **OAuth2**.
2. Copie le **Client ID**, puis **Reset Secret** pour obtenir le Client Secret.
3. Dans **Redirects**, ajoute `https://ton-domaine.fr/api/auth/discord/callback` (exactement l’adresse de `KINGDOM_PUBLIC_URL`, suivie de ce chemin).
4. Dans `/etc/kingdomengineNext.env` : `KINGDOM_PUBLIC_URL`, `KINGDOM_DISCORD_CLIENT_ID`, `KINGDOM_DISCORD_CLIENT_SECRET`, puis redémarre.

Seul le scope `identify` est demandé (identifiant, pseudo, avatar) : ni e-mail, ni liste de serveurs. Le jeton Discord n’est pas conservé.

- **Comptes existants** : connecte-toi avec ton identifiant, puis **Mon profil › Relier mon compte Discord**.
- **Nouvelles personnes** : avec les inscriptions fermées, crée le compte dans **Administration › Nouveau compte** en renseignant son **identifiant Discord**, sans mot de passe. La personne clique ensuite sur « Se connecter avec Discord ».
- Avec les inscriptions ouvertes, un clic sur « Se connecter avec Discord » suffit à créer le compte.

**Mon profil** (en bas à gauche du Studio) regroupe :

- le nom affiché et l’identifiant ;
- Discord et le mot de passe : un changement exige le mot de passe actuel et déconnecte les autres appareils ;
- les appareils connectés, chacun déconnectable ;
- les jetons pour les IA ;
- la suppression du compte.

Un compte sans mot de passe confirme les opérations sensibles par une connexion Discord de moins de 15 minutes.

### Les IA (MCP)

Le Studio expose un serveur MCP à l’adresse `https://ton-domaine.fr/mcp`. Dans **Mon profil › Jetons d’accès pour les IA**, crée un jeton avec l’un de ces niveaux :

- lecture seule ;
- lecture et brouillon ;
- brouillon et publication.

La fenêtre affiche la commande à copier pour Claude Code et la configuration de Claude Desktop. Les droits du compte sur chaque monde s’appliquent en plus de ceux du jeton. Chaque modification faite par une IA est inscrite au journal du monde. Le guide lu par l’IA est `docs/MCP_GUIDE.md`.

### Suivi par RoyaumeOS

RoyaumeOS lit `GET /api/stats` avec l’en-tête `Authorization: Bearer <KINGDOM_STATS_TOKEN>`. La réponse ne contient que des chiffres agrégés et la liste des mondes : aucun pseudo, aucun identifiant Discord.

1. Génère un jeton : `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
2. Mets-le dans `KINGDOM_STATS_TOKEN` ici, et dans `KINGDOMENGINE_STATS_TOKEN` du `.env` de RoyaumeOS.
3. Choisis l’adresse que RoyaumeOS utilisera :
   - **Si le Studio a un domaine en HTTPS** : `KINGDOMENGINE_URL=https://ton-domaine.fr`. C’est le plus simple.
   - **Sinon** : `KINGDOM_STATS_LISTEN=172.17.0.1:8091` ici. Cette écoute dédiée ne sert que les statistiques, sur l’interface Docker du serveur. Dans RoyaumeOS, mets `KINGDOMENGINE_URL=http://host.docker.internal:8091`.
4. Redémarre les deux, puis ouvre **Observatoire › KingdomEngine** dans RoyaumeOS.

Vérification depuis le serveur :

```sh
curl -s -H "Authorization: Bearer <jeton>" http://127.0.0.1:8090/api/stats | head -c 300
```

## 5. Au quotidien

| Besoin | Commande |
|---|---|
| Voir le journal en direct | `sudo journalctl -u kingdomengineNext -f` |
| Redémarrer | `sudo systemctl restart kingdomengineNext` |
| État du service | `systemctl status kingdomengineNext` |
| Mettre à jour | `sudo bash /opt/kingdomengineNext/deploy/update.sh` |
| Sauvegarder maintenant | `sudo bash /opt/kingdomengineNext/deploy/backup.sh` |
| Lister les sauvegardes | `ls -lh /var/backups/kingdomengineNext` |

**La mise à jour** sauvegarde d’abord, récupère le code, compile et lance les tests. Si un test échoue, le service n’est **pas** redémarré : l’ancienne version reste en ligne.

**Les sauvegardes** se font chaque nuit vers 4 h 15, sans arrêter le service. Les 14 dernières sont gardées dans `/var/backups/kingdomengineNext`. Pense à les copier aussi ailleurs que sur le serveur.

## 6. Restaurer une sauvegarde

```sh
sudo systemctl stop kingdomengineNext
cd /var/lib/kingdomengineNext
sudo mv kingdom.db kingdom.db.avant-restauration
sudo rm -f kingdom.db-wal kingdom.db-shm
sudo tar -xzf /var/backups/kingdomengineNext/kingdom_AAAA-MM-JJ_HHMMSS.tar.gz -C /var/lib/kingdomengineNext
sudo chown -R kingdomnext:kingdomnext /var/lib/kingdomengineNext
sudo systemctl start kingdomengineNext
```

## 7. En cas de problème

- **Le service ne démarre pas** : lance `sudo journalctl -u kingdomengineNext -n 50`. La cause est presque toujours une erreur dans `/etc/kingdomengineNext.env` ou un port déjà pris.
- **« Studio non compilé »** : lance `sudo runuser -u kingdomnext -- bash -c 'cd /opt/kingdomengineNext && npm run build'`.
- **Le bot reste hors ligne** : vérifie le jeton. Aucun intent privilégié n’est nécessaire. Le journal affiche « ✅ Bot principal connecté » quand tout va bien.
- **« Connexion Discord interrompue »** ou erreur `redirect_uri` chez Discord : la redirection déclarée dans le Developer Portal doit être exactement `KINGDOM_PUBLIC_URL` suivie de `/api/auth/discord/callback`.
- **Pas de son** : `ffmpeg -version` doit répondre. Les sons doivent être importés dans la Médiathèque avec les clés attendues.
