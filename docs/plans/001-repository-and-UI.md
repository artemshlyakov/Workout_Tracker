# Plan 001 — React bootstrap + active workout UI

**Status: READY FOR CODEX.** Offline-first strategy accepted, but **this plan stays non-persistent by design**. No Supabase credentials/accounts needed.

## Mandatory reading
`AGENTS.md`, `ARCHITECTURE.md`, `docs/product/requirements.md`, `docs/design/design-system.md`, `docs/design/screens.md`, `docs/quality/acceptance.md`, accepted ADRs 0002, 0003 and **0006 (required login in public release; NOT in Plan 001)**. For context consult `offline-sync.md` headings only; do not implement it now.

## Objective
Mobile-first Russian React app matching hybrid theme, with usable active-workout interaction, but only local React state. Show conspicuous `Демо — данные не сохраняются`.

## Deliverables
1. React + TypeScript + Vite scaffold; deterministic package lock; minimal dependencies; Git ignore for secrets and build output.
2. Central CSS custom-property tokens; reusable `Button`, `NumericField`, `SetRow`, `ExerciseCard`, `DemoSaveStatus`.
3. Seed `Жим лёжа` with three sets 80×10, 80×9, 75×10. Fields editable, add/delete set, total volume dynamic.
4. Domain types, pure calculations and validation separate from components. Define `WorkoutRepository` interface/port only if truly helpful, but **no mock claim of persistent save** and no premature sync implementation.
5. Configure lint, typecheck, Vitest; tests for invalid weight/reps, add/remove volume, decimal comma.
6. Responsive mobile UI at 360x800 and 390x844, usable keyboard, no horizontal overflow, accessible labels/focus, minimum 44px targets.
7. README local dev commands, module map and truthful note that reload resets demo.

## Prohibited scope
NO IndexedDB/Dexie, Supabase, live Auth or login flow, Postgres, service worker/PWA, charts with invented figures, backend, paid AI/API, automated cloud deployment. Do not build unrelated screens unless a minimal stub is necessary for navigation; no inert controls that look functional.

## Workflow
Inspect docs -> summarize ≤8 points -> implement single vertical slice -> run checks -> inspect screenshots if browser tools available -> self-review/report -> STOP pending owner review.

## Acceptance
`npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`; 80×10 +80×9+75×10=2270; after add/edit/delete instantly recalculates; invalid values cannot enter domain; banner visible; 360/390 mobile without side scrolling. Report which UI inspections actually executed. Owner reviews on phone before Plan 002.
