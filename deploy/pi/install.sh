#!/usr/bin/env bash
set -euo pipefail

app_dir="$HOME/fitnessapp"
data_dir="$HOME/fitnessapp-data"
unit_dir="$HOME/.config/systemd/user"
env_file="$data_dir/fitnessapp.env"

if [[ ! -f "$app_dir/backend/manage.py" || ! -f "$app_dir/frontend/dist/frontend/browser/index.html" ]]; then
  echo "Backend source or production PWA build is missing in $app_dir" >&2
  exit 1
fi

mkdir -p "$data_dir" "$unit_dir"
chmod 700 "$data_dir"

if [[ ! -e "$env_file" ]]; then
  dns_name="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
  secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  umask 077
  printf 'DJANGO_SECRET_KEY=%s\nDJANGO_DEBUG=false\nDJANGO_ALLOWED_HOSTS=%s,localhost,127.0.0.1\nFITNESS_DB_PATH=%s/db.sqlite3\nAPP_TIME_ZONE=America/New_York\nCORS_ALLOWED_ORIGINS=\n' \
    "$secret" "$dns_name" "$data_dir" > "$env_file"
fi
chmod 600 "$env_file"

python3 -m venv "$app_dir/.venv"
"$app_dir/.venv/bin/python" -m pip install --disable-pip-version-check -r "$app_dir/requirements.txt"

set -a
source "$env_file"
set +a
if [[ -f "$FITNESS_DB_PATH" ]]; then
  "$app_dir/.venv/bin/python" "$app_dir/deploy/pi/backup.py"
fi
if systemctl --user is-active --quiet fitnessapp.service; then
  systemctl --user stop fitnessapp.service
fi
trap 'systemctl --user start fitnessapp.service || true' EXIT
"$app_dir/.venv/bin/python" "$app_dir/backend/manage.py" migrate --noinput
"$app_dir/.venv/bin/python" "$app_dir/backend/manage.py" check --deploy

install -m 644 "$app_dir/deploy/pi/fitnessapp.service" "$unit_dir/fitnessapp.service"
install -m 644 "$app_dir/deploy/pi/fitnessapp-backup.service" "$unit_dir/fitnessapp-backup.service"
install -m 644 "$app_dir/deploy/pi/fitnessapp-backup.timer" "$unit_dir/fitnessapp-backup.timer"
systemctl --user daemon-reload
systemctl --user enable fitnessapp.service
systemctl --user enable --now fitnessapp-backup.timer
systemctl --user restart fitnessapp.service
systemctl --user is-active --quiet fitnessapp.service
trap - EXIT

echo "FitnessApp is listening on 127.0.0.1:8080."
