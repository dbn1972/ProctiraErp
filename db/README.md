# Database — canonical apply order

ProctiraERP uses **two** schema layers:

1. **Prisma** (`packages/shared/database`) — shared platform tables and migrations
2. **Domain SQL** (`db/sql/[0-9]*.sql`) — module schemas (health, SIS, transport, …) that services expect on live Postgres

If only Prisma is applied, raw-SQL modules fall back to in-memory stores in tests (gap **G-002**).

## Runtime vs migrator roles (W1-DATA-01)

PostgreSQL table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set.
Application runtimes must therefore connect as **`proctira_app`** (non-owner,
`NOSUPERUSER` / `NOBYPASSRLS`). Prisma migrate and `tools/scripts/apply-sql.sh`
use the table-owning migrator role via `MIGRATOR_DATABASE_URL` (falls back to
`DATABASE_URL` for backwards compatibility).

See `db/sql/050_app_runtime_role.sql` and `db/docker-init/01_app_runtime_role.sql`.

## Apply order (required)

```bash
# 1) Prisma first
export DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB
pnpm --filter @proctira/database run prisma:migrate:deploy

# 2) Domain SQL (001…N, including *b* demo seeds colocated under db/sql/)
bash tools/scripts/apply-sql.sh
```

`tools/scripts/apply-sql.sh`:

- Prefers `MIGRATOR_DATABASE_URL`, then `DATABASE_URL`; otherwise libpq (`PGDATABASE` defaults to `proctira`)
- Applies every `db/sql/[0-9]*.sql` in **`LC_ALL=C` sort order** (so `006_…schema` runs before `006b_…seed`)
- Uses `psql -v ON_ERROR_STOP=1` and exits non-zero on failure
- Supports `--dry-run` to list files without applying

CI Integration Tests run step (2) immediately after `prisma:migrate:deploy`.

## Seeds (`db/seeds/`) — separate, not auto-applied

Files under `db/seeds/` are **demo / certification data** (large enrollments, board scales, schedule demos). They are **not** applied by `apply-sql.sh` because they can be destructive or environment-specific.

Apply explicitly when needed, for example:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/002_multi_board_schools_500.sql
```

`tools/scripts/setup-live-db-and-onboard.sh` runs `apply-sql.sh` for all numbered domain SQL, then applies the multi-board onboard seed.

Module-local demo seeds that ship next to schema (`006b`, `007b`, …) **are** included in the numbered `db/sql/` apply and run after their schema file.

## Row-Level Security (G-103) — `015_rls_policies.sql`

`db/sql/015_rls_policies.sql` enables RLS + a `tenant_isolation` policy on every
domain table with a `tenant_id` column under health, timetable, gradebook,
notifications, transport, communication, hostel, library, parent, fees, HR leave,
and admissions. Scholarships tables (G-204) are created in `016_scholarships_schema.sql`
with RLS policies in the same file (applied after 015).

Policies compare:

```sql
tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
```

**Application requirement:** raw `node-pg` repositories must bind the tenant
inside a transaction before querying:

```ts
import { withPgTenant } from '@proctira/database';

await withPgTenant(pool, tenantId, async (client) => {
  return client.query('SELECT * FROM staff_leave_requests WHERE …');
});
```

`withPgTenant` runs `BEGIN`, `set_config('app.tenant_id', …, true)`, and also
sets `app.current_tenant_id` for alignment with Prisma RLS.
`withTenantTransaction` (Prisma) now sets both variables as well.

Reference wiring: `packages/backend/staff/src/pg-leave-repository.ts`.
Other `pg-*-repository` modules must adopt the same pattern when touching
RLS-protected tables. See also `tools/tenant-isolation-tests` (raw-sql-rls unit).
