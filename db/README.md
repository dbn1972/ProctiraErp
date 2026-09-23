# Database — canonical apply order

ProctiraERP uses **two** schema layers:

1. **Prisma** (`packages/shared/database`) — shared platform tables and migrations
2. **Domain SQL** (`db/sql/[0-9]*.sql`) — module schemas (health, SIS, transport, …) that services expect on live Postgres

If only Prisma is applied, raw-SQL modules fall back to in-memory stores in tests (gap **G-002**).

## Schema authority (W1-DATA-04)

The layers are **not** interchangeable. Competing DDL without a drift gate caused
auth session models (`RefreshToken` / `UserSession`) to exist in
`schema.prisma` with no executable CREATE TABLE on fresh Postgres.

| Layer              | Owns                                                                                                          | Must not                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Prisma migrations  | Platform tables that ship under `prisma/migrations/`                                                          | Be skipped before `apply-sql.sh`                                       |
| Numbered `db/sql/` | Domain schemas **and** Prisma-mapped tables that lack a Prisma migration (e.g. `066_auth_session_tables.sql`) | Drift from Prisma `@map` / column names for SQL-backed critical models |

**Every Prisma-mapped table declares exactly one DDL authority** in
`tools/scripts/prisma-sql-schema-authority.json` (`prisma` | `sql`). Dual
`CREATE TABLE` is fail-closed unless `mirrorOk: true` (bootstrap IF NOT EXISTS
copy only).

**Enforce:**

1. Apply order below (Prisma → `apply-sql.sh`) — required in CI and live setup.
2. Executable gate: `pnpm check:prisma-sql-drift` (`tools/scripts/check-prisma-sql-drift.mjs`).
   Fail-closed catalog parity for every Prisma model: columns, types,
   nullability, defaults, PK / UNIQUE / CHECK / FK / INDEX, plus authority
   declaration. Critical auth session tables must remain `authority: sql`.
   Additive fix for known residuals: `db/sql/081_prisma_sql_catalog_parity.sql`.

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

Application runtimes must never load or replay numbered `db/sql/*.sql` files,
or issue `CREATE`/`ALTER`/other DDL through a runtime database client. They may
only perform read-only schema readiness checks: `to_regclass` verifies each
centralized adapter relation and the narrowly permissioned
`proctira_runtime_migration_status()` function verifies the minimum application
schema marker plus strict-FK repair. The underlying migration ledgers remain
denied to `proctira_app`. Missing relations or ALTER/integrity migrations fail
with a migration-required error before domain DML. The fail-closed static gate
is:

```bash
pnpm check:runtime-ddl
```

The active deploy workflow requires a separately scoped GitHub Environment
secret named `MIGRATOR_DATABASE_URL`. Before Helm rollout it runs Prisma then
seed-free domain SQL with `APPLY_STRICT_FKS=1`, verifies migrations 082/091/092/093
and hostel indexes plus developer-portal tenant foreign keys, then checks the actual `proctira_app` secret with
`assert-runtime-schema-ready.sh`. The migrator URL is never rendered into Helm
or mounted into application pods.

## Strict tenant foreign keys (W1-DATA-06 COMPLETE)

**Deploy / CI gate (W1-DATA-01 COMPLETE):** every production (and can-deploy)
release must prove the _actual_ runtime secret is non-owner:

```bash
# Fail closed when RUNTIME_ROLE_GATE_REQUIRED=1 or ENVIRONMENT=production
DATABASE_URL=postgresql://proctira_app:…@host/db \
  bash tools/scripts/assert-runtime-database-role.sh

# Static wiring (required CI job runtime-role-gate → ci-aggregate)
pnpm check:runtime-role-gate
```

ExternalSecret / Helm `DATABASE_URL` remote keys must point at `proctira_app`
(see `infrastructure/k8s/overlays/*/external-secret.yaml` and
`docs/audits/DATA_W1_DATA_01_COMPLETE.md`).

## Strict tenant foreign keys (W1-DATA-06)

`021b_tenant_fk_constraints.sql` adds `tenant_id → tenants(id)` as **NOT VALID**
(new rows checked; existing rows deferred). `068_validate_tenant_fk_constraints.sql`
then **VALIDATE**s those constraints. `082_repair_strict_tenant_fk_validate.sql`
re-runs create+validate and **fail-closes** if any unvalidated or missing FKs
remain — repairing installs that previously recorded a no-op `068` while
`021b` was skipped.

