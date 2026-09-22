# Architecture

## System shape

The repository is a small monorepo with a separately buildable Angular client and Django API.

```text
iPhone/Desktop browser
        │ HTTPS / JSON
        ▼
Angular PWA ── /api/* ── Django REST Framework ── PostgreSQL
     │                                  │
service-worker shell             relational history
```

During local development, Angular runs on `:4200` and proxies `/api` to Django on `:8000`. In production, a reverse proxy should serve the Angular build and forward `/api` to Django under the same origin.

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

Models already include nullable ownership seams so authentication can be enforced without redesigning history. Before deployment, change the default permission policy and filter every queryset to the authenticated user.

## Frontend

The Angular app uses standalone components, signals for screen state, and `HttpClient` for REST calls. The current single shell intentionally keeps the MVP compact. As it grows, split each main tab into lazy routes and move API calls into typed feature services.

The production build registers Angular's service worker and caches the application shell. API writes still require a connection; a future offline layer should write pending mutations to IndexedDB with idempotency keys and replay them when connectivity returns.

## Data integrity choices

- Food logs snapshot nutrition and names so editing a reusable food never changes historical totals.
- Sets are uniquely numbered within a workout exercise.
- Notes imports use a preview endpoint and one database transaction for commit.
- Imported machine settings or parentheticals are preserved as exercise notes.
- Timestamps are stored timezone-aware; the dashboard uses the configured Django timezone for day boundaries.

## Environment variables

See `.env.example`. PostgreSQL is selected whenever `POSTGRES_DB` exists; otherwise local SQLite is used. Do not use the development secret or permissive API policy in production.

## Next production hardening

1. Token or session authentication and strict per-user query filtering
2. Deployed PostgreSQL, secrets management, HTTPS, and CI
3. API pagination, input constraints, observability, and backups
4. IndexedDB caching and offline mutation reconciliation
5. Exercise/food reuse endpoints so duplicates are not created during quick entry
