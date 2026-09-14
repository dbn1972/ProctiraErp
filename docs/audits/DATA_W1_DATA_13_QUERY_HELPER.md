# DATA — W1-DATA-13 query-helper bypass residual

**Module / slice:** Raw-`pg` tenant GUC binding (`withPgTenant` / `withPlatformScope`)  
**Branch / tip:** `cursor/aud-w1-data-13-query-helper-56c3`  
**Date (UTC):** 2026-09-14  
**Merged:** `#234` → `f01ad3b1` on `origin/main`  
**Environment:** static contract + unit (deny-missing-tenant)

## Finding

Audit disposition was **refuted** for the claim that four cited sites established
*tenant-owned query-helper bypasses* in the G-710 private `query(tenantId, …)`
helpers (those helpers already wrap `withPgTenant`).

Revalidation against tip still found **four residual unbound `pool.query`
domains** that never set `app.tenant_id` / platform GUC before touching RLS
tables (closed in `#234`; tip re-verified):

| # | Site | Path | Defect |
| - | ---- | ---- | ------ |
| 1 | LMS modules | `packages/backend/lms/src/pg-lms-repository.ts` | `createModule` / `findModule` / `listModules` / `createModuleItem` / `listModuleItems` called `this.pool.query` outside `withTenant` |
| 2 | Registration lookups | `packages/backend/registration/src/pg-registration-repository.ts` | `findByTrackingNumber` / `findById` fell back to unbound `pool.query` when `tenantId` omitted |
| 3 | Enrollment history | `packages/backend/student/src/enrollment/pg-enrollment-repository.ts` | `getHistoryByEnrollmentId` discovered `tenant_id` via unbound `pool.query` |
| 4 | ETL execution update | `packages/backend/etl/src/pg-pipeline-repository.ts` | `updateExecution` loaded the run via unbound `pool.query` |

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| LMS | `pg-lms-repository.ts` | Module APIs route through `withTenant` → `withPgTenant` |
| Registration | `pg-registration-repository.ts` | Deny missing `tenantId`; always `withTenant` |
| Enrollment | `pg-enrollment-repository.ts` | Discover via `withPlatformScope`, history via `withPgTenant` |
| ETL | `pg-pipeline-repository.ts` (+ in-memory) | Deny missing `updates.tenantId`; single tenant-scoped TX |
| Static gate | `tools/tenant-isolation-tests/src/unit/query-helper-bypass.test.ts` | Cites the four paths; rejects residual `pool.query` in methods |
| Unit | registration / etl / enrollment test files | Deny-missing-tenant + mock GUC binding |
| Docs | this file | Evidence pack |

## Invariants

1. Data-plane `pool.query` against RLS tables is forbidden outside `ensureSchema` DDL.
2. Tenant-scoped reads/writes bind `app.tenant_id` via `withPgTenant` (or a class `withTenant` wrapper).
3. Cross-tenant *discovery* (enrollment id → tenant id) uses `withPlatformScope` so a GUC is still set — never a naked pool query.
4. Callers that omit `tenantId` where the Postgres store requires it **fail closed**.

## Apply / verify

```bash
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/query-helper-bypass.test.ts

pnpm --filter @proctira/backend-registration exec vitest run \
  src/pg-registration-repository.test.ts

pnpm --filter @proctira/backend-etl exec vitest run \
  src/pg-pipeline-repository.test.ts

pnpm --filter @proctira/backend-student exec vitest run \
  src/enrollment/pg-enrollment-query-helper.test.ts
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| `ensureSchema` / DDL still uses unbound `pool.query` | **Accepted** — schema apply is not tenant data |
| Registration / ETL interfaces keep optional `tenantId?` for in-memory callers | **Accepted** — Postgres store denies empty; interface widen is a later cleanup |
| `getHistoryByEnrollmentId` still discovers tenant via platform scope instead of requiring `tenantId` on the API | **Accepted** — callers lack tenant today; platform GUC is set |
| Broader monorepo sweep of every `pool.query` outside these four sites | **Out of scope** — static gate covers the cited residuals |
| Static method extractor previously treated object-type params as the body | **Fixed** — paren-balance before body `{` so `listModules(filter: {…})` is covered |

## Rollback

Revert the four repository patches + tests + this audit. No SQL migrations.

## Sign-off

**Data claim:** Certified w/ waivers (DDL ensure + optional interface types retained).  
**Remediation status:** `merged` (`#234`); tip re-verify confirms the four sites remain tenant-bound.