`APPLY_STRICT_FKS` defaults **ON** when `CI=true` or `NODE_ENV=production`
(explicit `0` still opts out for local unit fixtures). The same flag gates
`021a` / `021b` / `068` / `082` / `100` so VALIDATE cannot be ledger-recorded
without create. Primary CI, restore-drill, and live onboard also set
`APPLY_STRICT_FKS=1` explicitly. Executable gates:

- `pnpm check:strict-tenant-fks` — static posture (default ON, workflows,
  VALIDATE + repair present)
- `pnpm check:strict-tenant-fks -- --live --require-live` — live `pg_catalog`
  proof of **zero** unvalidated `tenant_id → tenants` FKs (CI after apply)

`100_tenant_id_uuid_fks.sql` is in that gate for a second reason beyond being
strict-FK work: it closes with a **repo-wide** assertion that every `uuid`
`tenant_id` column has a validated FK to `tenants`, and those FKs are created by
`021b` and validated by `068` / `082`. With `100` outside the gate, a plain
`bash tools/scripts/apply-sql.sh` skipped the files that produce that state and
then failed asserting it — 100+ files applied, then a hard error naming 38 tables
`100` does not touch. The consequence of the gate is that a local
`APPLY_STRICT_FKS=0` database keeps `text tenant_id` on the 23 tables `100`
migrates; that is the same divergence `021b` / `068` already accept for this
configuration, and CI proves the `uuid` posture on every PR. The
`Apply domain SQL with the developer default` step in `ci.yml` exists to keep the
non-strict path exercised, because every other CI invocation sets the flag.

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
Residual campus / ops `student_id` refs (hostel, library, LMS, transport,
health nurse incidents, exam seating) are closed by
`073_cross_domain_fk_campus_ops.sql` + `074_validate_cross_domain_fk_campus_ops.sql`.
Staff / HR `staff_id` and transport fee invoice/structure links are closed by
`085_cross_domain_fk_staff_ops.sql` + `086_validate_cross_domain_fk_staff_ops.sql`.
Prisma FORCE-RLS hazardous tables (`student_attendance`, `assessment_results`,
examination candidate tables, `staff_attendance`) get **NOT VALID only** in
`087_cross_domain_fk_prisma_not_valid.sql` (no VALIDATE companion — safe pattern).
Always applied by `apply-sql.sh` (not gated on `APPLY_STRICT_FKS`). See
`docs/audits/DATA_W1_DATA_15_COMPLETE.md` (and prior
`DATA_W1_DATA_15_DANGLES.md` / `DATA_W1_DATA_15_FKS.md`) for closed sets and
honest residuals (Prisma VALIDATE waiver, health TEXT ids, intentional
institution-boundary bare UUIDs).

## Immutability privileges (W1-DATA-08)

Append-only tables (fee ledger, audit log, workflow transition audit, issued
transcripts) ship `BEFORE UPDATE OR DELETE` triggers. `053_immutability_privileges.sql`
also **REVOKEs UPDATE/DELETE/TRUNCATE/TRIGGER** on those tables from `proctira_app`
so runtime cannot mutate rows or disable guards even if connected with broad DML grants.

`069_audit_archive_transcript_authenticity.sql` extends the same posture to
`audit_log_archive` (permanent append-only + REVOKE) and requires
`checksum_sha256` + `signature_hmac` on ISSUED `transcript_issuances` inserts.

`076_transcript_authenticity_complete.sql` closes the residual: migrator
backfill of every ISSUED row, `VALIDATE CONSTRAINT` on the authenticity CHECK,
and `transcript_signing_keys` (rotated KMS/PKI refs). App signing uses
`TRANSCRIPT_SIGNING_SECRET` + `TRANSCRIPT_SIGNING_KMS_KEY_REF` only — never
`JWT_SECRET` / board-export secrets. See `docs/audits/DATA_W1_DATA_08_COMPLETE.md`.

## Enrollment / grade audit completeness (W1-DATA-14)

`071_enrollment_grade_audit_completeness.sql` writes `enrollment_history` /
`grade_change_audit` from DB triggers and blocks UPDATE/DELETE. Residual
`080_enrollment_grade_audit_harden.sql` sets parent FKs to `ON DELETE RESTRICT`,
marks writers `SECURITY DEFINER` + fixed `search_path`, and re-asserts
`proctira_app` as **SELECT + INSERT only** on those audit tables.

