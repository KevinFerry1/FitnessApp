# Product Brief: Mobile-First Calorie + Exercise Tracker

## Vision

Build a personal calorie and exercise tracker optimized first for iPhone, while remaining comfortable on desktop. Logging food, workouts, bodyweight, and progress should be fast enough to use one-handed between sets, at a restaurant, or while walking through a store.

The first client is an installable progressive web app rather than a native Swift app. Business logic and history live behind a REST API so a future SwiftUI or React Native client can reuse the backend. Possible later integrations include HealthKit, Apple Watch, widgets, Live Activities, Shortcuts, barcode scanning, notifications, and background sync.

## Technology direction

- Frontend: Angular, responsive mobile-first PWA
- Backend: Django and Django REST Framework
- Database: PostgreSQL in hosted environments, with SQLite as a local zero-setup fallback
- API: REST, separated from presentation concerns
- Offline direction: service-worker shell caching first; IndexedDB and a pending-mutation queue later

## Product principles

- Prefer taps over typing.
- Use large touch targets and phone-appropriate numeric keyboards.
- Remember previous values and surface recent foods, meals, and exercises.
- Prepare the next set immediately after saving the current one.
- Keep common tasks shallow; the product should not feel like a spreadsheet.
- Start with a small, useful MVP and resist implementing the full roadmap prematurely.

## Main navigation

### Today

The primary dashboard shows consumed and remaining calories, macro progress, latest bodyweight, today's food and workout, and quick actions for food, weight, and training.

### Food

The MVP supports manually created foods, serving details, calories, protein, carbohydrates, fat, meal type, and recent daily history. Nutrition is snapshotted into each food log so later edits do not rewrite history. Later additions may include favorites, saved meals, recipes, barcode scanning, nutrition databases, restaurants, copy-yesterday, and assisted text or photo entry.

### Workout

Workouts contain ordered exercises, and exercises contain ordered sets with weight, repetitions, unit, type, and timestamp. The logging screen should show prior values, default intelligently, and make repeated working sets extremely quick. Later additions may include templates, rest timers, previous performance, PRs, warmups, drop sets, RPE/RIR, supersets, substitutions, estimated 1RM, and volume.

### Progress

History begins with workouts and bodyweight. Later views may chart weight, calories, weekly averages, protein, strength, volume, estimated 1RM, PRs, and workout frequency over week, month, quarter, half-year, year, and all-time ranges.

### Profile

Settings eventually include calorie and macro targets, current and goal weight, lb/kg, timezone, theme, account, export, PWA information, and health integrations.

## MVP acceptance criteria

The first useful release lets the user:

1. Open the app on iPhone and install it to the Home Screen.
2. Log a custom food and see today's calorie total.
3. Log bodyweight.
4. Start and finish a workout.
5. Add exercises and log weight/reps sets.
6. See today's activity and basic history.
7. Import existing Apple Notes workout history in the user's established shorthand.

## Core data model

- `UserProfile`: nutrition goals, current/goal weight, unit, timezone
- `Food`: reusable nutrition definition; optionally global or user-owned
- `FoodLog`: timestamp, meal, quantity, and nutrition snapshots
- `BodyWeightEntry`: timestamp, weight, unit, optional note
- `Exercise`: reusable built-in or custom exercise
- `Workout`: start/completion timestamps, name, notes, import source
- `WorkoutExercise`: ordered exercise within a workout, plus notes
- `ExerciseSet`: set number, weight, repetitions, unit, type, timestamp

## Incremental build plan

1. Repository, documentation, Angular/Django structure, PostgreSQL configuration
2. Core models, migrations, CORS, API routing, and authentication seam
3. Mobile shell, five-tab navigation, PWA manifest and service worker
4. Functional Today dashboard and quick actions
5. Fast food, bodyweight, and workout flows
6. Notes history import and validation
7. Authentication, deployment, offline mutation queue, and richer reuse/history

## Longer-term roadmap

- Nutrition: saved meals, recipes, barcodes, USDA/provider APIs, restaurant foods, assisted entry
- Training: templates, timers, PRs, charts, substitutions, advanced set types, RPE/RIR
- Body progress: smoothed trends, weekly averages, rate projections, photos, measurements
- Apple ecosystem: HealthKit, Watch, steps, active calories, widgets, Live Activities
