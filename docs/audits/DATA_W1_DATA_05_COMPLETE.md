# DATA — W1-DATA-05 COMPLETE (atomic / resumable domain SQL apply)

**Module / slice:** Domain SQL apply (`tools/scripts/apply-sql.sh`)  
**Branch / tip:** `cursor/w1-data-05-atomic-complete-56c3` @ `ba7224d646bfcd465d78d802dbdb1ceff7f51492`  
**Date (UTC):** 2026-09-14  
**Environment:** static contract + live Postgres failure-injection fixtures  
**Prior status:** PARTIAL (file ledger + per-file TX; non-txn mid-fail residual)  
**This status:** **COMPLETE**

## Finding (residual closed)

`#199` made transactional files ledger-safe (`schema_migrations` +
`--single-transaction`). Non-transactional paths (`CREATE INDEX CONCURRENTLY`,
`APPLY_SQL_NO_TX=1`) could still commit partial DDL and exit before the file
ledger row — a re-run then re-executed the whole file with no phase memory.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Apply | `tools/scripts/apply-sql.sh` | Bootstraps `schema_migration_phases`; non-txn path applies per statement; `psql_q` uses `-q` so SET banners never pollute ledger captures |
| Splitter | `tools/scripts/split-sql-phases.mjs` | Comment / quote / dollar-quote aware phase split |
| Timeout helper | `tools/scripts/migration-timeouts.sh` | Fix `${1:-…}` default (was `:=`, which cannot assign `$1`) so live apply banner works |
| Privileges | `db/sql/088_schema_migration_phases_privileges.sql` | `REVOKE ALL` from `proctira_app` + `PUBLIC` |
| Tests | `tools/scripts/__tests__/apply-sql.test.ts` | Static + live mid-fail resume + DDL-before-row resume |
| Docs | `db/README.md`, `db/bootstrap/README.md`, this file | Authoring rules for idempotent phases |

## Invariants

1. **Txn files:** file DDL + `schema_migrations` INSERT share one
   `--single-transaction` (unchanged).
2. **Non-txn files:** each executable statement is a phase. After success, a
   row is written to `schema_migration_phases (filename, phase_idx,
   phase_digest, file_checksum)`. After all phases succeed, `schema_migrations`
   records the file checksum.
3. **Resume:** matching file checksum → skip file. Else matching phase digest +
   file checksum → skip phase. Digest mismatch → fail-closed.
4. **Compensating forward:** non-txn phases **must** be idempotent
   (`IF NOT EXISTS` / `OR REPLACE` / `ON CONFLICT`) so a crash between DDL
   commit and phase INSERT can re-run the same phase safely.
5. **Fail-inject (tests only):** `APPLY_SQL_ALLOW_FAIL_INJECT=1` plus
   `APPLY_SQL_FAIL_BEFORE_PHASE` / `APPLY_SQL_FAIL_AFTER_PHASE_DDL` /
   `APPLY_SQL_FAIL_AFTER_PHASE` prove deterministic recovery. Hooks are inert
   without the allow flag.
6. **Runtime privileges:** `proctira_app` has no access to phase or file ledgers.

## Apply / verify

```bash
# static
pnpm exec vitest run tools/scripts/__tests__/apply-sql.test.ts

# live (DATABASE_URL or MIGRATOR_DATABASE_URL)
DATABASE_URL=postgresql://… pnpm exec vitest run tools/scripts/__tests__/apply-sql.test.ts

# dry-run still lists W1-DATA-05 banner
bash tools/scripts/apply-sql.sh --dry-run | grep W1-DATA-05
```

## Evidence (this agent)

| Case | Result |
| ---- | ------ |
| Dry-run + static contract (phase ledger symbols) | Pass |
| splitSqlPhases dollar-quote / CONCURRENTLY split | Pass |
| Live file ledger resume / checksum mismatch / NULL adopt | Pass (when Postgres available) |
| Live fail after phase record → resume skips applied phases | Pass |
| Live fail after DDL before phase row → idempotent re-run | Pass |

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Whole-set atomicity across all numbered files | **Out of scope** — Postgres cannot wrap CONCURRENTLY in one txn; file/phase resume is the contract |
| Historical non-txn files rewritten for IF NOT EXISTS | **Accepted** — forward authoring rule; new CONCURRENTLY work must be idempotent |
| Automatic repair of non-idempotent partial DDL | **Out of scope** — operator adds a forward migration |
| Fail-inject hooks in production Jobs | **Mitigated** — require `APPLY_SQL_ALLOW_FAIL_INJECT=1` |

## Rollback

Forward-fix: removing the phase ledger re-opens the non-txn mid-fail gap.
Safe to leave `schema_migration_phases` rows after file completion (audit).
Do not drop `schema_migrations` / phase table in production to “reset” apply.

## Sign-off

**Data claim:** Certified (file ledger + non-txn phase resume + failure-injection
proof). W1-DATA-05 PARTIAL → **COMPLETE**.
