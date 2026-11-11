#!/usr/bin/env bash
# Secours des comptes du Studio : retrouver un identifiant, redonner un mot de passe, relier Discord.
# Usage : sudo bash /opt/kingdomengineNext/deploy/compte.sh liste
#         sudo bash /opt/kingdomengineNext/deploy/compte.sh mot-de-passe <identifiant>
#         sudo bash /opt/kingdomengineNext/deploy/compte.sh discord <identifiant> <id discord>
#         sudo bash /opt/kingdomengineNext/deploy/compte.sh admin <identifiant>
# Fonctionne pendant que le service tourne.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$APP_DIR")"
DATA_DIR="/var/lib/$NAME"
SERVICE_USER="$(stat -c %U "$APP_DIR")"

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root : sudo bash $0 $*"; exit 1; }
[ -f "$DATA_DIR/kingdom.db" ] || { echo "Base introuvable : $DATA_DIR/kingdom.db"; exit 1; }

cd "$APP_DIR"
exec runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" KINGDOM_DATA_DIR="$DATA_DIR" \
  node --disable-warning=ExperimentalWarning --import tsx scripts/compte.ts "$@"
