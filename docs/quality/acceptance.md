# Definition of Done (DoD) — v0.5

## All Codex tasks
Active-plan-only scope; read relevant docs/accepted ADR; domain tests for changed code; run lint/typecheck/tests/build where created; report actually executed checks. Mobile 360px/390px; tap targets >=44px; no overflow. No secrets, paid services, fake sync claims. Offline-first and mandatory auth are contractual.

## Plan 001 — visual demo
React TS workout screen; seeded 80×10 + 80×9 + 75×10 = 2270 kg; edit/delete/add works; `Демо — данные не сохраняются`; no auth/cloud/IDB/PWA, no public release.

## Plan 002 — development-only local durability
Persist local test data across reload/offline reopen; atomic record+outbox; rollback error honest; export/import works. Banner `Режим разработки — нет аккаунта и облачной копии`. **No production guest journal.**

## Plan 003 — required identity, private storage
Login/signup email+password в режиме **закрытого пилота** с `Confirm Email OFF`; после создания владельца — **серверный запрет** новых signup, пользовательский recovery пока недоступен и не имитируется. Account gate, user scope. RLS+grants tested for user A/B/anon on every public table incl FK forging. Device cache not shared, outbox not cross-uploaded. Initial upload/pull with stable operations and server ack. No false claims about email verification/recovery or public signup.

## Plan 004 — release blockers
- Offline logged-in-existing-user sets persist through restart and sync exactly once.
- First offline login and signed-out offline access disallowed; stale different-user cache hidden.
- A/B/anon security verified through direct API/RLS tests.
- Pending warning at signout, non-loss of data, per-user isolation.
- Conflict/manual choice, retry after unknown server ack, tombstones and export/import all tested.
- Real phone and GitHub Pages Auth redirects verified; no known loss or privacy bug.

## UX targets
3 sets in <=90s after onboarding. Show distinct local/pending/synced/auth expired/conflict labels. Main controls >=44px. No mobile overflow; number keyboard does not obscure fields.
