#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$ROOT/var"

for service in voice core web; do
  pid_file="$RUNTIME/$service.pid"
  [[ -f "$pid_file" ]] || continue
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
    echo "$service arrêté."
  fi
  rm -f "$pid_file"
done
