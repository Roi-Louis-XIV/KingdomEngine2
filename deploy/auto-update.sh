#!/usr/bin/env bash
# Mise à jour automatique depuis GitHub, lancée toutes les 5 minutes par le minuteur <NOM>-auto-update.
# - Ne fait rien si la branche suivie n'a pas bougé.
# - Attend que personne n'ait joué depuis 15 minutes (une partie en cours n'est jamais coupée).
# - Ne réessaie pas une version dont les tests ont échoué : il attend la suivante.
# - Se désactive avec KINGDOM_AUTO_UPDATE=0 dans /etc/<NOM>.env.
# Journal : sudo journalctl -u kingdomengineNext-auto-update -n 50
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$APP_DIR")"
DATA_DIR="/var/lib/$NAME"
ENV_FILE="/etc/$NAME.env"
SERVICE_USER="$(stat -c %U "$APP_DIR")"
QUIET_MINUTES="${KINGDOM_AUTO_UPDATE_QUIET_MINUTES:-15}"
as_service() { runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" "$@"; }

setting() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true; }
[ "$(setting KINGDOM_AUTO_UPDATE)" = "0" ] && exit 0
q="$(setting KINGDOM_AUTO_UPDATE_QUIET_MINUTES)"; [ -n "$q" ] && QUIET_MINUTES="$q"

cd "$APP_DIR"
as_service git fetch --quiet origin || { echo "GitHub injoignable : nouvel essai dans 5 minutes."; exit 0; }
LOCAL="$(as_service git rev-parse HEAD)"
REMOTE="$(as_service git rev-parse '@{u}')"
[ "$LOCAL" = "$REMOTE" ] && exit 0
SHORT="${REMOTE:0:7}"

if [ "$(cat "$DATA_DIR/.maj-auto-echec" 2>/dev/null)" = "$SHORT" ]; then
  echo "La version $SHORT a déjà échoué aux tests : en attente d'une version corrigée."
  exit 0
fi

# Partie en cours ? On repousse (le prochain passage réessaiera).
if command -v sqlite3 >/dev/null && [ -f "$DATA_DIR/kingdom.db" ] && [ "$QUIET_MINUTES" != "0" ]; then
  RECENT="$(sqlite3 -readonly "file:$DATA_DIR/kingdom.db?mode=ro" \
    "SELECT COUNT(*) FROM activity WHERE at > (strftime('%s','now') - $QUIET_MINUTES * 60) * 1000;" 2>/dev/null || echo 0)"
  if [ "${RECENT:-0}" -gt 0 ]; then
    echo "Nouvelle version $SHORT disponible, mais des joueurs ont joué il y a moins de $QUIET_MINUTES min : mise à jour reportée."
    exit 0
  fi
fi

echo "Nouvelle version $SHORT sur GitHub : mise à jour."
KINGDOM_AUTO=1 exec bash "$APP_DIR/deploy/update.sh"
