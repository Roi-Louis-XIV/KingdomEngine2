#!/usr/bin/env bash
set -Eeuo pipefail

DATA_DIR=""
DOMAIN=""
ADMIN_EMAIL=""
AUTO_UPDATE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir)
      [[ $# -ge 2 ]] || { echo "--data-dir attend un chemin absolu." >&2; exit 2; }
      DATA_DIR="$2"; shift 2 ;;
    --domain)
      [[ $# -ge 2 ]] || { echo "--domain attend un nom de domaine." >&2; exit 2; }
      DOMAIN="$2"; shift 2 ;;
    --email)
      [[ $# -ge 2 ]] || { echo "--email attend une adresse." >&2; exit 2; }
      ADMIN_EMAIL="$2"; shift 2 ;;
    --no-auto-update) AUTO_UPDATE=0; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez cette installation avec : sudo bash ./install-debian.sh" >&2
  exit 1
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-root}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

apt-get update
apt-get install -y python3 python3-venv python3-pip ffmpeg curl sudo

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
if [[ -n "$DATA_DIR" ]]; then
  DATA_DIR="$(readlink -m "$DATA_DIR")"
  mkdir -p "$DATA_DIR/assets/audio" "$DATA_DIR/assets/maps" "$DATA_DIR/servers"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
  if grep -q '^KINGDOM_DATA_DIR=' "$ROOT/.env"; then
    sed -i "s|^KINGDOM_DATA_DIR=.*|KINGDOM_DATA_DIR=$DATA_DIR|" "$ROOT/.env"
  else
    echo "KINGDOM_DATA_DIR=$DATA_DIR" >>"$ROOT/.env"
  fi
  sed -i "s|^KINGDOM_DATABASE=.*|KINGDOM_DATABASE=$DATA_DIR/kingdom.db|" "$ROOT/.env"
  echo "Données persistantes configurées sur : $DATA_DIR"
fi
if [[ -n "$DOMAIN" ]]; then
  DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  sed -i 's/^KINGDOM_WEB_HOST=.*/KINGDOM_WEB_HOST=127.0.0.1/' "$ROOT/.env"
  sed -i 's/^KINGDOM_SECURE_COOKIES=.*/KINGDOM_SECURE_COOKIES=1/' "$ROOT/.env"
  if grep -q '^KINGDOM_PUBLIC_URL=' "$ROOT/.env"; then
    sed -i "s|^KINGDOM_PUBLIC_URL=.*|KINGDOM_PUBLIC_URL=https://$DOMAIN|" "$ROOT/.env"
  else
    echo "KINGDOM_PUBLIC_URL=https://$DOMAIN" >>"$ROOT/.env"
  fi
  apt-get install -y caddy
  WEB_PORT="$(sed -n 's/^KINGDOM_WEB_PORT=//p' "$ROOT/.env")"
  {
    [[ -n "$ADMIN_EMAIL" ]] && printf '{\n\temail %s\n}\n\n' "$ADMIN_EMAIL"
    printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "${WEB_PORT:-8000}"
  } > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
  systemctl enable --now caddy
  systemctl reload caddy
fi
chown "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/.env"
mkdir -p "$ROOT/var/logs"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/var"

install_unit() {
  local service="$1"
  cat >"/etc/systemd/system/kingdom-$service.service" <<EOF
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
bash "$ROOT/configure-service-control.sh" "$SERVICE_USER"
cat >"/etc/systemd/system/kingdomengine-update.service" <<EOF
[Unit]
Description=Mise à jour automatique de KingdomEngine depuis GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-$ROOT/.env
ExecStart=/bin/bash $ROOT/update-server.sh
EOF
cat >"/etc/systemd/system/kingdomengine-update.timer" <<EOF
[Unit]
Description=Vérification périodique des mises à jour KingdomEngine

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=60
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now kingdom-web kingdom-core kingdom-voice
if [[ "$AUTO_UPDATE" -eq 1 ]]; then
  systemctl enable --now kingdomengine-update.timer
else
  systemctl disable --now kingdomengine-update.timer 2>/dev/null || true
fi

PORT="$(sed -n 's/^KINGDOM_WEB_PORT=//p' "$ROOT/.env")"
PUBLIC_IP="$(hostname -I | awk '{print $1}')"
echo "KingdomEngine est installé et démarrera automatiquement avec Debian."
echo "KingdomWeb : http://${PUBLIC_IP:-127.0.0.1}:${PORT:-8000}"
echo "État : sudo systemctl status kingdom-web kingdom-core kingdom-voice"
[[ -n "$DOMAIN" ]] && echo "Accès HTTPS : https://$DOMAIN"
[[ "$AUTO_UPDATE" -eq 1 ]] && echo "Synchronisation GitHub automatique : active (toutes les 5 minutes)"
