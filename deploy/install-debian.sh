#!/usr/bin/env bash
# KingdomEngine 4 — installation sur Debian 12/13 (à lancer en root : sudo bash install-debian.sh)
#
# Tout est installé sous le nom « kingdomengineNext », totalement séparé d'une éventuelle
# installation de KingdomEngine2 (/opt/kingdomengine n'est jamais touché) :
#   code          /opt/kingdomengineNext
#   données       /var/lib/kingdomengineNext
#   configuration /etc/kingdomengineNext.env
#   sauvegardes   /var/backups/kingdomengineNext
#   service       kingdomengineNext   (utilisateur système : kingdomnext, port 8090)
#
# Relançable sans risque : ni les données ni la configuration existantes ne sont remplacées.
set -euo pipefail

NAME="${KINGDOM_NAME:-kingdomengineNext}"
SERVICE_USER="${KINGDOM_USER:-kingdomnext}"
PORT_DEFAULT="${KINGDOM_PORT_DEFAULT:-8090}"
REPO="${KINGDOM_REPO:-https://github.com/Roi-Louis-XIV/KingdomEngine2.git}"
BRANCH="${KINGDOM_BRANCH:-kingdomengine4}"
APP_DIR="/opt/$NAME"
DATA_DIR="/var/lib/$NAME"
BACKUP_DIR="/var/backups/$NAME"
ENV_FILE="/etc/$NAME.env"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
# Exécute une commande en tant que l'utilisateur du service (runuser existe sur tout Debian, contrairement à sudo).
as_service() { runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || die "Lance ce script en root : sudo bash $0"
command -v apt-get >/dev/null || die "Ce script est prévu pour Debian (apt-get introuvable)."

# Garde-fou : ne jamais écraser un dossier qui n'est pas une installation KingdomEngine 4.
if [ -e "$APP_DIR" ] && ! git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null | grep -qx "$BRANCH"; then
  die "$APP_DIR existe déjà et n'est pas une installation de la branche $BRANCH. Rien n'a été modifié. Choisis un autre nom : sudo KINGDOM_NAME=autreNom bash $0"
fi

say "Paquets système"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ffmpeg sqlite3 >/dev/null

say "Node.js 22.16 ou plus récent"
need_node=1
if command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)'; then need_node=0; fi
if [ "$need_node" -eq 1 ]; then
  echo "   Installation de Node.js 22 (NodeSource). Une version plus ancienne déjà présente sera remplacée."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   Node $(node -v), npm $(npm -v)"

say "Utilisateur système « $SERVICE_USER »"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_DIR" "$BACKUP_DIR"

say "Code source ($BRANCH) dans $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "   Déjà présent : pour mettre à jour, utilise $APP_DIR/deploy/update.sh"
else
  git clone --branch "$BRANCH" --depth 50 "$REPO" "$APP_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

say "Dépendances et compilation du Studio"
as_service bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund --loglevel=error && npm run build"

say "Vérification (tests)"
as_service bash -c "cd '$APP_DIR' && npm test" >"/tmp/$NAME-tests.log" 2>&1 \
  && echo "   Tous les tests passent." \
  || { tail -30 "/tmp/$NAME-tests.log"; die "Des tests échouent : installation interrompue (journal : /tmp/$NAME-tests.log)."; }

say "Configuration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  PORT="$PORT_DEFAULT"
  # Si le port est déjà pris (par KE2 ou autre), on prend le suivant libre.
  while ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; do PORT=$((PORT + 1)); done
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  sed -i \
    -e "s|^KINGDOM_PORT=.*|KINGDOM_PORT=$PORT|" \
    -e "s|^# KINGDOM_DATA_DIR=.*|KINGDOM_DATA_DIR=$DATA_DIR|" \
    -e "s|^KINGDOM_HOST=.*|KINGDOM_HOST=127.0.0.1|" \
    -e "s|^KINGDOM_ALLOW_REGISTRATION=.*|KINGDOM_ALLOW_REGISTRATION=0|" \
    "$ENV_FILE"
  echo "   Créé (port $PORT). Renseigne KINGDOM_CORE_TOKEN (et les Voice Workers) dedans."
else
  echo "   Déjà présent : conservé tel quel."
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"
PORT="$(grep -E '^KINGDOM_PORT=' "$ENV_FILE" | cut -d= -f2)"; PORT="${PORT:-8080}"

say "Services systemd ($NAME)"
render() {
  sed -e "s|@NAME@|$NAME|g" -e "s|@USER@|$SERVICE_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@PORT@|$PORT|g" "$1"
}
render "$APP_DIR/deploy/service.in" >"/etc/systemd/system/$NAME.service"
render "$APP_DIR/deploy/backup.service.in" >"/etc/systemd/system/$NAME-backup.service"
render "$APP_DIR/deploy/backup.timer.in" >"/etc/systemd/system/$NAME-backup.timer"
if [ -d /etc/nginx/sites-available ] && [ ! -f "/etc/nginx/sites-available/$NAME" ]; then
  render "$APP_DIR/deploy/nginx.conf.in" >"/etc/nginx/sites-available/$NAME"
  echo "   Modèle nginx prêt : /etc/nginx/sites-available/$NAME (non activé)."
fi
systemctl daemon-reload
systemctl enable --now "$NAME-backup.timer" >/dev/null
systemctl enable "$NAME.service" >/dev/null
systemctl restart "$NAME.service"
sleep 3

if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  say "$NAME tourne sur le port $PORT."
else
  journalctl -u "$NAME" -n 30 --no-pager || true
  die "Le service ne répond pas. Journal ci-dessus (journalctl -u $NAME -f)."
fi

cat <<EOF

Prochaines étapes :
  1. Configuration :  sudo nano $ENV_FILE
     puis :           sudo systemctl restart $NAME
  2. Accès au Studio :
     - sans domaine, depuis ton PC : ssh -L $PORT:127.0.0.1:$PORT utilisateur@ton-serveur
       puis ouvre http://localhost:$PORT
     - avec un domaine : voir docs/DEPLOIEMENT.md, partie « HTTPS ».
  3. Crée ton compte : le premier compte est administrateur.

Commandes utiles :
  sudo journalctl -u $NAME -f                 # journal en direct
  sudo systemctl restart $NAME                # redémarrer
  sudo bash $APP_DIR/deploy/update.sh         # mettre à jour
  sudo bash $APP_DIR/deploy/backup.sh         # sauvegarder maintenant

KingdomEngine2 (/opt/kingdomengine) n'a pas été modifié.
EOF
