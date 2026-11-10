# Installer KingdomEngine 4 sur un serveur Debian

Testé pour Debian 12 (Bookworm) et 13 (Trixie). Il faut un accès root (ou `sudo`) et une connexion Internet.

## 1. Installation (5 minutes)

```sh
curl -fsSLO https://raw.githubusercontent.com/Roi-Louis-XIV/KingdomEngine2/kingdomengine4/deploy/install-debian.sh
sudo bash install-debian.sh
```

Le script installe Node.js 22, git, FFmpeg et sqlite3, crée l’utilisateur système `kingdom`, place le code dans `/opt/kingdomengine` et les données dans `/var/lib/kingdomengine`. Il compile le Studio, **lance les tests** (et s’arrête si l’un échoue), crée le service `kingdomengine` et une sauvegarde quotidienne. On peut le relancer sans risque : il ne touche ni aux données ni à la configuration existantes.

> **Si KingdomEngine2 tourne encore sur ce serveur** et utilise déjà le port 8080, mets `KINGDOM_PORT=8090` dans `/etc/kingdomengine.env` (voir l’étape 2). N’utilise jamais le même jeton de bot dans KE2 et KE4 en même temps : arrête d’abord les services de KE2.

## 2. Configuration

```sh
sudo nano /etc/kingdomengine.env
sudo systemctl restart kingdomengine
```

| Réglage | Rôle |
|---|---|
| `KINGDOM_CORE_TOKEN` | Jeton du bot principal (Discord Developer Portal → Bot → Reset Token) |
| `VOICE_WORKER_1_TOKEN`, `VOICE_WORKER_1_APPLICATION_ID`, … | Un bot par connexion vocale simultanée |
| `KINGDOM_PORT` | Port local du Studio (8080 par défaut) |
| `KINGDOM_HOST` | `127.0.0.1` derrière nginx (défaut), `0.0.0.0` pour un accès direct sur le réseau local |
| `KINGDOM_SECURE_COOKIES` | `1` dès que le Studio est servi en HTTPS |
| `KINGDOM_ALLOW_REGISTRATION` | `0` par défaut sur un serveur : tu crées toi-même les comptes dans Administration |

Ce fichier contient des secrets : il n’est lisible que par root et le service.

## 3. Accéder au Studio

**Avec un nom de domaine (recommandé)** : HTTPS gratuit avec nginx et Let’s Encrypt.

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/kingdomengine/deploy/nginx-kingdomengine.conf /etc/nginx/sites-available/kingdomengine
sudo nano /etc/nginx/sites-available/kingdomengine      # remplace studio.exemple.fr par ton domaine
sudo ln -s /etc/nginx/sites-available/kingdomengine /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ton-domaine.fr
```

Puis mets `KINGDOM_SECURE_COOKIES=1` dans `/etc/kingdomengine.env` et redémarre le service.

**Sans domaine** : passe par un tunnel SSH depuis ton PC, sans rien ouvrir sur Internet.

```sh
ssh -L 8080:127.0.0.1:8080 utilisateur@ip-du-serveur
```

Ouvre ensuite http://localhost:8080 sur ton PC.

Au premier accès, crée ton compte : **le premier compte est administrateur**.

## 4. Au quotidien

| Besoin | Commande |
|---|---|
| Voir le journal en direct | `sudo journalctl -u kingdomengine -f` |
| Redémarrer | `sudo systemctl restart kingdomengine` |
| État du service | `systemctl status kingdomengine` |
| Mettre à jour | `sudo bash /opt/kingdomengine/deploy/update.sh` |
| Sauvegarder maintenant | `sudo bash /opt/kingdomengine/deploy/backup.sh` |
| Lister les sauvegardes | `ls -lh /var/backups/kingdomengine` |

**La mise à jour** sauvegarde d’abord, récupère le code, compile et lance les tests. Si un test échoue, le service n’est **pas** redémarré : l’ancienne version reste en ligne.

**Les sauvegardes** se font chaque nuit à 4 h, sans arrêter le service. Les 14 dernières sont gardées dans `/var/backups/kingdomengine`. Pense à les copier aussi ailleurs que sur le serveur.

## 5. Restaurer une sauvegarde

```sh
sudo systemctl stop kingdomengine
cd /var/lib/kingdomengine
sudo mv kingdom.db kingdom.db.avant-restauration
sudo rm -f kingdom.db-wal kingdom.db-shm
sudo tar -xzf /var/backups/kingdomengine/kingdom_AAAA-MM-JJ_HHMMSS.tar.gz -C /var/lib/kingdomengine
sudo chown -R kingdom:kingdom /var/lib/kingdomengine
sudo systemctl start kingdomengine
```

## 6. En cas de problème

- **Le service ne démarre pas** : lance `sudo journalctl -u kingdomengine -n 50`. La cause est presque toujours une erreur dans `/etc/kingdomengine.env` ou un port déjà pris.
- **« Studio non compilé »** : lance `sudo runuser -u kingdom -- bash -c 'cd /opt/kingdomengine && npm run build'`.
- **Le bot reste hors ligne** : vérifie le jeton, puis l’intent par défaut dans le Developer Portal. Le journal affiche « ✅ Bot principal connecté » quand tout va bien.
- **Pas de son** : `ffmpeg -version` doit répondre. Les sons doivent être importés dans la Médiathèque avec les clés attendues.
