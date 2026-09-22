#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pi_host="${FITNESS_PI_SSH:-pieme@100.74.89.59}"

if [[ ! -f "$repo_dir/frontend/dist/frontend/browser/index.html" ]]; then
  echo "Build the frontend first: cd frontend && npm ci && npm run build" >&2
  exit 1
fi

ssh "$pi_host" 'mkdir -p "$HOME/fitnessapp/backend" "$HOME/fitnessapp/deploy/pi" "$HOME/fitnessapp/frontend/dist/frontend/browser"'
rsync -az --exclude 'db.sqlite3' --exclude '__pycache__/' --exclude '*.pyc' \
  "$repo_dir/backend/" "$pi_host:fitnessapp/backend/"
rsync -az "$repo_dir/deploy/pi/" "$pi_host:fitnessapp/deploy/pi/"
rsync -az "$repo_dir/requirements.txt" "$pi_host:fitnessapp/requirements.txt"
rsync -az "$repo_dir/frontend/dist/frontend/browser/" "$pi_host:fitnessapp/frontend/dist/frontend/browser/"
ssh "$pi_host" 'bash "$HOME/fitnessapp/deploy/pi/install.sh"'
ssh "$pi_host" 'curl --retry 10 --retry-delay 1 --retry-connrefused -fsS -o /dev/null http://127.0.0.1:8080/ && curl -fsS -o /dev/null http://127.0.0.1:8080/api/today/'
