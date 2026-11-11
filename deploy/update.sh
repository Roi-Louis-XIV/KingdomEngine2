#!/usr/bin/env bash
# Mise à jour : sauvegarde, récupération du code, dépendances, compilation, tests, redémarrage.
# Si les tests échouent, le service n'est pas redémarré et l'ancienne version reste en ligne.
# Usage : sudo bash /opt/kingdomengineNext/deploy/update.sh
set -euo pipefail

# Tout se déduit de l'emplacement du script : /opt/<NOM>/deploy/update.sh
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$APP_DIR")"
DATA_DIR="/var/lib/$NAME"
ENV_FILE="/etc/$NAME.env"
SERVICE_USER="$(stat -c %U "$APP_DIR")"
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
as_service() { runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root : sudo bash $0"; exit 1; }
[ -f "/etc/systemd/system/$NAME.service" ] || { echo "Service $NAME introuvable : installe d'abord avec install-debian.sh."; exit 1; }

say "Sauvegarde avant mise à jour"
bash "$APP_DIR/deploy/backup.sh"

say "Récupération du code"
cd "$APP_DIR"
BEFORE="$(as_service git rev-parse --short HEAD)"
as_service git pull --ff-only
AFTER="$(as_service git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "   Déjà à jour ($AFTER)."
else
  as_service git log --oneline "$BEFORE..$AFTER" | sed 's/^/   /'
fi

say "Dépendances, compilation, tests"
as_service bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund --loglevel=error && npm run build && npm test" >"/tmp/$NAME-update.log" 2>&1 || {
  tail -40 "/tmp/$NAME-update.log"
  echo
  echo "✖ Échec : le service n'a PAS été redémarré (l'ancienne version tourne toujours)."
  echo "  Pour revenir au code précédent : sudo runuser -u $SERVICE_USER -- git -C $APP_DIR reset --hard $BEFORE"
  exit 1
}

# Les fichiers systemd peuvent avoir évolué.
PORT="$(grep -E '^KINGDOM_PORT=' "$ENV_FILE" | cut -d= -f2)"; PORT="${PORT:-8080}"
render() {
  sed -e "s|@NAME@|$NAME|g" -e "s|@USER@|$SERVICE_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@PORT@|$PORT|g" "$1"
}
render deploy/service.in >"/etc/systemd/system/$NAME.service"
render deploy/backup.service.in >"/etc/systemd/system/$NAME-backup.service"
render deploy/backup.timer.in >"/etc/systemd/system/$NAME-backup.timer"
if [ -d /etc/nginx/sites-available ] && [ ! -f "/etc/nginx/sites-available/$NAME" ]; then
  render deploy/nginx.conf.in >"/etc/nginx/sites-available/$NAME"
  echo "   Modèle nginx prêt : /etc/nginx/sites-available/$NAME (non activé)."
fi
systemctl daemon-reload

say "Redémarrage"
systemctl restart "$NAME"
sleep 3
if systemctl is-active --quiet "$NAME"; then
  echo "   $NAME ($AFTER) est en ligne."
else
  journalctl -u "$NAME" -n 30 --no-pager
  exit 1
fi
