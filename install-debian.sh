#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez cette installation avec : sudo bash ./install-debian.sh" >&2
  exit 1
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-root}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

apt-get update
apt-get install -y python3 python3-venv python3-pip ffmpeg curl

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  sudo -u "$SERVICE_USER" python3 -m venv --clear "$ROOT/.venv"
fi
sudo -u "$SERVICE_USER" "$ROOT/.venv/bin/python" -m pip install --upgrade pip
sudo -u "$SERVICE_USER" "$ROOT/.venv/bin/python" -m pip install -e "$ROOT"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  ADMIN_PASSWORD="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i "s/^KINGDOM_ADMIN_PASSWORD=.*/KINGDOM_ADMIN_PASSWORD=$ADMIN_PASSWORD/" "$ROOT/.env"
  echo "Mot de passe KingdomWeb généré : $ADMIN_PASSWORD"
fi
if grep -q '^KINGDOM_ADMIN_PASSWORD=change-me$' "$ROOT/.env"; then
  ADMIN_PASSWORD="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i "s/^KINGDOM_ADMIN_PASSWORD=.*/KINGDOM_ADMIN_PASSWORD=$ADMIN_PASSWORD/" "$ROOT/.env"
  echo "Mot de passe KingdomWeb remplacé pour l'accès public : $ADMIN_PASSWORD"
fi
sed -i 's/^KINGDOM_WEB_HOST=.*/KINGDOM_WEB_HOST=0.0.0.0/' "$ROOT/.env"
chown "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/.env"
mkdir -p "$ROOT/var/logs"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/var"

install_unit() {
  local service="$1"
  cat >"/etc/systemd/system/kingdomengine-$service.service" <<EOF
[Unit]
Description=KingdomEngine $service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$ROOT
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=$ROOT/.env
ExecStart=$ROOT/.venv/bin/python $ROOT/run.py $service
Restart=on-failure
RestartSec=5
StandardOutput=append:$ROOT/var/logs/$service.out.log
StandardError=append:$ROOT/var/logs/$service.err.log

[Install]
WantedBy=multi-user.target
EOF
}

install_unit web
install_unit core
install_unit voice
systemctl daemon-reload
systemctl enable --now kingdomengine-web kingdomengine-core kingdomengine-voice

PORT="$(sed -n 's/^KINGDOM_WEB_PORT=//p' "$ROOT/.env")"
PUBLIC_IP="$(hostname -I | awk '{print $1}')"
echo "KingdomEngine est installé et démarrera automatiquement avec Debian."
echo "KingdomWeb : http://${PUBLIC_IP:-127.0.0.1}:${PORT:-8000}"
echo "État : sudo systemctl status kingdomengine-web kingdomengine-core kingdomengine-voice"
