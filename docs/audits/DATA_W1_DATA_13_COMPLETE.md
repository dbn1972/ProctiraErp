# DATA — W1-DATA-13 COMPLETE (monorepo query-helper bypass gate)

**Module / slice:** Raw-`pg` tenant GUC binding — monorepo fail-closed AST gate  
**Branch / tip:** `cursor/w1-data-13-bypass-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Prior:** PARTIAL via `#234` / `#240` (`docs/audits/DATA_W1_DATA_13_QUERY_HELPER.md`)  
**Environment:** static AST (unit) + live Postgres cross-tenant denial (integration, `DATABASE_URL`)

Copy of checklist gate: `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`.

---

## Finding (PARTIAL → COMPLETE)

**PARTIAL residual:** the static guard only named four repositories
(LMS modules, registration lookups, enrollment history, ETL execution update).

**COMPLETE when:**

1. An **AST / type-level gate** rejects direct tenant-data `pool.query` /
   `this.pool.query` outside a **fail-closed allowlist** of approved helpers
   (and non-tenant exceptions: DDL ensure, health probes, platform catalog).
2. **Live cross-tenant denial** is backed (withPgTenant isolates; unbound
   `pool.query` returns zero rows under FORCE RLS).

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Monorepo AST gate | `tools/tenant-isolation-tests/src/unit/query-helper-bypass.test.ts` | Walks `packages/backend`, `packages/shared`, `apps/api-gateway`; classifies every `pool.query` |
| Live denial | `tools/tenant-isolation-tests/src/integration/query-helper-bypass.live.test.ts` | hostels + `lms_modules`; skipIf no `DATABASE_URL` |
| Prior residual fixes | (already on main) | Four cited repos remain method-asserted |
| Docs | this file | Evidence pack |

### Fail-closed allowlist

| Class | Allowed when |
| ----- | ------------ |
| `approved-helper` | File is `pg-tenant.ts` / `pg-document-store.ts` / `tenant-guc.ts` / `tenant-transaction.ts` |
| `guc-binder` | Outbox `withPlatformClient` `set_config` fallback only |
| `ddl-ensure` | Enclosing fn matches `ensureSchema` / `ensure*Schema` / `ensure*Seed` |
| `health-probe` | SQL is `SELECT 1 …` |
| `platform-catalog` | SQL touches only `insights_ui_templates` / `indicators` / `geo_features` (no `tenant_id`) |

Any other `pool.query` is a **violation**.

## Invariants

1. Tenant-data reads/writes use `client.query` inside `withPgTenant` /
   `withPlatformScope` (or a thin `withTenant` wrapper that calls them).
2. Direct `pool.query` against RLS tables is forbidden outside DDL ensure.
3. Unbound `pool.query` against FORCE-RLS tables returns **zero rows** (live).
4. Callers that omit `tenantId` where Postgres requires it **fail closed**
   (registration / ETL — retained from PARTIAL).

## Apply / verify

```bash
# Static AST + cited-method regression
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/query-helper-bypass.test.ts

# Live cross-tenant denial (CI tenant-isolation job sets DATABASE_URL)
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/integration/query-helper-bypass.live.test.ts
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| `ensure*Schema` / seed still uses unbound `pool.query` for DDL | **Accepted** — schema apply is not tenant data; gated by fn-name class |
| Platform insights catalog (no `tenant_id`) uses `pool.query` | **Accepted** — allowlisted tables only; tenant runs/jobs use `withPgTenant` |
| Outbox local `withPlatformClient` duplicates `withPlatformScope` for `set_config` | **Accepted** — binder allowlist; full merge into shared helper is later cleanup |
| TypeScript branded `TenantClient` types across every repo | **Out of scope** — AST gate is the enforcement; branded types optional follow-up |
| Prisma path uses `withTenantTransaction` (not `pool.query`) | **N/A** — separate binder; not in this `pool.query` gate |

## Rollback

Revert the expanded static gate + live test + this audit. No SQL migrations.
Prior four-repo remediations on main stay in place.

## Sign-off

**Data claim:** Certified w/ waivers (DDL ensure + platform catalog + outbox binder retained).  
**Remediation status:** `COMPLETE` (PARTIAL four-site guard → monorepo fail-closed AST + live denial).
