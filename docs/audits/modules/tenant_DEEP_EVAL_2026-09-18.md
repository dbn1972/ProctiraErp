# Deep evaluation — `tenant`

| Field        | Value                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| Audited SHA  | `0f463640c8fbee6331bf622402f4ae70bdba2b1b`                                           |
| Date         | 2026-09-18                                                                           |
| Evidence DB  | PostgreSQL 16, 113 domain SQL files, `APPLY_STRICT_FKS=1`                            |
| Runtime role | `proctira_app` — NOSUPERUSER, NOBYPASSRLS (verified)                                 |
| Mount status | Mounted — `tenantLifecyclePlugin` at `/api/v1/tenant-lifecycle`, `tenantAdminPlugin` |
| Source       | 19 files, 10 unit tests, **0 live tests**                                            |
| Disposition  | **PARTIAL**                                                                          |

## Headline

Tenant state is split across **three** representations with no synchronisation
between them, and the runtime suspend gate consults none of the durable ones. The
practical consequence is that **suspending a tenant does not take effect**, and
does not survive a restart.

## Step 1 — Real surface

All six collections the module persists to are logical `collection` keys inside
`control_plane_documents`, not relations. Verified with `to_regclass`:

| Name              | Resolves to |
| ----------------- | ----------- |
| `tenant.tenants`  | logical key |
| `tenant.roles`    | logical key |
| `tenant.users`    | logical key |
| `tenant.domains`  | logical key |
| `tenant.settings` | logical key |
| `tenant.usage`    | logical key |

**Contradiction: yes.** `mount-matrix.ts` records `persistence: 'mixed'`, which is
defensible, but the note implies `/tenants` ownership sits with platform-admin-ui
while this module owns lifecycle. The split is real and under-documented.

## Step 2 — Three sources of truth

| #   | Representation                                                                       | Written by                                                             | Read by                                                         | Live row count |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- | -------------- |
| 1   | `tenants` table (`id, name, slug, config, status, timezone, legal_hold, deleted_at`) | `packages/shared/tenant/src/provisioning.ts:120` `INSERT INTO tenants` | tenant-resolution plugin; **211 uuid FK columns reference it**  | **3**          |
| 2   | `tenant.tenants` documents                                                           | `pg-tenant-repository.ts` via `PgDocumentCollection`                   | `/api/v1/tenant-lifecycle` (suspend, restore, delete, branding) | **0**          |
| 3   | In-process `Set<string>`                                                             | `TENANT_SUSPENDED_IDS` env at boot; `suspendTenantForTests()`          | the actual suspend gate                                         | n/a            |

There is **no sync path** between 1 and 2. Grepping `provisioning.ts` for
`PgDocumentCollection`, `control_plane_documents` or `tenant.tenants` returns
nothing. Empirically the real table holds 3 tenants and the document collection
holds 0 on a freshly provisioned database.

## Step 3 — Five dimensions

### 1. UX design — `unverified`

Not assessed; no screens opened. Admin console consumes
`/tenant/{roles,permissions,users,settings}` via `tenantAdminPlugin`.

### 2. Functionality — `partial`, **P0**

`tenantLifecyclePlugin` is mounted at `/api/v1/tenant-lifecycle`
(`app.ts:754`) against repository #2, which is empty for any tenant created
through the real provisioning path. Lifecycle operations therefore cannot find
tenants that exist.

Worse, the gate that enforces suspension reads neither #1 nor #2:

```ts
// apps/api-gateway/src/tenant-entitlement.ts:30
export function isRequestTenantSuspended(tenantId, user) {
  if (user?.tenantStatus === 'suspended') return true; // JWT claim
  if (tenantId && isTenantSuspended(tenantId)) return true; // in-process Set
  return false;
}
```

`suspendedTenantIds` is a module-level `new Set<string>()` seeded only from the
`TENANT_SUSPENDED_IDS` environment variable at import time
(`tenant-entitlement.ts:9-18`). Consequences:

- Suspending via the API writes documents that the gate never reads.
- The `tenants.status` column, the authoritative field, is never consulted.
- The Set is process-local: on a multi-replica deployment one replica may treat a
  tenant as suspended while others do not.
- The Set is not durable: a restart clears everything not in the env var.
- The JWT path only works until the claim is stale, and cannot suspend an already
  issued token before expiry.

The module's own header is candid — "Tracks suspended tenant IDs in-memory" — so
this is a known shortcut rather than a hidden defect. It is still a P0, because
tenant suspension is the control that stops a non-paying or compromised tenant
from mutating data.

### 3. Integrity — `partial`, P1

Inherits every `control_plane_documents` property: `tenant_id` nullable `text`, no
foreign keys, unconstrained JSONB, PK on `(collection, id)` only. Covered by the
allowlist added in the W1-DATA-06 gate fix, so the debt is now tracked.

Additional to this module: because representation 1 and 2 are independent, tenant
name, slug, status and branding can diverge with no reconciliation and no
detection.

### 4. Security — `partial`, P1

