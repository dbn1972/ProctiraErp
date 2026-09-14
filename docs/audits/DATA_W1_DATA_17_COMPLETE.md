# DATA — W1-DATA-17 COMPLETE (online DDL hazard + lock recovery)

**Module / slice:** Migration apply path (Prisma + `db/sql`) — PARTIAL→COMPLETE  
**Branch / tip:** `cursor/w1-data-17-online-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static DDL hazard gate + live lock-contention recovery drill (Postgres)

Copy of checklist gate: `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`.  
Prior wave: `docs/audits/DATA_W1_DATA_17_TIMEOUTS.md` (session `lock_timeout` /
`statement_timeout` wrappers).

---

## Finding (residual closed)

Timeouts existed and CI checked **wrappers**, but:

1. CI did **not** scan new migration DDL for long-lock / expand-contract hazards.
2. Retry / resume after `lock_timeout` failure was **unproven**.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Gate (extended) | `tools/scripts/check-migration-timeouts.mjs` | Wrappers **plus** post-baseline DDL hazard scan |
| Waiver | `tools/scripts/migration-ddl-hazard-waiver.json` | Baseline cutover + maintenance-window waivers |
| Recovery drill | `tools/scripts/migration-lock-recovery-drill.mjs` | ACCESS EXCLUSIVE → fail → unlock → resume |
| Tests | `check-migration-timeouts.test.mjs`, `migration-lock-recovery-drill.test.mjs` | Unit + live |
| apply-sql | `tools/scripts/apply-sql.sh` | Explicit lock-failure resume guidance |
| CI | `.github/workflows/ci.yml` job `migration-timeouts` | Gate + drill (Postgres service) |
| Docs | this file, `db/README.md`, timeouts audit residuals | COMPLETE sign-off |

## Invariants

1. Every **new** migration after baseline cutover is checked for expand/contract
   safety:
   - `CREATE INDEX` without `CONCURRENTLY` on an **existing** table → fail
   - `ADD CONSTRAINT` FK/CHECK without `NOT VALID` on existing table → fail
   - `ADD CONSTRAINT` UNIQUE/PK/EXCLUDE on existing table → fail
   - `SET NOT NULL` / `ALTER COLUMN … TYPE` on existing table → fail
   - Indexes/constraints on tables **created in the same file** are expand-safe
2. Approved exceptions require a waiver entry with `path`, `hazards[]`,
   `reason`, and `maintenanceWindow` (optional `expires` / `approvedBy`).
3. Baseline grandfathering: `db/sql` ≤ `075_runtime_global_table_privileges.sql`
   and Prisma dirs ≤ `20260914_w1_data_12_tenant_guc_canonical` (forward policy
   for historical files — unchanged from timeouts audit).
4. Lock-contention recovery: a failed apply due to `lock_timeout` must **not**
   record `schema_migrations`; re-run after unlock applies the same file
   (proven by drill).

## Apply / verify

```bash
# static
pnpm check:migration-timeouts:test
pnpm check:migration-timeouts

# lock recovery unit + live (needs DATABASE_URL)
node --test tools/scripts/migration-lock-recovery-drill.test.mjs
DATABASE_URL="$DATABASE_URL" node tools/scripts/migration-lock-recovery-drill.mjs
```

### Live drill evidence (agent)

```text
W1-DATA-17 lock recovery drill: PASS — lock_timeout failed closed without ledger write; resume after unlock applied file
```

Also fixed apply-path bugs found by the drill:

- `migration-timeouts.sh` `emit_migration_timeout_banner` used `${1:=…}` (illegal assign to `$1`); now `${1:-…}`.
- `apply-sql.sh` ledger status query now uses `-q` so W1-DATA-17 `SET` tags cannot pollute the checksum status string.

## Waiver how-to

Append to `tools/scripts/migration-ddl-hazard-waiver.json`:

```json
{
  "path": "db/sql/076_example.sql",
  "hazards": ["blocking_index"],
  "reason": "hot-path rewrite rehearsed; window booked",
  "maintenanceWindow": "2026-09-20T02:00Z",
  "approvedBy": "platform-oncall",
  "expires": "2026-12-31"
}
```

Hazard kinds: `blocking_index`, `validating_constraint`, `blocking_unique_or_pk`,
`set_not_null`, `column_type_rewrite`. Use `"*"` only for emergency full-file
waivers (still requires `maintenanceWindow`).

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Historical files below baseline not rewritten to CONCURRENTLY / NOT VALID | **Accepted** — forward policy; same as timeouts audit |
| Automatic in-script retry loop on `lock_not_available` | **Accepted** — operator / Job re-run; drill proves resume |
| Gate is static SQL text analysis (not live `pg_locks`) | **Accepted** — matches W1-DATA-04/06/16 posture |
| Prisma engine URL `options=` honor | **Mitigated** in timeouts wave via wrapper injection |
| Cluster-wide `postgresql.conf` timeouts | **Out of scope** — session-only |

## Rollback

Forward-fix: removing the hazard scan / drill re-opens PARTIAL. Safe to add
waivers without code changes. Do not delete this audit or CI drill without a
replacement proof.

## Sign-off

**Data claim:** Certified (static expand/contract gate + live lock-contention
recovery drill). **PARTIAL→COMPLETE.**

**Waivers:** Empty at cutover (no post-baseline long-lock DDL).
