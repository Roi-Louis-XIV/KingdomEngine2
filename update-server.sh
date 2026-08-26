#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez la mise à jour avec : sudo bash ./update-server.sh" >&2
  exit 1
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="$(stat -c '%U' "$ROOT")"
BRANCH="${KINGDOM_GIT_BRANCH:-agent/kingdomengine2-v2}"
BACKUP_DIR="${KINGDOM_BACKUP_DIR:-/var/backups/kingdomengine}"
cd "$ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "Mise à jour annulée : branche locale '$CURRENT_BRANCH', branche attendue '$BRANCH'." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Mise à jour annulée : des fichiers suivis ont été modifiés localement." >&2
  git status --short >&2
  exit 3
fi

sudo -H -u "$SERVICE_USER" git fetch --prune origin "$BRANCH"
LOCAL_REVISION="$(git rev-parse HEAD)"
REMOTE_REVISION="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL_REVISION" == "$REMOTE_REVISION" ]]; then
  echo "KingdomEngine est déjà à jour ($LOCAL_REVISION)."
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_REVISION" "$REMOTE_REVISION"; then
  echo "Mise à jour annulée : la branche distante n'est pas une avance rapide." >&2
  exit 4
fi

mkdir -p "$BACKUP_DIR"
bash "$ROOT/backup-server.sh" "$BACKUP_DIR/before-$REMOTE_REVISION-$(date +%F-%H%M).tar.gz"
sudo -H -u "$SERVICE_USER" git merge --ff-only "origin/$BRANCH"
sudo -H -u "$SERVICE_USER" "$ROOT/.venv/bin/python" -m pip install -e "$ROOT"
systemctl restart kingdomengine-web kingdomengine-core kingdomengine-voice
echo "KingdomEngine mis à jour : $LOCAL_REVISION -> $REMOTE_REVISION"
