# Plan 003A security checks

`security.integration.mjs` runs against the real Supabase REST/RPC endpoints **only after** the reviewed migration is applied and two controlled test accounts A/B exist. Provide `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TEST_USER_A_JWT`, and `TEST_USER_B_JWT` through the local environment, then run `node supabase/tests/security.integration.mjs`. Do not commit or print JWTs. The script creates test rows in both accounts.

The SQL fixture is a narrower, reproducible **local** check of the migration and SQL authorization behavior. It simulates `auth.uid()`/`auth.jwt()` with session settings and cannot verify Supabase Auth or PostgREST. Run it only in an empty, disposable PostgreSQL 17 database with `pgcrypto` available to install:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/local-bootstrap.sql
psql -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261020132939_private_workout_sync.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/security.local.sql
```

`local-bootstrap.sql` deliberately leaves `pgcrypto` disabled, so the migration must install it in `extensions` itself. To test the already-enabled case in another empty database, run `create schema extensions; create extension pgcrypto with schema extensions;` after bootstrap and before the migration. The local checks passed in both variants on PostgreSQL 17.

`security.local.sql` rolls back all test data. It checks RLS and grants for every table, including direct `INSERT`, `UPDATE` and `DELETE` denial for `authenticated`, all table access denial for `anon`, and no direct access to `sync_operations`. It also checks A/B isolation, Auth anonymous isolation, foreign parents, operation replay and payload mismatch, duplicate entity UUID, CAS and tombstone. The first two commands leave the temporary schema in place, so discard the database after testing.
