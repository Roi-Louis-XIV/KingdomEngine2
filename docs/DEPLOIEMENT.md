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

## 4. Au quotidien

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

## 5. Restaurer une sauvegarde

```sh
sudo systemctl stop kingdomengineNext
cd /var/lib/kingdomengineNext
sudo mv kingdom.db kingdom.db.avant-restauration
sudo rm -f kingdom.db-wal kingdom.db-shm
sudo tar -xzf /var/backups/kingdomengineNext/kingdom_AAAA-MM-JJ_HHMMSS.tar.gz -C /var/lib/kingdomengineNext
sudo chown -R kingdomnext:kingdomnext /var/lib/kingdomengineNext
sudo systemctl start kingdomengineNext
```

## 6. En cas de problème

- **Le service ne démarre pas** : lance `sudo journalctl -u kingdomengineNext -n 50`. La cause est presque toujours une erreur dans `/etc/kingdomengineNext.env` ou un port déjà pris.
- **« Studio non compilé »** : lance `sudo runuser -u kingdomnext -- bash -c 'cd /opt/kingdomengineNext && npm run build'`.
- **Le bot reste hors ligne** : vérifie le jeton, puis l’intent par défaut dans le Developer Portal. Le journal affiche « ✅ Bot principal connecté » quand tout va bien.
- **Pas de son** : `ffmpeg -version` doit répondre. Les sons doivent être importés dans la Médiathèque avec les clés attendues.
