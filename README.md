# FitnessApp

A mobile-first calorie, bodyweight, and gym-workout tracker. The MVP is an installable Angular PWA backed by a Django REST API and PostgreSQL-ready relational models.

## What works now

- Today dashboard with calories, protein, latest bodyweight, and today's activity
- Fast custom-food logging with snapshotted nutrition history
- Bodyweight check-ins
- Start/finish workouts, add exercises, and rapidly save weight/reps sets
- Workout history
- Apple Notes workout import with a review-before-save preview
- Responsive iPhone-first UI and production service worker/manifest
- Full REST endpoints for all core entities

## Local setup

Requirements: Node 22.22.3+ (pinned in `.nvmrc`), Python 3.12+, and optionally Docker for PostgreSQL.

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

## Repository map

- `frontend/` — Angular standalone-component PWA
- `backend/` — Django + Django REST Framework API
- `docs/` — product brief, architecture, and importer behavior
- `docker-compose.yml` — local PostgreSQL

The current MVP intentionally allows unauthenticated local data. Authentication and per-user API enforcement are the next production milestone.
