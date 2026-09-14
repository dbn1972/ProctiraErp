# Database — canonical apply order

ProctiraERP uses **two** schema layers:

1. **Prisma** (`packages/shared/database`) — shared platform tables and migrations
2. **Domain SQL** (`db/sql/[0-9]*.sql`) — module schemas (health, SIS, transport, …) that services expect on live Postgres

If only Prisma is applied, raw-SQL modules fall back to in-memory stores in tests (gap **G-002**).

## Schema authority (W1-DATA-04)

The layers are **not** interchangeable. Competing DDL without a drift gate caused
auth session models (`RefreshToken` / `UserSession`) to exist in
`schema.prisma` with no executable CREATE TABLE on fresh Postgres.

| Layer | Owns | Must not |
| --- | --- | --- |
| Prisma migrations | Platform tables that ship under `prisma/migrations/` | Be skipped before `apply-sql.sh` |
| Numbered `db/sql/` | Domain schemas **and** Prisma-mapped tables that lack a Prisma migration (e.g. `066_auth_session_tables.sql`) | Drift from Prisma `@map` / column names for SQL-backed critical models |

**Enforce:**

1. Apply order below (Prisma → `apply-sql.sh`) — required in CI and live setup.
2. Executable gate: `pnpm check:prisma-sql-drift` (`tools/scripts/check-prisma-sql-drift.mjs`).
   Fails when any Prisma `@@map` table has no `CREATE TABLE` in migrations or
   `db/sql/`, or when critical auth session columns are missing from `db/sql/`.

## Runtime vs migrator roles (W1-DATA-01 / W1-DATA-10)

PostgreSQL table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set.
Application runtimes must therefore connect as **`proctira_app`** (non-owner,
`NOSUPERUSER` / `NOBYPASSRLS`). Prisma migrate and `tools/scripts/apply-sql.sh`
use the table-owning migrator role via `MIGRATOR_DATABASE_URL` (falls back to
`DATABASE_URL` for backwards compatibility).

**Fresh install role bootstrap (W1-DATA-10):** do not hand-write `CREATE ROLE`.
Use the documented, idempotent path:

```bash
export BOOTSTRAP_DATABASE_URL=postgresql://postgres:SECRET@host:5432/postgres
export MIGRATOR_PASSWORD=…
export APP_ROLE_PASSWORD=…
export BOOTSTRAP_DB_NAME=proctira
bash tools/scripts/bootstrap-db-roles.sh
```

`apply-sql.sh` and `setup-live-db-and-onboard.sh` invoke the same wrapper when
`BOOTSTRAP_DATABASE_URL` is set. Local compose mounts
`db/bootstrap/01_runtime_roles.sql` into `docker-entrypoint-initdb.d`.
DML grants after schema exists remain in `db/sql/050_app_runtime_role.sql`.
See `db/bootstrap/README.md`.

## Strict tenant foreign keys (W1-DATA-06)

`021b_tenant_fk_constraints.sql` adds `tenant_id → tenants(id)` as **NOT VALID**
(new rows checked; existing rows deferred). `068_validate_tenant_fk_constraints.sql`
then **VALIDATE**s those constraints.

Opt-in locally via `APPLY_STRICT_FKS=1` (also applies `021a` demo-tenant
prerequisite so `*b_*_seed.sql` rows validate). Primary CI, restore-drill, and
live onboard set `APPLY_STRICT_FKS=1`. Executable gate:
`pnpm check:strict-tenant-fks` fails when a workflow runs `apply-sql.sh` without
that flag unless the step documents `# STRICT_FK_SKIP_JUSTIFIED: …`.

## Leading tenant_id indexes (W1-DATA-16)

Every table that declares a `tenant_id` column must have a btree index, UNIQUE,
or PRIMARY KEY whose **first** column is `tenant_id` (composites that bury
`tenant_id` do not count). Documented exceptions live in
`tools/scripts/tenant-id-index-allowlist.json` and must include a reason.
Executable gate: `pnpm check:tenant-id-indexes`. Additive fix migration:
`db/sql/071_tenant_id_leading_indexes.sql`. See
`docs/audits/DATA_W1_DATA_16_INDEXES.md`.

## Cross-domain UUID FKs (W1-DATA-15)

`071_cross_domain_fk_constraints.sql` adds the highest-value missing
`REFERENCES` for student / enrollment / fee / grade cross-refs as **NOT VALID**,
then `072_validate_cross_domain_fk_constraints.sql` **VALIDATE**s them.
Always applied by `apply-sql.sh` (not gated on `APPLY_STRICT_FKS`). See
`docs/audits/DATA_W1_DATA_15_FKS.md` for the closed set and honest residuals
(hostel / library / LMS / transport / health TEXT ids / intentional
cross-schema bare UUIDs).

## Immutability privileges (W1-DATA-08)

Append-only tables (fee ledger, audit log, workflow transition audit, issued
transcripts) ship `BEFORE UPDATE OR DELETE` triggers. `053_immutability_privileges.sql`
also **REVOKEs UPDATE/DELETE/TRUNCATE/TRIGGER** on those tables from `proctira_app`
so runtime cannot mutate rows or disable guards even if connected with broad DML grants.

`069_audit_archive_transcript_authenticity.sql` extends the same posture to
`audit_log_archive` (permanent append-only + REVOKE) and requires
`checksum_sha256` + `signature_hmac` on ISSUED `transcript_issuances` inserts.
See `docs/audits/DATA_W1_DATA_08_IMMUTABILITY.md`.

## Domain SQL apply ledger (W1-DATA-05)

Numbered `db/sql/` apply is **not** whole-set atomic (Postgres cannot wrap every
DDL form across dozens of files in one safe transaction). Resume safety comes
from the `schema_migrations` ledger instead:

| Behavior | Rule |
| --- | --- |
| Record | After each successful file: `filename` + sha256 in `schema_migrations` |
| Skip | Ledger checksum matches current file → do not re-apply |
| Fail-closed | Ledger checksum differs → exit non-zero (do not overwrite) |
| Legacy NULL | Pre-checksum self-insert rows get the current digest adopted; file is not re-applied |
| Per-file TX | Default `psql --single-transaction` for the file + ledger INSERT |

**Multi-statement limits:** statements that cannot run inside a transaction
(`CREATE INDEX CONCURRENTLY`, `VACUUM`, some older `ALTER TYPE … ADD VALUE`
forms) are applied without `-1` when the file text contains `CONCURRENTLY`, or
for every file when `APPLY_SQL_NO_TX=1`. Prefer avoiding those forms under
`db/sql/` so per-file atomicity holds.

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
- **W1-DATA-05:** ledger-safe resume via `schema_migrations` (skip match / fail mismatch / per-file TX)
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

`withPgTenant` / `withTenantTransaction` / `bindTenantGuc` (W1-DATA-12) bind
the **canonical** GUC `app.tenant_id` and sync the legacy alias
`app.current_tenant_id` in one parameterized statement. Prefer these helpers —
never hand-roll a single GUC name.

SQL helpers in `071_tenant_guc_canonical.sql`:
- `app_tenant_id()` — effective tenant (canonical first, legacy alias fallback)
- `set_app_tenant_id(text)` — writer that sets canonical + syncs legacy

Reference wiring: `packages/backend/staff/src/pg-leave-repository.ts`.
Other `pg-*-repository` modules must adopt the same pattern when touching
RLS-protected tables. See also `tools/tenant-isolation-tests` (raw-sql-rls +
tenant-guc-canonical unit) and `docs/audits/DATA_W1_DATA_12_GUC.md`.
