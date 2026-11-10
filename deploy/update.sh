#!/usr/bin/env bash
# Mise à jour de KingdomEngine : sauvegarde, récupération du code, dépendances, compilation, tests, redémarrage.
# Si les tests échouent, le service n'est pas redémarré et l'ancienne version reste en ligne.
# Usage : sudo bash /opt/kingdomengine/deploy/update.sh
set -euo pipefail

APP_DIR="/opt/kingdomengine"
SERVICE_USER="kingdom"
# Exécute une commande en tant que l'utilisateur du service (runuser existe sur tout Debian, contrairement à sudo).
as_kingdom() { runuser -u "$SERVICE_USER" -- env HOME="${DATA_DIR:-/var/lib/kingdomengine}" "$@"; }
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root : sudo bash $0"; exit 1; }

say "Sauvegarde avant mise à jour"
bash "$APP_DIR/deploy/backup.sh"

say "Récupération du code"
cd "$APP_DIR"
BEFORE="$(as_kingdom git rev-parse --short HEAD)"
as_kingdom git pull --ff-only
AFTER="$(as_kingdom git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "   Déjà à jour ($AFTER)."
else
  as_kingdom git log --oneline "$BEFORE..$AFTER" | sed 's/^/   /'
fi

say "Dépendances, compilation, tests"
as_kingdom bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund --loglevel=error && npm run build && npm test" >/tmp/kingdom-update.log 2>&1 || {
  tail -40 /tmp/kingdom-update.log
  echo
  echo "✖ Échec : le service n'a PAS été redémarré (l'ancienne version tourne toujours)."
  echo "  Pour revenir au code précédent : sudo runuser -u $SERVICE_USER -- git -C $APP_DIR reset --hard $BEFORE"
  exit 1
}

# Les fichiers systemd peuvent avoir évolué.
install -m 644 deploy/kingdomengine.service /etc/systemd/system/kingdomengine.service
install -m 644 deploy/kingdomengine-backup.service /etc/systemd/system/kingdomengine-backup.service
install -m 644 deploy/kingdomengine-backup.timer /etc/systemd/system/kingdomengine-backup.timer
systemctl daemon-reload

say "Redémarrage"
systemctl restart kingdomengine
sleep 3
systemctl is-active --quiet kingdomengine && echo "   KingdomEngine $AFTER est en ligne." || { journalctl -u kingdomengine -n 30 --no-pager; exit 1; }
