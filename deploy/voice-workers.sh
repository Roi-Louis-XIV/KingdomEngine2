#!/usr/bin/env bash
# Voice Workers de KingdomEngine 4 : renseigner les tokens sans ouvrir le fichier de configuration.
#
#   sudo bash /opt/kingdomengineNext/deploy/voice-workers.sh            → état des 10 emplacements, puis saisie
#   sudo bash /opt/kingdomengineNext/deploy/voice-workers.sh etat       → seulement l'état (aucun token affiché)
#
# Chaque worker est une application Discord à part (Developer Portal). Le token est saisi en masqué,
# écrit dans /etc/kingdomengineNext.env, puis le service redémarre. Ne jamais réutiliser un token de KingdomEngine 2.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/kingdomengineNext.env}"
SERVICE="${SERVICE:-kingdomengineNext}"
SLOTS="${SLOTS:-10}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Fichier introuvable : $ENV_FILE (KingdomEngine 4 est-il installé ?)" >&2
  exit 1
fi
if [[ ! -w "$ENV_FILE" ]]; then
  echo "❌ Pas le droit d'écrire $ENV_FILE : relance avec sudo." >&2
  exit 1
fi

# Valeur actuelle d'une variable du fichier (vide si absente).
get() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"; }

# Écrit (ou remplace) une variable, sans jamais afficher sa valeur.
put() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -F= -v k="$key" -v v="$value" 'BEGIN { done = 0 } $1 == k { print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE" # garde le propriétaire et les droits du fichier
  rm -f "$tmp"
}

# Ajoute les emplacements vides qui manquent (1 à SLOTS).
added=0
if ! grep -q '^VOICE_WORKER_1_TOKEN=' "$ENV_FILE"; then printf '\n# ─── Voice Workers (une application Discord par worker) ───\n' >>"$ENV_FILE"; fi
for i in $(seq 1 "$SLOTS"); do
  for k in "VOICE_WORKER_${i}_TOKEN" "VOICE_WORKER_${i}_APPLICATION_ID"; do
    if ! grep -q "^${k}=" "$ENV_FILE"; then echo "${k}=" >>"$ENV_FILE"; added=$((added + 1)); fi
  done
done
[[ $added -gt 0 ]] && echo "➕ $((added / 2)) emplacement(s) de Voice Worker ajouté(s) dans $ENV_FILE."

etat() {
  echo
  echo "Voice Workers ($ENV_FILE) :"
  local filled=0
  for i in $(seq 1 "$SLOTS"); do
    local t a
    t="$(get "VOICE_WORKER_${i}_TOKEN")"
    a="$(get "VOICE_WORKER_${i}_APPLICATION_ID")"
    if [[ -n "$t" ]]; then
      filled=$((filled + 1))
      printf '  %2d  ✅ token renseigné (…%s)%s\n' "$i" "${t: -4}" "${a:+, application $a}"
    else
      printf '  %2d  ·  vide\n' "$i"
    fi
  done
  echo "  → $filled / $SLOTS renseigné(s)."
  echo
}

etat
[[ "${1:-}" == "etat" ]] && exit 0

changed=0
while true; do
  read -r -p "Numéro du worker à renseigner (1-$SLOTS), ou Entrée pour terminer : " n
  [[ -z "$n" ]] && break
  if ! [[ "$n" =~ ^[0-9]+$ ]] || ((n < 1 || n > SLOTS)); then
    echo "  Choisis un numéro entre 1 et $SLOTS."
    continue
  fi
  read -r -s -p "  Token du bot (rien ne s'affiche, c'est normal), Entrée pour annuler : " token
  echo
  token="$(printf '%s' "$token" | tr -d '[:space:]')"
  if [[ -z "$token" ]]; then
    echo "  Annulé."
    continue
  fi
  if ! [[ "$token" =~ ^[A-Za-z0-9._-]{50,}$ ]]; then
    echo "  ⚠️  Ça ne ressemble pas à un token de bot Discord (long texte avec deux points). Rien n'est enregistré."
    continue
  fi
  if grep -q "=${token}\$" "$ENV_FILE"; then
    echo "  ⚠️  Ce token est déjà utilisé ailleurs dans le fichier (bot principal ou autre worker). Chaque worker doit être une application à part."
    continue
  fi
  # L'identifiant d'application se lit dans le token (première partie, en base64).
  guess="$(printf '%s' "${token%%.*}" | base64 -d 2>/dev/null | tr -cd '0-9' || true)"
  read -r -p "  Application ID${guess:+ [$guess]} : " app
  app="${app:-$guess}"
  if [[ -n "$app" && ! "$app" =~ ^[0-9]{17,20}$ ]]; then
    echo "  ⚠️  L'Application ID est un nombre de 17 à 20 chiffres. Rien n'est enregistré."
    continue
  fi
  put "VOICE_WORKER_${n}_TOKEN" "$token"
  put "VOICE_WORKER_${n}_APPLICATION_ID" "$app"
  echo "  ✅ Worker $n enregistré."
  changed=1
done

if [[ $changed -eq 1 ]]; then
  etat
  if [[ "${NO_RESTART:-}" == "1" ]]; then
    echo "(redémarrage ignoré : NO_RESTART=1)"
  else
    echo "🔄 Redémarrage de $SERVICE…"
    systemctl restart "$SERVICE"
    sleep 4
    journalctl -u "$SERVICE" -n 40 --no-pager | grep -E "Voice Worker|🎙️|worker" || true
    echo
    echo "Dernière étape : Studio › Discord › Voice Workers › bouton « Inviter » sur chaque worker."
  fi
fi
