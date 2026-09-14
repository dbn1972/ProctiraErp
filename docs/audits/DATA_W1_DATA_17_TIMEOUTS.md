# DATA — W1-DATA-17 migration lock / statement timeouts

**Module / slice:** Migration apply path (Prisma + `db/sql`)  
**Branch / tip:** `cursor/aud-w1-data-17-migration-timeouts-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static contract (+ optional live Postgres via apply-sql)

## Finding

Migration DDL lacked session **`lock_timeout`** / **`statement_timeout`** and
documented online-rollout behavior. Without a short lock wait bound, an
`ACCESS EXCLUSIVE` DDL statement can sit behind a long transaction and form a
lock queue that stalls the application. Medium severity, confirmed.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Shared defaults | `tools/scripts/migration-timeouts.sh` | `5s` lock / `30min` statement; URL + PGOPTIONS helpers |
| Raw apply | `tools/scripts/apply-sql.sh` | Every `psql` session `SET`s both timeouts before DDL |
| Prisma apply | `tools/scripts/prisma-migrate-deploy.sh` | Wired as `prisma:migrate:deploy` |
| Gate | `tools/scripts/check-migration-timeouts.mjs` | Fail-closed static contract |
| Tests | `check-migration-timeouts.test.mjs`, `apply-sql.test.ts` | Unit + dry-run banner |
| CI | `.github/workflows/ci.yml` job `migration-timeouts` | Always-on; `ci-aggregate` fail-closed on skip |
| Docs | `db/README.md`, runbook §1, this file | Online-safe patterns |

## Invariants

1. **Every** sanctioned DDL apply path sets both `lock_timeout` and
   `statement_timeout` (defaults `5s` / `30min`).
2. Overrides use `MIGRATION_*` or `APPLY_SQL_*` env vars — never silent disable
   in staging/production.
3. Online-safe DDL is the default authoring posture:
   - Prefer `CREATE INDEX CONCURRENTLY` (outside a single transaction).
   - Prefer `ADD CONSTRAINT … NOT VALID` then a later `VALIDATE CONSTRAINT`.
   - Avoid table rewrites / instant `SET NOT NULL` on hot large tables without
     a maintenance window (runbook long-lock review).
4. CI gate `pnpm check:migration-timeouts` fails if wrappers regress to bare
   `prisma migrate deploy` or drop the `SET` preamble.

## Apply / verify

```bash
# static (CI)
pnpm check:migration-timeouts:test
pnpm check:migration-timeouts

# dry-run shows timeout banner
bash tools/scripts/apply-sql.sh --dry-run | grep W1-DATA-17

# live (optional): confirm session GUCs during apply
# psql "$DATABASE_URL" -c "SHOW lock_timeout; SHOW statement_timeout;"
```

## Online-safe patterns (operator checklist)

| Change | Online-safe approach |
| ------ | -------------------- |
| New index on hot table | `CREATE INDEX CONCURRENTLY` in its own numbered file (`APPLY_SQL_NO_TX` / auto no-tx) |
| New FK / CHECK | `NOT VALID` in deploy N; `VALIDATE CONSTRAINT` in deploy N+k |
| New column | nullable add → backfill → separate not-null migration |
| Lock wait storm | keep `lock_timeout` low; retry the Job — do not raise to minutes |

Reference split already in-tree: `021b_tenant_fk_constraints.sql` →
`068_validate_tenant_fk_constraints.sql`.

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| No automatic retry loop inside apply-sql on `lock_not_available` | **Accepted** — K8s Job / operator re-runs; resume proven by COMPLETE drill |
| Historical Prisma / `db/sql` files are not rewritten to add CONCURRENTLY | **Accepted** — forward policy; long-lock review still required for new DDL |
| Gate does not AST-scan every migration for unsafe DDL | **CLOSED** — see `DATA_W1_DATA_17_COMPLETE.md` (post-baseline DDL hazard scan + waiver) |
| Retry/resume after lock failure unproven | **CLOSED** — `migration-lock-recovery-drill.mjs` |
| Prisma engine must honor URL `options=` (not only PGOPTIONS) | **Mitigated** by `inject_migration_timeout_url` in the wrapper |
| Global `postgresql.conf` timeouts | **Out of scope** — session-only; do not set cluster-wide |

## Follow-up (COMPLETE)

`docs/audits/DATA_W1_DATA_17_COMPLETE.md` closes the PARTIAL residual with:

- DDL hazard scanner for post-baseline migrations
- `tools/scripts/migration-ddl-hazard-waiver.json` maintenance-window waivers
- Live lock-contention recovery drill

## Rollback

Forward-fix: removing the wrappers re-opens the finding. Safe to tune timeout
values via env without code changes. Do not delete the audit doc or CI job
without a replacement gate.

## Sign-off

**Data claim:** Certified (static invariant + documented online-safe patterns;
no live lock-storm proof in this PR).
