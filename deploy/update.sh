#!/usr/bin/env bash
# Mise à jour : sauvegarde, récupération du code, dépendances, compilation, tests, redémarrage.
# Si les tests échouent, le code précédent est remis en place et le service n'est pas redémarré :
# l'ancienne version reste en ligne.
# Usage : sudo bash /opt/kingdomengineNext/deploy/update.sh
# (lancé aussi automatiquement par deploy/auto-update.sh quand GitHub a du nouveau)
set -euo pipefail

# git pull peut réécrire ce fichier pendant qu'il s'exécute : on travaille sur une copie.
if [ -z "${KINGDOM_UPDATE_COPY:-}" ]; then
  APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  COPY="$(mktemp /tmp/kingdom-update.XXXXXX.sh)"
  cp "$0" "$COPY"
  KINGDOM_UPDATE_COPY="$COPY" KINGDOM_APP_DIR="$APP_DIR" exec bash "$COPY" "$@"
fi
trap 'rm -f "$KINGDOM_UPDATE_COPY"' EXIT

# Tout se déduit de l'emplacement de l'installation : /opt/<NOM>
APP_DIR="$KINGDOM_APP_DIR"
NAME="$(basename "$APP_DIR")"
DATA_DIR="/var/lib/$NAME"
ENV_FILE="/etc/$NAME.env"
SERVICE_USER="$(stat -c %U "$APP_DIR")"
AUTO="${KINGDOM_AUTO:-0}"
FAILED_MARK="$DATA_DIR/.maj-auto-echec"
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
as_service() { runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root : sudo bash $0"; exit 1; }
[ -f "/etc/systemd/system/$NAME.service" ] || { echo "Service $NAME introuvable : installe d'abord avec install-debian.sh."; exit 1; }

# Une seule mise à jour à la fois (manuelle ou automatique).
exec 9>"/run/lock/$NAME-update.lock"
flock -n 9 || { echo "Une mise à jour est déjà en cours."; exit 0; }

say "Sauvegarde avant mise à jour"
# Préfixe à part : les mises à jour fréquentes ne font pas disparaître les sauvegardes de la nuit.
KINGDOM_BACKUP_PREFIX=avant-maj KINGDOM_BACKUP_KEEP=10 bash "$APP_DIR/deploy/backup.sh"

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
  echo "✖ Échec de la version $AFTER : retour au code précédent ($BEFORE), le service n'est PAS redémarré."
  as_service git reset --hard "$BEFORE" >/dev/null
  as_service bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund --loglevel=error && npm run build" >>"/tmp/$NAME-update.log" 2>&1 \
    || echo "  ⚠ Recompilation de $BEFORE impossible : voir /tmp/$NAME-update.log"
  # La mise à jour automatique ne réessaie pas la même version toutes les 5 minutes.
  [ "$AUTO" = "1" ] && echo "$AFTER" >"$FAILED_MARK"
  exit 1
}
rm -f "$FAILED_MARK"

# Les fichiers systemd peuvent avoir évolué.
PORT="$(grep -E '^KINGDOM_PORT=' "$ENV_FILE" | cut -d= -f2)"; PORT="${PORT:-8080}"
render() {
  sed -e "s|@NAME@|$NAME|g" -e "s|@USER@|$SERVICE_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@PORT@|$PORT|g" "$1"
}
render deploy/service.in >"/etc/systemd/system/$NAME.service"
render deploy/backup.service.in >"/etc/systemd/system/$NAME-backup.service"
render deploy/backup.timer.in >"/etc/systemd/system/$NAME-backup.timer"
render deploy/auto-update.service.in >"/etc/systemd/system/$NAME-auto-update.service"
render deploy/auto-update.timer.in >"/etc/systemd/system/$NAME-auto-update.timer"
if [ -d /etc/nginx/sites-available ] && [ ! -f "/etc/nginx/sites-available/$NAME" ]; then
  render deploy/nginx.conf.in >"/etc/nginx/sites-available/$NAME"
  echo "   Modèle nginx prêt : /etc/nginx/sites-available/$NAME (non activé)."
fi
systemctl daemon-reload
systemctl enable --now "$NAME-auto-update.timer" >/dev/null 2>&1 || true

say "Redémarrage"
systemctl restart "$NAME"
sleep 3
if systemctl is-active --quiet "$NAME"; then
  echo "   $NAME ($AFTER) est en ligne."
else
  journalctl -u "$NAME" -n 30 --no-pager
  exit 1
fi
