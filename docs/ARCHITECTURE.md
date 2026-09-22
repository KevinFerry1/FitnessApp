# Architecture

## System shape

The repository is a small monorepo with a separately buildable Angular client and Django API.

```text
iPhone/Desktop browser on Tailscale
        │ private HTTPS :8443
        ▼
Pi Tailscale Serve ── Gunicorn + WhiteNoise ── Angular PWA / Django API ── SQLite
                                                    │                         │
                                          IndexedDB offline queue       relational history
```

During local development, Angular runs on `:4200` and proxies `/api` to Django on `:8000`. On the Pi, Tailscale Serve proxies private HTTPS to loopback Gunicorn; WhiteNoise serves the Angular build from the same origin as Django. PostgreSQL remains an optional local/deployment backend.

## Backend

`backend/config` owns environment/database configuration and top-level routing. `backend/tracker` owns the MVP domain, serializers, viewsets, dashboard aggregation, and Notes importer.

The API currently exposes:

- `/api/today/`
- `/api/foods/`
- `/api/food-logs/`
- `/api/weight-entries/`
- `/api/exercises/`
- `/api/workouts/`
- `/api/workout-exercises/`
- `/api/exercise-sets/`
- `/api/imports/notes/` (`commit: false` previews, `commit: true` writes transactionally)
- `/api/profile/` (single-user settings)
- `/api/sync/` (idempotent offline mutation replay)

The current Pi deployment is private to the tailnet and intentionally has one shared profile without app-level login. Nullable ownership fields remain as seams for eventual accounts. Before public or multi-user access, add authentication, strict per-user filtering, and authorization checks.

## Frontend

The Angular app uses standalone components, signals for screen state, and `HttpClient` for REST calls. The current single shell intentionally keeps the MVP compact. As it grows, split each main tab into lazy routes and move API calls into typed feature services.

The production build registers Angular's service worker and caches the application shell. Food, weight, profile, and workout writes first enter an IndexedDB mutation queue. The app retries in order when it is open and the Pi becomes reachable, and shows the pending count. The backend uses client UUIDs for idempotent food/weight writes and revisioned workout snapshots. Cached dashboard/history responses and active workout drafts remain readable offline. iOS may suspend a closed PWA, so synchronization is not guaranteed until the app is reopened.

## Data integrity choices

- Food logs snapshot nutrition and names so editing a reusable food never changes historical totals.
- Sets are uniquely numbered within a workout exercise.
- Notes imports use a preview endpoint and one database transaction for commit.
- Imported machine settings or parentheticals are preserved as exercise notes.
- Timestamps are stored timezone-aware; the dashboard uses the configured Django timezone for day boundaries.

## Environment variables

See `.env.example`. PostgreSQL is selected whenever `POSTGRES_DB` exists; otherwise SQLite is used. The Pi stores a generated production secret and SQLite file under `~/fitnessapp-data`; Gunicorn binds only to loopback and Tailscale Serve restricts access to the tailnet. Do not expose the permissive API to the public internet.

## Next production hardening

1. Token or session authentication and strict per-user query filtering
2. CI, API pagination, and observability
3. Off-device backups (daily Pi backups are on the same SD card)
4. Conflict handling for simultaneous edits from multiple devices
5. Exercise/food reuse endpoints so duplicates are not created during quick entry