Same platform finding as `auth` — `PgDocumentCollection` binds
`app.platform_admin='1'` on every call, so RLS is bypassed and isolation rests on
application controls. Those controls are present and correct in this module:
`findRoleById` and `findUserById` both return null unless
`doc.tenantId === tenantId`, and `deleteRole`/`updateRole` gate on that check.
Keys are tenant-prefixed (`${tenantId}::${roleId}`).

So no present leak, but no backstop. See the `auth` report for the platform-level
recommendation.

### 5. Production — `partial`

Runs with `DATABASE_URL` set. `destructiveDeleteGuard` correctly wires
`PrivacyService` so a tenant under legal hold cannot be destructively deleted
(W1-SEC-06). No SLOs, alerts or runbook located. 0 live tests.

## Step 5 — Gap matrix

| Capability                                | Current evidence                                                                                                               | Evidence status | Contradiction | Expected enterprise state                                                | Gap                                                         | Impact                                                                                          | Recommendation                                                                                 | Priority | Effort | Confidence |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | ------ | ---------- |
| Tenant suspension takes effect            | `tenant-entitlement.ts:9-37` in-process Set + JWT claim; `tenants.status` never read                                           | partial         | no            | Suspension is durable, shared, and derived from the authoritative record | Gate reads neither the tenants table nor the document store | A suspended tenant keeps mutating after a restart, or on any replica that never saw the env var | Read `tenants.status` (cached with invalidation), or a shared store; delete the env-seeded Set | **P0**   | M      | High       |
| Lifecycle operates on real tenants        | `/api/v1/tenant-lifecycle` bound to document repo; live counts 3 table rows vs 0 documents                                     | partial         | no            | Lifecycle acts on the provisioned tenant                                 | Two unsynchronised stores                                   | Suspend/restore/branding cannot find tenants that exist                                         | Point lifecycle at the `tenants` table, or have provisioning write both in one transaction     | **P0**   | M      | High       |
| Single source of truth for tenant         | `provisioning.ts:120` writes table; `pg-tenant-repository.ts` writes documents; platform-admin-ui owns `/tenants` as `ui-seed` | partial         | no            | One authoritative record                                                 | Three representations, no reconciliation                    | Name/slug/status/branding drift silently                                                        | Designate the table authoritative; make others projections with a rebuild path                 | **P0**   | L      | High       |
| Referential integrity of tenant documents | `control_plane_documents.tenant_id` nullable text, 0 FKs                                                                       | partial         | no            | FK to `tenants(id)`                                                      | Type prevents an FK                                         | Orphan rows referencing deleted tenants                                                         | Migrate to uuid + validated FK; tracked in the new allowlist                                   | P1       | M      | High       |
| RLS backstop                              | `pg-document-store.ts:40` binds platform_admin; app checks present at all call sites                                           | partial         | no            | RLS enforces isolation independently                                     | No enforcement below application layer                      | Latent regression surface                                                                       | Platform fix, see `auth` report                                                                | P1       | M      | High       |
| Live verification                         | 10 unit tests, 0 `.live.test.ts`                                                                                               | absent          | no            | Lifecycle and isolation proven against migrated PG                       | No live proof                                               | Regressions reach production undetected                                                         | Add live suites for suspend, restore, legal-hold delete, role scoping                          | P1       | M      | High       |
| Operability                               | No SLO/alert/runbook found                                                                                                     | absent          | no            | Documented                                                               | Missing                                                     | Slow response on a control-plane module                                                         | Add runbook                                                                                    | P2       | S      | Medium     |
| UX / accessibility                        | Not opened                                                                                                                     | unverified      | no            | Reviewed                                                                 | Not assessed                                                | Unknown                                                                                         | Run UX + a11y checklists                                                                       | P2       | M      | Low        |

## Step 6 — Acceptance criteria

**P0-1 — Suspension is durable and shared.** Set `tenants.status='suspended'`
directly in the database, then a mutating `POST /api/v1/...` returns 403
`TENANT_SUSPENDED` without restarting the process and without the tenant appearing
in `TENANT_SUSPENDED_IDS`. Restarting the gateway preserves the behaviour.

**P0-2 — Lifecycle acts on provisioned tenants.** After creating a tenant through
`provisioning.ts`, `GET /api/v1/tenant-lifecycle/<id>` returns it and suspend
changes `tenants.status`.

**P0-3 — One authoritative record.** A documented decision naming the `tenants`
table authoritative, with any projection rebuildable from it, and a test proving
the projection cannot diverge undetected.

**P1-1 — Live proof.** `packages/backend/tenant/src/*.live.test.ts` executes in the
live gate covering suspend, restore, legal-hold delete refusal, and cross-tenant
role denial.

## What I could not verify

- Any UX or accessibility dimension.
- Whether the admin console surfaces the divergence to an operator.
- Multi-replica suspension behaviour (single process only).
- Whether `platform-admin-ui`'s `ui-seed` `/tenants` is a fourth representation or
  reads the table; not traced.
