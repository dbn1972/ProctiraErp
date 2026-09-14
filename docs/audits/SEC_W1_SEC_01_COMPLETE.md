# Security — Tenant identity on authenticated routes (W1-SEC-01 COMPLETE)

**Module / slice:** `@proctira/tenant` + `apps/api-gateway` tenant binding  
**Branch / tip:** `cursor/w1-sec-01-tenant-id-complete-56c3` @ `7912ca2d133a8acbd370c9f4e2c618a74c06f34d`  
**Date (UTC):** 2026-09-14  
**Data classes:** tenancy / authorization scope (all tenant-scoped APIs)  
**Paired test audit:** unit — `tenant-resolution.test.ts`, `fastify-plugin.test.ts`, `tenant-context-trust.test.ts`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| Gateway protected `/api/v1/*` | Bearer JWT | Tenant GUC + RBAC | tenant-scoped | `tenantPlugin` after auth; `resolveSlugToId: false` |
| Shared `resolveTenantId` | N/A | identity resolution | tenancy | Used by gateway + other Fastify hosts |
| Service-router outbound `X-Tenant-ID` | Gateway-verified | Downstream hop | tenancy | Re-injects `request.tenantId` / JWT only (A4) |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Unauthenticated → 401 on protected routes | ☑ | Existing gateway auth `onRequest` |
| Client `X-Tenant-ID` stripped / not trusted when authenticated | ☑ | `app.ts` forgeable-header strip + resolution reject |
| Authenticated missing JWT `tenantId` → reject (no hostname fallthrough) | ☑ | `tenant-context-trust.test.ts` Host subdomain case |
| Authenticated invalid JWT tenant UUID → reject | ☑ | same · invalid UUID case |
| Conflicting JWT vs header UUID → reject | ☑ | `tenant-resolution.test.ts` + property/isolation tests |
| Authenticated subdomain without trusted slug→UUID → reject | ☑ | `fastify-plugin.test.ts` · gateway `resolveSlugToId: false` |
| Authenticated subdomain with trusted DB slug lookup → UUID | ☑ | `fastify-plugin.test.ts` lookup success |
| JWT vs host slug UUID conflict after lookup → reject | ☑ | `fastify-plugin.test.ts` conflict case |
| Anonymous header / subdomain resolution still works | ☑ | Existing unauthenticated plugin tests |
| No secrets in git | ☑ | Test secrets only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-01 residual | After A4 (strip client header), authenticated requests without JWT `tenantId` could still bind tenant from raw hostname slug while gateway had `resolveSlugToId: false` | Require verified UUID JWT claim for authenticated routes; allow subdomain only when trusted slug→UUID lookup succeeds; reject missing / invalid / conflicting identities |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P2 | Gateway does not wire a Prisma `tenant.findUnique` for slug lookup (`resolveSlugToId: false`) | Intentional: gateway relies on JWT UUID claims; deploy with slug lookup only where a trusted tenant directory is available |
| residual | P2 | Optional auth on public (`authExcludePaths`) paths still bind `request.user` without forcing tenant resolution (paths excluded from `tenantPlugin`) | By design for login/docs/health |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ (none open for this residual) |
| Safe to merge from security view | ☑ |
| W1-SEC-01 PARTIAL → COMPLETE | ☑ |

**Residual risks:** Slug→UUID on the gateway remains disabled without a tenant directory client; authenticated multi-tenant hosts must issue UUID `tenantId` claims. Non-gateway consumers must keep `requireJwtTenantWhenAuthenticated` (default) and enable trusted lookup before accepting host slugs for authenticated traffic.
