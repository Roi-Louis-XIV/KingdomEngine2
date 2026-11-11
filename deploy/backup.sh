#!/usr/bin/env bash
# Sauvegarde à chaud de KingdomEngine 4 : base SQLite (cohérente, même en fonctionnement) + sons.
# Garde les 14 dernières sauvegardes. Usage : sudo bash /opt/kingdomengineNext/deploy/backup.sh
set -euo pipefail

# Le nom de l'installation se déduit de l'emplacement du script : /opt/<NOM>/deploy/backup.sh
APP_DIR="${KINGDOM_APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
NAME="$(basename "$APP_DIR")"
DATA_DIR="${KINGDOM_DATA_DIR:-/var/lib/$NAME}"
BACKUP_DIR="${KINGDOM_BACKUP_DIR:-/var/backups/$NAME}"
KEEP="${KINGDOM_BACKUP_KEEP:-14}"
PREFIX="${KINGDOM_BACKUP_PREFIX:-kingdom}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -f "$DATA_DIR/kingdom.db" ] || { echo "Aucune base dans $DATA_DIR : rien à sauvegarder."; exit 0; }
mkdir -p "$BACKUP_DIR"

# Copie cohérente même si le serveur écrit en même temps (mode WAL), puis contrôle d'intégrité.
if node --disable-warning=ExperimentalWarning "$APP_DIR/scripts/backup-db.mjs" "$DATA_DIR/kingdom.db" "$WORK/kingdom.db" 2>/dev/null; then
  :
elif command -v sqlite3 >/dev/null; then
  sqlite3 "$DATA_DIR/kingdom.db" ".backup '$WORK/kingdom.db'"
  sqlite3 "$WORK/kingdom.db" "PRAGMA integrity_check;" | grep -qx ok || { echo "Copie corrompue : sauvegarde annulée." >&2; exit 1; }
else
  echo "Impossible de copier la base (Node 22.16+ ou sqlite3 requis)." >&2
  exit 1
fi
[ -d "$DATA_DIR/audio" ] && cp -a "$DATA_DIR/audio" "$WORK/audio"

ARCHIVE="$BACKUP_DIR/${PREFIX}_$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
chmod 640 "$ARCHIVE"
echo "Sauvegarde : $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Rotation
ls -1t "$BACKUP_DIR"/"$PREFIX"_*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
