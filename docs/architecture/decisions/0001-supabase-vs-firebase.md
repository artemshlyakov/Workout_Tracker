# ADR 0001 — Supabase + PostgreSQL for cloud

**Status: ACCEPTED (2026-10-19).**

## Decision
Use Supabase Auth + PostgreSQL/RLS for cloud identity/data, GitHub Pages for frontend. Sync is explicit local-first (IndexedDB), not Firestore's built-in offline SDK.

## Rationale
Relational schema for workouts/exercises/sets, transferable SQL skills, free-tier entry. Backend business logic can be localized in protected Postgres RPCs for atomic sync operations without running our own server.

## Risks and mitigation
Custom sync is harder than Firebase Firestore offline; use outbox, idempotent operation ledger, server revisions/tombstones, two-user RLS tests. Supabase Free projects may pause; local recording cannot depend on server uptime. Conditions and quotas must be checked before deployment.

## Alternative
Firestore's offline SDK simplifies some cases but shifts stack to a document data model. Local-only solution lacks cross-device recovery. Self-hosted API requires operations budget.
