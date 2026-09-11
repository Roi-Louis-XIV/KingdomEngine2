#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "La configuration systemd doit être exécutée avec sudo." >&2
  exit 1
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${1:-$(stat -c '%U' "$ROOT")}"
CONTROL_RULE="/etc/sudoers.d/kingdomengine-service-control"

# Aucun shell ni wildcard : uniquement les commandes systemctl exactes.
{
  printf '%s ALL=(root) NOPASSWD: ' "$SERVICE_USER"
  first=1
  for operation in start stop restart; do
    for unit in kingdom-web.service kingdom-core.service kingdom-voice.service; do
      [[ "$first" -eq 1 ]] || printf ', '
      printf '/usr/bin/systemctl %s %s' "$operation" "$unit"
      first=0
    done
  done
  printf ', /usr/bin/systemctl --no-block start kingdomengine-update.service'
  printf '\n'
} >"$CONTROL_RULE"
chmod 0440 "$CONTROL_RULE"
visudo -cf "$CONTROL_RULE" >/dev/null
echo "Contrôle systemd KingdomEngine autorisé pour $SERVICE_USER."
