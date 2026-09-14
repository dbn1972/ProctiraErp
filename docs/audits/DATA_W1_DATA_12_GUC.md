# DATA — W1-DATA-12 tenant GUC canonicalization

**Module / slice:** Postgres RLS session GUC (`app.tenant_id`)  
**Branch / tip:** `cursor/aud-w1-data-12-guc-56c3` (`364763cd1c8eb38f88ddb0736cd2d1ab15fc895a`)  
**Date (UTC):** 2026-09-14  
**Environment:** static contract (+ optional live Postgres via apply-sql)

## Finding

RLS policies depended on **two** tenant GUC names (`app.tenant_id` for raw SQL,
`app.current_tenant_id` for early Prisma). Callers that bound only one name
silently failed the other policy set.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Canonical binder | `packages/shared/database/src/tenant-guc.ts` | `bindTenantGuc` / `bindTenantGucPrisma` — one statement, both names |
| Helpers | `pg-tenant.ts`, `tenant-transaction.ts`, `pg-document-store.ts` | Route through binder |
| Call sites | tenant Fastify plugin, provisioning, testing `setTenantContext`, outbox enqueue | No single-name binds |
| SQL | `db/sql/071_tenant_guc_canonical.sql` | `app_tenant_id()` + `set_app_tenant_id` + policy rewrite |
| Prisma mirror | `…/20260914_w1_data_12_tenant_guc_canonical` | Same DDL for migrate-deploy path |
| Tests | `tenant-guc.test.ts`, `pg-tenant.test.ts`, `tenant-guc-canonical.test.ts` | Unit + static SQL contract |
| Docs | this file + `db/README.md` | Operator / caller contract |

## Invariants

1. **Canonical GUC** is `app.tenant_id`. New policies must not introduce a third name.
2. **Sanctioned binders** always set canonical and sync legacy `app.current_tenant_id`.
3. **`app_tenant_id()`** returns `COALESCE(canonical, legacy)` so residual single-name binds still isolate correctly after 071.
4. Tenant ids are **never** string-interpolated into `set_config` (G-720).

## Apply / verify

```bash
# static
pnpm --filter @proctira/database exec vitest run src/tenant-guc.test.ts src/pg-tenant.test.ts
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/tenant-guc-canonical.test.ts
pnpm --filter @proctira/tenant exec vitest run src/fastify-plugin.test.ts src/provisioning.test.ts

# live (optional): apply numbered SQL then spot-check
# SELECT set_app_tenant_id('<uuid>');
# SELECT app_tenant_id();
# SELECT current_setting('app.tenant_id', true), current_setting('app.current_tenant_id', true);
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Historical Prisma migration files still *author* `app.current_tenant_id` | **Accepted** — forward 071 / Prisma mirror rewrites live policies; do not rewrite frozen migrations |
| Seeds / scripts that only `set_config('app.tenant_id', …)` without alias | **Mitigated** by `app_tenant_id()` policy rewrite after 071; prefer `set_app_tenant_id` going forward |
| Dropping legacy GUC entirely | **Out of scope** — alias retained until a later cleanup wave |

## Rollback

Forward-fix: keep `app_tenant_id` / `set_app_tenant_id`. Reverting the TS binder
without 071 leaves dual-name policies fragile again — roll binder + SQL together.

## Sign-off

**Data claim:** Certified w/ waivers (legacy alias retained; frozen migrations unchanged).
