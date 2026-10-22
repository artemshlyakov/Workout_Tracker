# Plan 003A security checks

`security.integration.mjs` runs against the real Supabase REST/RPC endpoints **only after** the reviewed migration is applied and two controlled test accounts A/B exist. It creates test rows in both accounts. It checks A/B/anon visibility, direct table writes, forged FK, operation replay, CAS and tombstones.

For the closed Plan 003B pilot, `auth-pilot.mjs` stages the work so signup is open only briefly. Set the **public** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` environment variables, then:

1. Ensure this execution environment permits HTTPS to `snnlibzckwpmbkersdnm.supabase.co`. Run `node supabase/tests/auth-pilot.mjs preflight` to read the server Auth settings. In the managed Node 24 environment, prefix every phase with `NODE_USE_ENV_PROXY=1` so `fetch` uses the configured HTTPS proxy, including the REST/RPC tests launched by `verify`. This performs no signup. Do not open registration until this connection works.
2. After the owner enables Email/password, disables Confirm Email, and temporarily enables `Allow new users to sign up`, run `node supabase/tests/auth-pilot.mjs signup`. It creates **exactly two** random `@example.invalid` accounts through normal Auth signup and stops. Separate random passwords are written only to `/tmp/workout-tracker-plan003b-auth.json` with mode `0600`. No JWT or password is printed or committed.
3. **Stop immediately** and have the owner disable `Allow new users to sign up` in Supabase Dashboard. After their confirmation, run `node supabase/tests/auth-pilot.mjs verify`. It checks the server reports signup disabled, existing A/B can sign in, a new signup is rejected, then passes short-lived tokens in memory to `security.integration.mjs`.
4. Keep the temporary credential file until remaining browser/reconnect checks finish; then run `node supabase/tests/auth-pilot.mjs cleanup`. This removes only local test passwords, **not** cloud accounts or data. If the workspace is replaced before tests finish, the generated passwords may be unrecoverable.

Do not copy the temporary file, passwords, JWTs or session responses into Git, CI, PR descriptions or logs. If signup returns a user without a session, stop: Confirm Email may still be enabled, and a user might already have been created. Do not repeat signup blindly. The script does not use a service role key or Supabase admin API.

The SQL fixture is a narrower, reproducible **local** check of the migration and SQL authorization behavior. It simulates `auth.uid()`/`auth.jwt()` with session settings and cannot verify Supabase Auth or PostgREST. Run it only in an empty, disposable PostgreSQL 17 database with `pgcrypto` available to install:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/local-bootstrap.sql
psql -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261020132939_private_workout_sync.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/security.local.sql
```

`local-bootstrap.sql` deliberately leaves `pgcrypto` disabled, so the migration must install it in `extensions` itself. To test the already-enabled case in another empty database, run `create schema extensions; create extension pgcrypto with schema extensions;` after bootstrap and before the migration. The local checks passed in both variants on PostgreSQL 17.

`security.local.sql` rolls back all test data. It checks RLS and grants for every table, including direct `INSERT`, `UPDATE` and `DELETE` denial for `authenticated`, all table access denial for `anon`, and no direct access to `sync_operations`. It also checks A/B isolation, Auth anonymous isolation, foreign parents, operation replay and payload mismatch, duplicate entity UUID, CAS and tombstone. The first two commands leave the temporary schema in place, so discard the database after testing.
