#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$ROOT/.venv/bin/python"
RUNTIME="$ROOT/var"
LOGS="$ROOT/var/logs"
WITHOUT_VOICE=0

if [[ "${1:-}" == "--without-voice" ]]; then WITHOUT_VOICE=1; fi
if [[ ! -x "$PYTHON" ]]; then
  echo "KingdomEngine n'est pas installé. Lancez : sudo bash ./install-debian.sh" >&2
  exit 1
fi

mkdir -p "$RUNTIME" "$LOGS"
cd "$ROOT"
export PYTHONUNBUFFERED=1
export KINGDOM_WEB_HOST="${KINGDOM_WEB_HOST:-0.0.0.0}"

start_service() {
  local service="$1" pid_file="$RUNTIME/$1.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$service est déjà lancé (PID $(cat "$pid_file"))."
    return
  fi
  rm -f "$pid_file"
  nohup "$PYTHON" run.py "$service" >>"$LOGS/$service.out.log" 2>>"$LOGS/$service.err.log" &
  local pid=$!
  echo "$pid" >"$pid_file"
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Échec du démarrage de $service. Consultez $LOGS/$service.err.log" >&2
    exit 1
  fi
  echo "$service démarré (PID $pid)."
}

start_service web
start_service core
if [[ "$WITHOUT_VOICE" -eq 0 ]]; then start_service voice; fi

PORT="${KINGDOM_WEB_PORT:-8000}"
PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "KingdomEngine est prêt : http://${PUBLIC_IP:-127.0.0.1}:$PORT"
echo "Arrêt : bash ./stop-server.sh"
