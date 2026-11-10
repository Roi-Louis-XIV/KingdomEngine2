#!/usr/bin/env bash
# KingdomEngine 4 — installation sur Debian 12/13 (à lancer en root : sudo bash install-debian.sh)
#
# Ce script :
#   1. installe Node.js 22, git, FFmpeg et sqlite3 ;
#   2. crée l'utilisateur système « kingdom » ;
#   3. récupère le code dans /opt/kingdomengine (branche kingdomengine4) ;
#   4. installe les dépendances et compile le Studio ;
#   5. crée /etc/kingdomengine.env (à compléter) et les services systemd ;
#   6. active la sauvegarde quotidienne.
# Il peut être relancé sans risque : il ne remplace ni les données ni la configuration existantes.
set -euo pipefail

REPO="${KINGDOM_REPO:-https://github.com/Roi-Louis-XIV/KingdomEngine2.git}"
BRANCH="${KINGDOM_BRANCH:-kingdomengine4}"
APP_DIR="/opt/kingdomengine"
DATA_DIR="/var/lib/kingdomengine"
BACKUP_DIR="/var/backups/kingdomengine"
ENV_FILE="/etc/kingdomengine.env"
SERVICE_USER="kingdom"

# Exécute une commande en tant que l'utilisateur du service (runuser existe sur tout Debian, contrairement à sudo).
as_kingdom() { runuser -u "$SERVICE_USER" -- env HOME="${DATA_DIR:-/var/lib/kingdomengine}" "$@"; }
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Lance ce script en root : sudo bash $0"
command -v apt-get >/dev/null || die "Ce script est prévu pour Debian (apt-get introuvable)."

say "Paquets système"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ffmpeg sqlite3 >/dev/null

say "Node.js 22"
NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_OK=0
if [ "$NODE_MAJOR" -ge 23 ]; then NODE_OK=1; fi
if [ "$NODE_MAJOR" -eq 22 ] && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a===22&&b>=16?0:1)'; then NODE_OK=1; fi
if [ "$NODE_OK" -ne 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   Node $(node -v), npm $(npm -v)"

say "Utilisateur système « $SERVICE_USER »"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_DIR" "$BACKUP_DIR"

say "Code source ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  echo "   Déjà présent : utilise deploy/update.sh pour mettre à jour."
else
  git clone --branch "$BRANCH" --depth 50 "$REPO" "$APP_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

say "Dépendances et compilation du Studio"
as_kingdom bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund --loglevel=error && npm run build"

say "Vérification (tests)"
as_kingdom bash -c "cd '$APP_DIR' && npm test" >/tmp/kingdom-tests.log 2>&1 \
  && echo "   Tous les tests passent." \
  || { tail -30 /tmp/kingdom-tests.log; die "Des tests échouent : installation interrompue (journal : /tmp/kingdom-tests.log)."; }

say "Configuration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  # Valeurs adaptées à un serveur : données dans /var/lib, écoute locale derrière un proxy HTTPS.
  sed -i \
    -e "s|^# KINGDOM_DATA_DIR=.*|KINGDOM_DATA_DIR=$DATA_DIR|" \
    -e "s|^KINGDOM_HOST=.*|KINGDOM_HOST=127.0.0.1|" \
    -e "s|^KINGDOM_ALLOW_REGISTRATION=.*|KINGDOM_ALLOW_REGISTRATION=0|" \
    "$ENV_FILE"
  echo "   Créé. Renseigne au moins KINGDOM_CORE_TOKEN (et les Voice Workers) dedans."
else
  echo "   Déjà présent : conservé tel quel."
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

say "Services systemd"
install -m 644 "$APP_DIR/deploy/kingdomengine.service" /etc/systemd/system/kingdomengine.service
install -m 644 "$APP_DIR/deploy/kingdomengine-backup.service" /etc/systemd/system/kingdomengine-backup.service
install -m 644 "$APP_DIR/deploy/kingdomengine-backup.timer" /etc/systemd/system/kingdomengine-backup.timer
systemctl daemon-reload
systemctl enable --now kingdomengine-backup.timer >/dev/null
systemctl enable kingdomengine.service >/dev/null
systemctl restart kingdomengine.service
sleep 3

PORT="$(grep -E '^KINGDOM_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"; PORT="${PORT:-8080}"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  say "KingdomEngine tourne sur le port $PORT."
else
  journalctl -u kingdomengine -n 30 --no-pager || true
  die "Le service ne répond pas. Journal ci-dessus (journalctl -u kingdomengine -f)."
fi

cat <<EOF

Prochaines étapes :
  1. Édite la configuration :      sudo nano $ENV_FILE
     puis redémarre :              sudo systemctl restart kingdomengine
  2. Accès au Studio :
     - avec un nom de domaine : configure HTTPS (voir docs/DEPLOIEMENT.md, partie « HTTPS ») ;
     - sans domaine, depuis ton PC : ssh -L 8080:127.0.0.1:$PORT utilisateur@ton-serveur
       puis ouvre http://localhost:8080
  3. Crée ton compte administrateur dans le Studio (le premier compte l'est automatiquement).

Commandes utiles :
  sudo journalctl -u kingdomengine -f          # journal en direct
  sudo systemctl restart kingdomengine         # redémarrer
  sudo bash $APP_DIR/deploy/update.sh          # mettre à jour
  sudo bash $APP_DIR/deploy/backup.sh          # sauvegarder maintenant
EOF
