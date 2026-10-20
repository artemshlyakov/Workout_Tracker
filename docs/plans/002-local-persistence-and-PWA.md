# Plan 002 — local persistence + offline shell in development mode

**Status: PLANNED, after Plan 001.** This is a **development-only** local test profile; not a public guest journal. See accepted ADR 0006.

## Goal
Build reliable IndexedDB data persistence and PWA shell before Supabase, with a clearly labeled `Режим разработки — нет аккаунта и облачной копии` state. Do NOT publish this build as a usable multiuser service.

## Read
`AGENTS.md`, `ARCHITECTURE.md`, `docs/architecture/{auth,offline-sync,data-model}.md`, `docs/product/user-flows.md`, `docs/quality/acceptance.md`, ADR 0002/0006.

## Deliverables
1. Dexie schema for test workspace, workouts, exercises, workoutExercises, sets, outbox, syncState; stable UUID and revision fields.
2. Transactional record+outbox saves; localized error/status messages.
3. Offline shell caching/static assets, and ability to reload local data without network after first install.
4. Versioned JSON export/import with validation and failure tests.
5. Domain services/ports; UI not importing Dexie directly. User ownership field ready for future `auth.uid()` binding.
6. **Obvious dev-only banner**, no fake login, no real sharing/production deployment and no auto-cloud migration of test data.
7. Unit/integration tests: persistence, outbox atomic rollback, restart, deletion tombstone, corrupted import.

## Out of scope
Public registration, Supabase, real cross-device identity/sync, charts, Google OAuth, SMTP.

## DoD
Persisted records survive reload/offline reopen in dev profile; atomic write + export/import tested; clear explanation of local-only test mode. Still not ready for real use.
