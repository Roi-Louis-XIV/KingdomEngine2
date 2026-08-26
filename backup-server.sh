#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BACKUP="${1:-$HOME/kingdomengine-backup-$(date +%F-%H%M).tar.gz}"
DATA_DIR="$(sed -n 's/^KINGDOM_DATA_DIR=//p' .env 2>/dev/null | tail -n 1)"
TARGETS=(.env var)
if [[ -n "$DATA_DIR" ]]; then
  TARGETS+=("$DATA_DIR")
else
  TARGETS+=(KingdomData/assets)
fi
tar -czf "$BACKUP" "${TARGETS[@]}"
echo "Sauvegarde créée : $BACKUP"
