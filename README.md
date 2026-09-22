# FitnessApp

A mobile-first calorie, bodyweight, and gym-workout tracker. The MVP is an installable Angular PWA backed by a Django REST API and PostgreSQL-ready relational models.

## What works now

- Today dashboard with calories, protein, latest bodyweight, and today's activity
- Fast custom-food logging with snapshotted nutrition history
- Bodyweight check-ins
- Start/finish workouts, add exercises, and rapidly save weight/reps sets
- Workout history
- Apple Notes workout import with a review-before-save preview
- Editable name, calorie goal, protein goal, and weight-unit preferences
- Offline food, bodyweight, and workout draft logging with queued replay and a pending-sync indicator
- Responsive iPhone-first UI and production service worker/manifest
- Full REST endpoints for all core entities

## Local setup

Requirements: Node 22.22.3+ (pinned in `.nvmrc`), Python 3.10+, and optionally Docker for PostgreSQL.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python backend/manage.py migrate
python backend/manage.py runserver
```

In a second terminal:

```bash
cd frontend
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200). The Angular dev server proxies `/api` to Django on port 8000.

SQLite is used automatically for a zero-setup local run. To use the intended PostgreSQL setup:

```bash
docker compose up -d db
pip install -r requirements-postgres.txt
cp .env.example .env
set -a; source .env; set +a
python backend/manage.py migrate
```

## Tests and build

```bash
.venv/bin/python backend/manage.py test tracker
cd frontend && npm run build
```

## Notes import

Open **Progress → Import Apple Notes history**, paste the note, review the parsed workouts and skipped lines, then confirm. The parser accepts the existing shorthand:

```text
9/21/26 upper B
Arsenal chest fly 2x7,6 25lb (4)
Arsenal chest supported row 2x5,5 50,40lb (4,4)
Hip thrust 2x7,7 2.25 plates
```

Single weights repeat across all sets; comma-separated weights map set-by-set; parenthetical machine settings are preserved as exercise notes. See [docs/NOTES_IMPORT.md](docs/NOTES_IMPORT.md).

The note text is kept as an on-device draft until you confirm. Preview and import require a connection to the Pi. A confirmed import is retry-safe if its response is lost, but intentionally importing the same note again as a new import will duplicate those workouts.

## Offline behavior

After the first online load, the PWA shell and previously viewed dashboard/history can open offline. Food, bodyweight, profile edits, and complete workout drafts are saved to IndexedDB before network submission. A banner shows how many changes are waiting; tapping it retries. The app also retries while open, when the browser reports connectivity, and when brought back to the foreground. Keep the app installed on the same phone until the banner reaches zero—clearing browser/site data discards unsynced changes. A closed iPhone PWA cannot be relied on for background sync; reopen it when the Pi is reachable. Simultaneous edits of one workout from multiple devices are not yet merged.

## Repository map

- `frontend/` — Angular standalone-component PWA
- `backend/` — Django + Django REST Framework API
- `docs/` — product brief, architecture, and importer behavior
- `docker-compose.yml` — local PostgreSQL

## Raspberry Pi 3B deployment

This deployment builds Angular on the laptop, then runs only Django, SQLite, and a single Gunicorn worker on the Pi. The laptop can be turned off afterward. The app is available privately to devices logged into your Tailscale tailnet, including your iPhone. It is **not** exposed to the public internet.

The current Pi already uses port 443 for another service, so FitnessApp uses port 8443. With Tailscale connected on your phone, open `https://raspberrypi.tail9c05f9.ts.net:8443/` in Safari. Use Share → Add to Home Screen to install it like an app.

One-time Pi administrator setup (run locally and enter the Pi password there, never in chat):

```bash
ssh pieme@100.74.89.59 'sudo loginctl enable-linger pieme && sudo tailscale set --operator=pieme'
```

Build on the laptop and deploy:

```bash
cd frontend
npm ci
npm run build
cd ..
bash deploy/pi/deploy.sh
ssh pieme@100.74.89.59 'tailscale serve --https=8443 --bg 8080'
```

The deploy script is repeatable. It copies the backend and built frontend, upgrades a Python virtual environment, makes a pre-migration backup, applies migrations, and restarts a user-level systemd service. A daily SQLite backup timer stores copies in `~/fitnessapp-data/backups` on the Pi. The database and secret live outside the deploy directory in `~/fitnessapp-data`. Re-deploys never sync the laptop's local SQLite database.

The API currently has no login. Every device authorized onto the tailnet can access this personal tracker, so keep tailnet membership limited to devices you trust. Do not use Tailscale Funnel or forward port 8080/8443 to the public internet until app-level authentication is implemented. Backups are on the same SD card; copy them off-device periodically for recovery from card failure.