Evidence: `docs/audits/DATA_W1_DATA_14_COMPLETE.md`.

## Migration session timeouts (W1-DATA-17)

DDL apply must not wait forever for locks. Both tracks set session GUCs before
running migrations:

| Applier       | Wrapper                                                                     | Defaults                            |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Raw `db/sql/` | `tools/scripts/apply-sql.sh` → `SET lock_timeout` / `SET statement_timeout` | `5s` / `30min`                      |
| Prisma        | `tools/scripts/prisma-migrate-deploy.sh` (via `prisma:migrate:deploy`)      | same (URL `options=` + `PGOPTIONS`) |

Override with `MIGRATION_LOCK_TIMEOUT` / `MIGRATION_STATEMENT_TIMEOUT` (or the
`APPLY_SQL_*` aliases). Raising `statement_timeout` is appropriate for large
`CREATE INDEX CONCURRENTLY` / `VALIDATE CONSTRAINT` windows; do **not** disable
`lock_timeout` in staging/production.

### Online-safe DDL patterns

Prefer these forms so production apply stays concurrent with app traffic:

| Prefer                                                               | Avoid (needs maintenance window)                       |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `CREATE INDEX CONCURRENTLY` (file cannot use `--single-transaction`) | `CREATE INDEX` on hot tables                           |
| `ADD CONSTRAINT … NOT VALID` then later `VALIDATE CONSTRAINT`        | Validating FK/CHECK in the same deploy as the add      |
| Nullable column add + backfill job + separate `SET NOT NULL`         | Instant `SET NOT NULL` / type rewrites on large tables |
| Forward revert migration                                             | Editing applied files (checksum ledger fail-closed)    |

`021b_tenant_fk_constraints.sql` + `068_validate_tenant_fk_constraints.sql` are
the reference NOT VALID → VALIDATE split. See
`docs/audits/DATA_W1_DATA_17_TIMEOUTS.md`,
`docs/audits/DATA_W1_DATA_17_COMPLETE.md`, and
`docs/runbooks/database-migration-rollback.md` §1 long-lock review.

### DDL hazard gate (W1-DATA-17 COMPLETE)

Post-baseline migrations (`db/sql` after `075_…`, Prisma dirs after
`20260914_w1_data_12_tenant_guc_canonical`) are scanned for long-lock DDL
(blocking indexes, validating constraints, `SET NOT NULL`, type rewrites).
Approved maintenance-window exceptions go in
`tools/scripts/migration-ddl-hazard-waiver.json`.

Executable gates:

```bash
pnpm check:migration-timeouts
DATABASE_URL=… node tools/scripts/migration-lock-recovery-drill.mjs
```

## Global control-ledger privileges (W1-DATA-11)

**COMPLETE** (see `docs/audits/DATA_W1_DATA_11_COMPLETE.md`).

`050_app_runtime_role.sql` bootstraps DML on tables present at apply time but
**does not** install TABLE `DEFAULT PRIVILEGES` for `proctira_app`. Authoritative
grants come from `db/runtime-table-privileges.json`, applied by
`084_runtime_privilege_classification.sql` and re-synced at the end of every
`apply-sql.sh` run.

| Class           | Runtime privileges             | Examples                                                    |
| --------------- | ------------------------------ | ----------------------------------------------------------- |
| `denied`        | none                           | `schema_migrations`, `_prisma_migrations` (`072`)           |
| `select_insert` | SELECT, INSERT                 | insights platform catalogs (`075`)                          |
| `append_only`   | SELECT, INSERT                 | fee/audit/transcript/enrollment ledgers (`053`/`069`/`071`) |
| `dml`           | SELECT, INSERT, UPDATE, DELETE | Tenant/domain tables under RLS                              |

Executable gate: `pnpm check:runtime-table-privileges` (CI job
`runtime-table-privileges`). New `CREATE TABLE` without a catalog entry fails CI.
| `schema_migration_phases` | Full (non-txn phase resume) | **None** — class `denied` via `088` |

Bootstrap role docs: `db/bootstrap/README.md`. Audits:
`docs/audits/DATA_W1_DATA_11_COMPLETE.md` (COMPLETE),
`docs/audits/DATA_W1_DATA_11_PRIVILEGES.md` (ledgers),
`docs/audits/DATA_W1_DATA_11_PRIVS.md` (platform catalogs residual).

## Domain SQL apply ledger (W1-DATA-05)

