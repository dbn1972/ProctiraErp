# DATA — W1-DATA-16 leading tenant_id indexes

**Module / slice:** Multi-tenant SQL index invariant  
**Branch / tip:** `cursor/aud-w1-data-16-tenant-indexes-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL corpus gate (no Postgres required)

## Finding

No invariant ensured every tenant-scoped table had an **appropriate leading
`tenant_id` index**. RLS policies and service filters almost always predicate on
`tenant_id` first. A composite such as `(collection, tenant_id)` or an index that
omits `tenant_id` entirely does not satisfy tenant-scoped access paths.

Corpus scan before remediation found **2** residuals among ~225 tenant-scoped
tables:

| Table | Prior index posture | Gap |
| ----- | ------------------- | --- |
| `report_schedules` | `(enabled, next_run_at)` only | No `tenant_id` column in any index |
| `control_plane_documents` | `(collection, tenant_id)` | `tenant_id` not leading |

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Gate | `tools/scripts/check-tenant-id-indexes.mjs` | Static fail-closed scan of `db/sql/` + Prisma migration SQL |
| Allowlist | `tools/scripts/tenant-id-index-allowlist.json` | Empty by default; each entry requires `table` + `reason` |
| Tests | `tools/scripts/check-tenant-id-indexes.test.mjs` | Unit + repo smoke |
| Additive SQL | `db/sql/071_tenant_id_leading_indexes.sql` | Leading indexes for the two residuals |
| CI | `.github/workflows/ci.yml` job `tenant-id-indexes` | Always-on; wired into `ci-aggregate` |
| Aggregate | `tools/scripts/ci-aggregate-gate.mjs` | Skip fails closed (same posture as W1-DATA-04/06) |
| Docs | `db/README.md`, `tools/scripts/README.md` | Operator + script index |

## Invariants

1. Every `CREATE TABLE` / `ADD COLUMN tenant_id` in numbered SQL or Prisma
   migrations must have leading `tenant_id` coverage via:
   - `CREATE INDEX … ON t (tenant_id[, …])`, or
   - `UNIQUE` / `PRIMARY KEY (tenant_id[, …])`, or
   - dynamic `FOREACH … ARRAY[…]` index loops that create `(tenant_id)` indexes
     (e.g. wave-7 integrity).
2. Non-leading composites that merely *include* `tenant_id` **do not** satisfy
   the gate.
3. Exceptions must be listed in `tenant-id-index-allowlist.json` with a
   non-empty `reason` (stale allowlist entries that already have coverage are
   noted, not silent).

## Apply / verify

```bash
# static (CI)
pnpm check:tenant-id-indexes:test
pnpm check:tenant-id-indexes

# live Postgres (optional) — after apply-sql.sh
psql "$DATABASE_URL" -c "\d report_schedules"
psql "$DATABASE_URL" -c "\d control_plane_documents"
```

## Allowlist

Current allowlist: **empty** (no exemptions).

To add an exemption, append:

```json
{ "table": "example_table", "reason": "why a leading tenant_id index is wrong here" }
```

Do not use the allowlist for “we forgot an index” — add additive SQL instead.

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Gate is static SQL text analysis, not `pg_indexes` on a live catalog | **Accepted** — matches W1-DATA-04/06 posture; live drift still caught when SQL is the source of truth |
| Existing non-leading indexes (e.g. `(collection, tenant_id)`) are retained | **By design** — additive leading indexes; no drop of hot-path composites |
| Query-plan proof that every tenant filter uses the new indexes | **Out of scope** for this gate |
| Prisma `@@index([tenantId, …])` without matching SQL | Covered only if Prisma migration SQL (or `db/sql`) materializes the index |

## Rollback

Forward-fix only: dropping the new indexes is safe but re-opens the CI gate.
Do not remove `071_tenant_id_leading_indexes.sql` from the apply ledger without
replacing coverage elsewhere.

## Sign-off

**Data claim:** Certified (static invariant + additive SQL for known residuals).
