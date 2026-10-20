# ADR 0002 — Offline recording is a release blocker

**Status: ACCEPTED (2026-10-19 by product owner).**

## Decision
Do not call the app a reliable personal workout tracker until installed PWA + IndexedDB + cloud sync pass the fault-test matrix. Plan 001 is a non-persistent UI demo and not suitable for daily gym records. Reorder Plan 002 to local persistence FIRST, before Supabase/cloud Plan 003, then reliability Plan 004.

## Why
Weak/no gym connection must not block logging. Starting cloud-only leads to reworking the write path when local persistence is added.

## Consequences
Plan 002 uses a **development-only** local test profile, not a public guest journal. Real users authenticate once online, then use a user-scoped offline cache; transactional outbox, manual backup/export and conflict-safe server sync remain required. See ADR 0006. No guarantee against browser storage deletion or device loss.