Numbered `db/sql/` apply is **not** whole-set atomic (Postgres cannot wrap every
DDL form across dozens of files in one safe transaction). Resume safety comes
from the `schema_migrations` ledger (and, for non-txn files, statement phases):

| Behavior       | Rule                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record         | After each successful file: `filename` + sha256 in `schema_migrations`                                                                                           |
| Skip           | Ledger checksum matches current file → do not re-apply                                                                                                           |
| Fail-closed    | Ledger checksum differs → exit non-zero (do not overwrite)                                                                                                       |
| Legacy NULL    | Pre-checksum self-insert rows get the current digest adopted; file is not re-applied                                                                             |
| Per-file TX    | Default `psql --single-transaction` for the file + ledger INSERT                                                                                                 |
| Non-txn phases | `CONCURRENTLY` / `APPLY_SQL_NO_TX=1` files apply statement-by-statement with `schema_migration_phases` so a mid-file failure resumes at the next unapplied phase |

**Multi-statement limits:** statements that cannot run inside a transaction
(`CREATE INDEX CONCURRENTLY`, `VACUUM`, some older `ALTER TYPE … ADD VALUE`
forms) are applied without `-1` when the file text contains `CONCURRENTLY`, or
for every file when `APPLY_SQL_NO_TX=1`. Non-txn phases **must** be written as
idempotent compensating-forward DDL (`IF NOT EXISTS`, `OR REPLACE`,
`ON CONFLICT`) so a crash between statement commit and phase-row insert can
re-run safely. Prefer keeping CONCURRENTLY work in small dedicated files.

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
- **W1-DATA-05:** ledger-safe resume via `schema_migrations` (skip match / fail mismatch / per-file TX); non-txn files use `schema_migration_phases`
- **W1-DATA-17:** sets `lock_timeout` + `statement_timeout` on every psql session
- Supports `--dry-run` to list files without applying

CI Integration Tests run step (2) immediately after `prisma:migrate:deploy`
(which itself goes through `prisma-migrate-deploy.sh` for the same timeouts).

## Outbox redrive (V10 defect 1a) — `101` / `102`

`transactional_outbox` was a one-way sink. `OutboxRelay.tick` calls
`markFailed(id, err)` without `availableAt` once `attempts >= maxAttempts`, which sets
`status='failed'`, and `claimPending` reads only `status='pending'`. No code path moved a
row back, so a permanently failed row was unrecoverable even though the domain write it
accompanied had committed.

| File                          | Contents                                                   | Transactional?        |
| ----------------------------- | ---------------------------------------------------------- | --------------------- |
| `101_outbox_redrive.sql`      | `redrive_history JSONB NOT NULL DEFAULT '[]'` + assertions | Yes                   |
| `102_outbox_failed_index.sql` | `transactional_outbox_failed_idx` built `CONCURRENTLY`     | **No** — CONCURRENTLY |

Split into two files because `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction. The first draft put a plain `CREATE INDEX` in `101` and **W1-DATA-17
rejected it**, which is the gate working as intended.

**Trap worth knowing.** `apply-sql.sh` `file_needs_no_tx()` greps the whole file text
for the `CONCURRENTLY` keyword, **comments included**. An early version of `101`
mentioned it in a prose comment, which silently stripped that file's per-file
transaction and split it into three phases. The outcome happened to be correct because
all three statements are idempotent, but the file's own header claimed it was
transactional. If a migration must be transactional, do not name the keyword anywhere in
it — not even in a comment.

`102` is a non-txn file, so every statement is idempotent compensating-forward DDL. It
opens by dropping a leftover **INVALID** index before rebuilding: an interrupted
`CONCURRENTLY` build leaves an invalid index that `IF NOT EXISTS` would then skip
forever, so the index would never become usable. That drop is deliberately **not**
`CONCURRENTLY` — Postgres rejects `DROP INDEX CONCURRENTLY` inside a `DO` block, which
the first version did and which failed on first live test. The closing assertion checks
`pg_index.indisvalid`, not just presence, because a present-but-invalid index is ignored
by the planner and a presence-only check would pass on a broken build.

No RLS change: `transactional_outbox`'s existing `tenant_isolation` policy already
admits the platform scope the store's redrive path runs under.

State transitions need no migration — `pending` and `failed` are both already in the
status CHECK, so requeue is an `UPDATE` inside the existing domain. `101` asserts that
remains true, so a future narrowing of the CHECK fails loudly instead of silently making
redrive impossible again.

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
