# Design Document

## Overview

This design closes the gaps Requirements 1-7 identify between the current Principal dashboard chrome/data and the target state, without inventing any schema the codebase doesn't already have. Every new field is additive. Every new query follows the existing `relationExists()` safe-fallback pattern in `packages/backend/report/src/dashboards.ts`. Every new UI surface follows the existing per-section `.catch(() => null)` degradation already used in `apps/web/src/app/(dashboard)/page.tsx`.

Three items requirements.md explicitly deferred stay deferred here too, because no design choice can respectably invent them: board/affiliation, branch/campus relationship, and staff teaching/non-teaching classification. Everywhere the mockup implies one of these, this design renders nothing rather than a fabricated number (Req 1 AC4, Req 3 AC1/AC3).

## Architecture

No new services are introduced. Changes land in four existing layers:

1. **Web chrome** (`apps/web/src/components/layout/`) — new `TenantIdentityBlock`, header identity/help/notification changes.
2. **Web dashboard page** (`apps/web/src/app/(dashboard)/page.tsx` and `reports/_components/role-dashboard-panel.tsx`) — KPI subtext, preview-state interception.
3. **Report backend** (`packages/backend/report/src/dashboards.ts`, `catalogue-service.ts`, `catalogue-routes.ts`) — new principal aggregates.
4. **Cross-cutting backends** — a new notification unread-count route (`packages/backend/notification`), a `metadata.category` convention on workflow instances (`apps/api-gateway/src/workflow-ui-engine-store.ts`), a new `health_nurse_incidents.status` column, a new `dashboard-preview` RBAC permission (`packages/shared/auth/src/rbac.ts`), and an optional Redis read-through cache (`@proctira/cache`) in front of the two hottest new reads (principal dashboard aggregates, notification unread-count).

Request flow for the dashboard home page is unchanged except for one new interception point: when a valid, authorized preview-state signal is present, the page's data-fetch layer substitutes fabricated results for the six `Promise.all` sources instead of calling `getRoleDashboard`/`listPendingApprovals`/etc. This keeps the real gateway calls, real RBAC, and real rendering paths completely intact for every user who never touches the switcher (Req 6 AC1, AC8, AC11).

## Components and Interfaces

### 1. Sidebar tenant/school identity block (Requirement 1)

New component `apps/web/src/components/layout/TenantIdentityBlock.tsx`, a Server Component (so it can call `getTenantSettings()` directly like other server-rendered chrome) mounted at the top of `apps/web/src/components/layout/sidebar.tsx`, between the logo block and `<nav>`.

- **Data source**: `getTenantSettings()` (`apps/web/src/lib/api/admin.server.ts`) → `TenantSettings.displayName`. Not the gateway's separate raw `SELECT name, slug FROM tenants` query in `apps/api-gateway/src/tenant-admin-plugin.ts` (`loadDirectory`) — that path serves the branding directory lookup, is not exposed as a reusable client function, and would require adding a new endpoint for no benefit when `TenantSettings.displayName` already serves the same purpose through an existing, tested client call.
- **Headcount**: reuses the same `listStudents({ pageSize: 1 })` call (or its already-fetched result, threaded down as a prop from `page.tsx`/passed into the sidebar via a shared server data call) that backs the existing Students KPI card — no new count query.
- **Degradation**: `getTenantSettings()` already returns `{ settings: TenantSettings | null, source: AdminSource }`; when `settings` is `null` the block renders nothing but the tenant name slot collapses to blank rather than throwing, consistent with Req 1 AC3.
- **Explicitly out of scope**: board/affiliation, branch/campus count. `Institution` and `TenantSettings` have no such field; the block only ever renders `displayName` + headcount (Req 1 AC4).

```ts
// apps/web/src/components/layout/TenantIdentityBlock.tsx
interface TenantIdentityBlockProps {
  displayName: string | null; // from getTenantSettings(); null renders nothing
  studentCount: number | null; // from the same source as the Students KPI card
}
```

### 2. Header identity, help, and notifications (Requirement 2)

Changes to `apps/web/src/components/layout/header.tsx`:

- Replace the hardcoded `<span>U</span>` avatar block with real session data. `Header` becomes a Server Component wrapper (`HeaderIdentity`) that reads `getSession()` server-side (same call `page.tsx` already makes) and passes `{ displayName, email, primaryRole, tenantName }` down; the existing client-side theme/language/search controls stay client-side as today. `displayName` falls back to `email` when empty (Req 2 AC1, AC2) — mirrors the same fallback already implemented in `authUserFromTokenPayload()` (`name: payload.displayName?.trim() || payload.email`), so the header reuses that existing helper rather than re-implementing the fallback.
- Add a help icon (`HelpCircle` from `lucide-react`, already used elsewhere e.g. `MobileShell.tsx`) linking to `/help` — a plain `<Link href="/help">`, no new content, no fork (Req 2 AC3, AC4).
- Add a notification bell (`Bell`, already used as a sidebar icon path) showing an unread badge sourced from a new endpoint (below). Renders a numeral badge when count > 0, a plain bell with no badge when 0 or when the fetch fails — never an error state in the header itself (Req 2 AC7).

New backend endpoint: `GET /notifications/user/:userId/unread-count` in `packages/backend/notification/src/routes.ts`, registered near the existing `GET /notifications/user/:userId` handler (same tenant-required guard). Implementation calls a new repository method `countUnreadNotifications(tenantId, userId)` that runs `SELECT COUNT(*)::int AS n FROM notifications WHERE tenant_id=$1 AND recipient_user_id=$2 AND status IN ('sent','delivered')` — reusing the existing `idx_notifications_tenant_recipient` and `idx_notifications_tenant_status` indexes (`db/sql/005_notifications_schema.sql`), no new index needed. `'sent'`/`'delivered'` are the not-yet-`'read'` states; `'failed'` is deliberately excluded since a failed delivery isn't a pending unread item. This count is Redis-cached per §8 below (short TTL, since the header polls or re-renders it often) — cache miss/absent Redis falls straight through to the query above, never blocking correctness on cache availability.

Web client: add `getUnreadNotificationCount(userId): Promise<number>` to `apps/web/src/lib/api/notifications-inbox.ts`, following the same `gatewayFetch(..., { throwOnError: false })` → `?? 0` pattern already used by `listUserNotifications`.

```ts
// packages/backend/notification/src/notification-repository.ts (new method on the interface)
countUnreadNotifications(tenantId: string, userId: string): Promise<number>;
```

### 3. KPI card descriptive subtext (Requirement 3)

Extend the local `KpiCard` component in `apps/web/src/app/(dashboard)/page.tsx` with an optional `subtext?: string | null` prop, rendered as a muted line under the headline value (or omitted entirely when `null`, consistent with the existing "Currently unavailable" pattern already used for the headline itself — Req 3 AC4/AC5).

- **Students card** (the only one wired in this design): subtext = `"{n} new this term"`, where `n = COUNT(students WHERE createdAt >= activePeriod.startDate AND createdAt <= activePeriod.endDate)`. `activePeriod` is the same `AcademicPeriod` already fetched via `listAcademicPeriods()` on the dashboard page. This requires one new lightweight call — reuse the existing `listStudents` filter surface if it supports a date-range filter; if not, add a narrow `createdAfter`/`createdBefore` filter to `StudentListFilters` (`apps/web/src/lib/api/students.ts`) rather than fetching the full roster client-side.
- **Institutions and Staff cards**: no subtext rendered. The mockup's "Main campus + 2 branches" and "71 teaching · 15 non-teaching" both require schema that doesn't exist (`Institution` branch relationship, `Staff.position` classification) — per Req 3 AC1/AC3, these stay unimplemented in this design, not approximated.

### 4. Principal snapshot metric set (Requirement 4)

Extend `DashboardAggregates` (`packages/backend/report/src/dashboards.ts`) additively — existing fields (`schools`, `students`, `enrolments`, `attendancePercent`, `openInvoices`, `feesCollectedCents`, `linkedChildren`) are untouched (Req 7 AC6); four new fields are added:

```ts
export interface DashboardAggregates {
  // ...existing fields, unchanged...
  todayAttendancePercent: number | null;
  feeCollectedThisMonthCents: number;
  pendingAdmissionsCount: number;
  openHealthIncidentsCount: number;
}
```

Each new field follows the exact `relationExists()` guard already used for every existing field (Req 4 AC7, Req 7 AC3). `loadDashboardAggregates(tenantId)` as a whole — the four new fields plus the three existing ones — is wrapped by the Redis read-through cache described in §8, since this function now runs one attendance-today query, one fee-sum query, and two new count queries on every principal dashboard load, in addition to what it already ran.

- `todayAttendancePercent`: fixes the existing all-time bug in the same function. Current query has no date filter; new query adds `WHERE date = CURRENT_DATE` (the `student_attendance` table's date column is literally named `date`, confirmed via the Prisma model). Uses server-local `CURRENT_DATE`; tenant-timezone-aware "today" is a known simplification, flagged here rather than silently assumed to be perfect (Req 4 AC1).
- `feeCollectedThisMonthCents`: `SELECT COALESCE(SUM(amount_cents),0) FROM parent_fee_payments WHERE status='succeeded' AND paid_at >= date_trunc('month', CURRENT_DATE)`. Ships as an amount only — **no percentage/target metric**. No collection-target, budget, or quota field exists anywhere in the fees schema, and this design does not add one speculatively; a target-based percentage is explicitly deferred until a product owner defines where the target number comes from (Req 4 AC2, AC3).
- `pendingAdmissionsCount`: `SELECT COUNT(*) FROM admission_applications WHERE status IN ('pending','under_review')` (the real table name, confirmed in `packages/backend/registration/src/pg-registration-repository.ts` — not `registrations`) (Req 4 AC4).
- `openHealthIncidentsCount`: `SELECT COUNT(*) FROM health_nurse_incidents WHERE status = 'open'`, depending on the new `status` column below (Req 4 AC5, AC6).

New migration `db/sql/103_health_nurse_incident_status.sql` (102 is the current highest numbered file):

```sql
-- Wave: principal-dashboard-parity — adds a status field to nurse incidents
-- so open/closed can be counted on the principal dashboard (Req 4 AC5/AC6).
ALTER TABLE health_nurse_incidents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed'));
```

Default `'open'` is deliberate: existing rows are treated conservatively as still needing attention rather than silently closed, since there is no way to know their true resolution state retroactively. The existing `tenant_isolation` RLS policy on `health_nurse_incidents` is untouched — adding a column doesn't require touching row-level policy.

`DASHBOARDS.principal.cards` gains/replaces cards to surface the four new metrics per Req 4; `valuesForRole('principal', agg)` is updated to map them. This is an additive change to `buildRoleDashboard`'s output shape, not a breaking one — existing card ids not replaced keep working (Req 7 AC6).

### 5. Approval categorization (Requirement 5)

Category lives in `instance.metadata.category` (a string), extending the workflow engine's existing jsonb `metadata` bag the same way `initiatedBy`/`initiatedAt` already do (`apps/api-gateway/src/workflow-ui-engine-store.ts`) — additive, no new column, no new table (Req 5 AC2).

`toUiApproval()` reads `instance.metadata?.category` and includes it on `UiWorkflowApproval`/`WorkflowApproval` as an optional field:

```ts
export interface WorkflowApproval {
  // ...existing fields unchanged...
  category?: string; // e.g. 'transfer' | 'leave'; absent = uncategorized
}
```

Taxonomy values are constrained to real, existing workflow definitions only: `student_transfer` → `'transfer'`, `staff_leave` → `'leave'` (`apps/api-gateway/src/workflow-ui-seed.ts`). No `'purchase_order'` or `'scholarship_disbursement'` category is introduced — those workflow definitions don't exist (Req 5 AC3). Categories are set when a definition creates an instance; existing instances created before this change simply have no `metadata.category`.

UI: `ApprovalsPanel` (`apps/web/src/app/(dashboard)/page.tsx`) renders a `Badge` (`packages/ui/components/src/Badge.tsx`) next to each approval — `variant="secondary"` for `'transfer'`, `variant="outline"` for `'leave'`, and `variant="outline"` labeled "Uncategorized" as the fallback when `category` is absent (Req 5 AC4). No new Badge variant is required; the existing six cover this.

### 6. Preview-state switcher (Requirement 6)

This is a real, permission-gated, session-scoped feature — not a dev-only flag.

**Signal storage**: a cookie `Dashboard-Preview-State`, value format `"<state>|<epochSecondsWhenSet>"` (e.g. `filled|1719400000`), `Path=/`, `SameSite=Lax`, `Max-Age=1800` (30 minutes), `Secure` in production — same shape as the existing `Tenant-Theme-Preview` cookie (`apps/web/src/lib/branding/previewCookie.ts`) but carrying the timestamp explicitly in the value, not just an opaque flag. This matters because expiry (Req 6 AC9) must be enforced server-side even if a client resends a stale cookie value past its `Max-Age` window through clock skew or manual replay — the server re-checks `now - epochSecondsWhenSet > 1800` on every read and treats an expired value as "no preview active," independent of whether the browser already expired the cookie itself.

**Authorization**: a new permission `{ resource: 'dashboard-preview', action: 'manage' }`. Note: the existing branding-preview precedent uses an informal `'branding:preview'` permission string checked by a hand-rolled resolver (`apps/api-gateway/src/tenant-admin-plugin.ts`) that compares against `role.permissions` using a colon-split, which sits outside the strictly-typed `PermissionAction` union in `packages/shared/auth/src/rbac.ts` (`'create'|'read'|'update'|'delete'|'list'|'manage'`). Rather than repeat that informal typing, this design introduces a new **resource** string (`'dashboard-preview'`) instead of a new **action** value, keeping the permission fully expressible within the existing typed `Permission{resource,action}` shape. `DEFAULT_ROLES` entries for `admin` and `principal` (`packages/shared/auth/src/rbac.ts`) gain this permission; tenant-custom roles can also grant it through the existing `/tenant/roles` CRUD without any code change, exactly like any other permission.

Every server read of the cookie re-verifies this permission fresh via `hasPermission`/`evaluatePermission` against the caller's actual roles — the cookie's mere presence never substitutes for the check (Req 6 AC12). This mirrors the branding-preview pattern's AND'd cookie+permission check, just against the new permission instead of `branding:preview`.

**Rendering the five states** — a new server-side helper `resolvePreviewOverride(request)` runs before `page.tsx`'s `Promise.all`, returns `null` when no valid+authorized+unexpired signal exists (the normal path, unchanged for every other user), or a `PreviewOverride` object otherwise:

| State | Behavior | Reused mechanism |
|---|---|---|
| Filled | Fabricated non-empty results substituted for all six sources | New fixture data shaped exactly like real `RoleDashboard`/`WorkflowApproval[]`/KPI results |
| No approvals | All sources succeed except `approvals` is forced to `[]` | Existing `ApprovalsPanel` empty state ("All caught up") — already renders correctly for `[]`, no new UI needed (Req 6 AC4) |
| Degraded | A defined subset (KPI cards) forced to `null`, `roleDashboard`/`approvals` still succeed | Existing per-source `.catch(() => null)` → "Currently unavailable" rendering — already correct for `null`, no new UI needed (Req 6 AC5) |
| Loading | Route-level suspend, page never resolves while state is set | Existing `apps/web/src/app/(dashboard)/loading.tsx` (`RouteLoadingPanel`) — the override forces a never-resolving promise for the duration the state is active rather than a fabricated fast response (Req 6 AC6) |
| Error | All sources rejected, page renders each section's existing error/unavailable branch | Same `.catch(() => null)` branches as Degraded, but applied to every source instead of a subset (Req 6 AC7) |

**Visible indicator** (Req 6 AC10): a banner built the same way as `ScaffoldModeBanner` (`apps/web/src/components/insights/ScaffoldModeBanner.tsx`), reusing `Alert` `variant="warning"`, rendered at the top of the dashboard page whenever `resolvePreviewOverride()` returns non-null, naming the active state (e.g. "Preview mode: Filled — this is not real data"). It is visible only to the session that set it, since it's driven by that session's own cookie (Req 6 AC8, AC11).

**Scope isolation** (Req 6 AC1, AC8, AC11): the cookie is browser-session-scoped and read only by the dashboard page's own server-side helper; it is never written to any shared/tenant-wide store, so no other user, session, or role can be affected by it, and non-admin roles never see the switcher control at all (client-side visibility gated by the same permission, checked via a session-derived server value passed to the client component, not the currently-empty `AuthUser.permissions` array).

**Audit** (Req 6 AC13): every set/clear calls `appendAuditEntryOnClient(client, toCreateAuditLogInput({ tenantId, entityType: 'dashboard_preview', entityId: tenantId, operation: 'CREATE', userId, userName, afterValues: { state }, ... }))` on set, and `operation: 'DELETE'` on clear, inside the same `withPgTenant` transaction pattern used by `packages/backend/health/src/routes.ts` and `packages/backend/fees/src/fees-plugin.ts` — writing to the append-only, hash-chained, FORCE-RLS `audit_log_entries` table, the strongest audit mechanism already in the repo, appropriate given this mechanism can force a production-capable surface to show fabricated data.

### 8. Read-through Redis cache for hot dashboard reads

`packages/backend/report/src/dashboards.ts` and the new notification unread-count path have no cache layer today, but this profile — tenant-scoped, read-heavy, tolerant of a few minutes of staleness — is exactly what the existing `@proctira/cache` `CacheClient` decorator pattern already targets elsewhere in this repo (`CachedInstitutionRepository`, `CachedStudentRepository`, `CachedWorkflowRepository`, `CachedScholarshipRepository`, `CachedAttendanceRepository`). This design follows that same pattern rather than inventing a new one.

**`loadDashboardAggregates(tenantId)`** (`packages/backend/report/src/dashboards.ts`): wrapped with `cache.getOrSet(tenantKey(tenantId, 'dashboard-aggregates', 'principal'), () => computeAggregates(tenantId), AGGREGATES_TTL_SECONDS)`, where `computeAggregates` is the existing function body (all seven `relationExists()`-guarded queries) extracted unchanged. TTL is **90 seconds** — short enough that a principal marking today's attendance or approving a fee payment sees it reflected within one dashboard refresh, long enough to absorb repeated page loads within a session. This is deliberately much shorter than the existing 300-600s TTLs used for institution/student/workflow entities, because attendance and fee data change throughout the school day in a way a cached institution record does not.

**`countUnreadNotifications(tenantId, userId)`**: wrapped with `cache.getOrSet(tenantKey(tenantId, 'notification-unread-count', userId), () => repository.countUnreadNotifications(tenantId, userId), UNREAD_COUNT_TTL_SECONDS)`. TTL is **30 seconds** — short, because an unread count that undercounts a just-arrived notification for half a minute is a much smaller problem than a header that looks broken, and because reads to this endpoint are cheap enough that a short TTL doesn't threaten Postgres load the way a slow aggregate query would.

**Invalidation**: neither cache is actively invalidated on write in this design. A 90-second and a 30-second TTL are both short enough that natural expiry is sufficient, avoiding the complexity of wiring invalidation into every write path that touches attendance, fees, admissions, health incidents, or notification delivery — none of which currently call into `packages/backend/report` or emit an event this cache could subscribe to. If staleness proves noticeable in practice, active invalidation is a follow-up, not a blocker for this spec.

**Wiring**: both call sites accept an optional `cache?: CacheClient` constructor/factory parameter, exactly like every existing `Cached*Repository`. When `REDIS_URL` is unset, `cache` is `undefined` and both functions run exactly as they do today — direct queries, no behavior change, no new required dependency. `CatalogueService` (`packages/backend/report/src/catalogue-service.ts`) and the notification stack factory (`packages/backend/notification/src/create-notification-stack.ts`) are the two composition points that construct `CacheClient` from `process.env['REDIS_URL']` when present, mirroring `createStudentRepository` (`packages/backend/student/src/repository-factory.ts`).

**Tenant-scoped keys**: both keys are built with `tenantKey()` (`@proctira/cache`'s `packages/shared/cache/src/cache-keys.ts`), so the existing `assertTenantScopedCacheKey` enforcement (`W1-SEC-11`, fail-closed in production) applies automatically — there is no way to construct an unscoped key for either of these two reads (Req 7 AC1).

**Failure mode**: `CacheClient.getOrSet` already falls through to the fetcher on any Redis error and never throws (`packages/shared/cache/src/cache-client.ts`) — so a Redis outage degrades this feature to exactly its pre-cache behavior (slightly slower, always correct), never to an error or stale-forever state. This is consistent with Req 7 AC2's degradation requirement, extended to a new dependency this design introduces.

```ts
// packages/backend/report/src/dashboards.ts — cache wrapping (illustrative)
const AGGREGATES_TTL_SECONDS = 90;

export async function loadDashboardAggregates(
  tenantId: string,
  cache?: CacheClient,
): Promise<DashboardAggregates> {
  if (!cache) return computeAggregates(tenantId);
  return cache.getOrSet(
    tenantKey(tenantId, 'dashboard-aggregates', 'principal'),
    () => computeAggregates(tenantId),
    AGGREGATES_TTL_SECONDS,
  );
}
```

```ts
// packages/backend/notification/src/pg-notification-repository.ts — cache wrapping (illustrative)
const UNREAD_COUNT_TTL_SECONDS = 30;

async function countUnreadNotificationsCached(
  tenantId: string,
  userId: string,
  cache: CacheClient | undefined,
  compute: () => Promise<number>,
): Promise<number> {
  if (!cache) return compute();
  return cache.getOrSet(tenantKey(tenantId, 'notification-unread-count', userId), compute, UNREAD_COUNT_TTL_SECONDS);
}
```

### 9. Cross-cutting constraints (Requirement 7)

| AC | Satisfied by |
|---|---|
| AC1 (tenant scoping) | Every new query runs inside `withPgTenant`; the preview cookie is read only within the requesting session (§6) |
| AC2 (independent degradation) | New KPI subtext (§3) and new snapshot metrics (§4) each fail independently via the same `.catch(() => null)` convention |
| AC3 (relationExists guard) | Every new aggregate query in §4 is guarded by `relationExists()` before running |
| AC4 (RBAC, not client-only) | §6's `dashboard-preview` permission is re-checked server-side on every read, never trusting client-side visibility |
| AC5 (explicit sign-off for open schema questions) | Board/affiliation, branch/campus, staff classification, and fee-collection target are named explicitly as NOT decided in this design (§1, §3, §4) |
| AC6 (additive, no breaking changes) | `DashboardAggregates`, `WorkflowApproval`, `TenantSettings`, `NurseIncidentRecord` all gain fields only; nothing existing is removed or retyped |

## Data Models

```ts
// packages/backend/report/src/dashboards.ts — additive
export interface DashboardAggregates {
  schools: number;
  students: number;
  enrolments: number;
  attendancePercent: number | null;       // unchanged, existing all-time metric
  openInvoices: number;
  feesCollectedCents: number;
  linkedChildren: number;
  todayAttendancePercent: number | null;  // new
  feeCollectedThisMonthCents: number;     // new
  pendingAdmissionsCount: number;         // new
  openHealthIncidentsCount: number;       // new
}
```

```ts
// apps/web/src/lib/api/workflows.ts — additive
export interface WorkflowApproval {
  id: string;
  instanceId: string;
  definitionName: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  requestedAt: string;
  requestedBy: string;
  category?: string; // new, optional — 'transfer' | 'leave' | absent
}
```

```sql
-- db/sql/103_health_nurse_incident_status.sql — additive column
ALTER TABLE health_nurse_incidents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed'));
```

```ts
// packages/shared/auth/src/rbac.ts — additive permission on existing roles
{ resource: 'dashboard-preview', action: 'manage' } // added to admin, principal
```

```ts
// apps/web/src/lib/api/notifications-inbox.ts — new function
export async function getUnreadNotificationCount(userId: string): Promise<number>;
```

## Error Handling

- Every new backend aggregate query reuses `relationExists()` + the local `count()` helper's swallow-to-zero behavior (`packages/backend/report/src/dashboards.ts`) — a missing table never throws, it degrades to `0`/`null` for that one metric only.
- Every new web-side fetch (`TenantIdentityBlock`'s tenant settings call, the Students subtext count, the unread-notification count) follows the existing `gatewayFetch(..., { throwOnError: false })` convention and renders an omitted/muted state on failure, never a page-level error.
- The preview-state helper (`resolvePreviewOverride`) fails closed: any error parsing the cookie, checking the permission, or checking expiry results in treating the request as "no preview active" — it never fails open into showing fabricated data to an unauthorized or ambiguous caller.
- The new `health_nurse_incidents.status` migration is written idempotently (`ADD COLUMN IF NOT EXISTS`) so it is safe to re-run, consistent with `tools/scripts/apply-sql.sh`'s ledger-and-retry model.

## Correctness Properties

These are invariants the implementation must hold, independent of any single test case:

### Property 1: Tenant isolation

No new query, endpoint, or cookie-driven override can ever return or affect data for a `tenantId` other than the authenticated caller's own. Every new aggregate query runs inside `withPgTenant`; the preview-state cookie is scoped to one browser session and is never persisted server-side against a shared key.

**Validates: Requirements 6.1, 6.8, 6.11, 7.1**

### Property 2: Authorization is server-checked, not client-inferred

The preview-state switcher's visibility in the UI is never the sole gate — every server read of the preview cookie re-evaluates the `dashboard-preview:manage` permission fresh against the caller's actual roles, so a forged or replayed cookie value without the permission has no effect.

**Validates: Requirements 6.12, 7.4**

### Property 3: Fail-closed degradation

For every new data source (KPI subtext, new snapshot metrics, unread-notification count, preview-state resolution), an error, missing relation, or unparseable signal degrades that one section to its "unavailable"/omitted state. It never throws uncaught, blocks the rest of the page, or silently fabricates a plausible-looking value in place of real data.

**Validates: Requirements 3.4, 3.5, 4.7, 4.8, 7.2, 7.3**

### Property 4: Preview state cannot outlive its expiry

Once more than 30 minutes have elapsed since a preview state was set, the server treats the request as if no preview were active, regardless of what the client's cookie still contains or claims.

**Validates: Requirements 6.9**

### Property 5: Additive-only schema evolution

Every new field on `DashboardAggregates`, `WorkflowApproval`, and `health_nurse_incidents` is optional or defaulted such that code written against the pre-existing shape continues to compile and run unmodified.

**Validates: Requirements 7.6**

### Property 6: Audit completeness

Every successful preview-state set and every clear (including automatic expiry-driven clears) produces exactly one corresponding `audit_log_entries` row attributing actor, tenant, and timestamp. No code path sets or clears the state without also writing the audit entry.

**Validates: Requirements 6.13**

## Testing Strategy

- **Backend unit tests**: `packages/backend/report/src/dashboards.test.ts`-style coverage for each new `DashboardAggregates` field, including the `relationExists()`-false branch (table absent → default) and the demo-fallback branch, mirroring the existing test style in `catalogue-service.test.ts`.
- **Migration test**: apply `103_health_nurse_incident_status.sql` against a fixture DB, assert existing rows get `status='open'`, assert the CHECK constraint rejects invalid values, assert RLS still isolates by tenant.
- **RBAC test**: extend `packages/shared/auth/src/rbac.ts`'s existing test coverage to assert `admin`/`principal` carry `dashboard-preview:manage` and that `teacher`/`staff`/`guardian` do not.
- **Preview-state integration test**: a Playwright/integration test asserting (a) a user without the permission never sees the switcher and a hand-crafted cookie has no effect on their rendered page, (b) each of the five states renders its documented presentation, (c) the state auto-clears after the 30-minute window, (d) setting/clearing writes an `audit_log_entries` row.
- **Approval categorization test**: assert `toUiApproval()` surfaces `metadata.category` when present and omits it otherwise, and that the UI's fallback Badge renders for absent categories.
- **KPI subtext test**: assert the Students subtext count uses the active academic period's date range and omits itself when `listAcademicPeriods()` fails.
- **Cache behavior test**: assert `loadDashboardAggregates`/`countUnreadNotifications` return correct results with `cache` omitted (today's behavior, unchanged), with a working mock `CacheClient` (cache hit skips the delegate call, cache miss populates it), and with a `CacheClient` whose Redis calls throw (falls through to the real query, does not throw), mirroring the existing test style in `cached-institution-repository.test.ts`.

## Open questions carried forward (not decided here, as requirements.md already scoped these out)

- Board/affiliation and branch/campus relationship schema (Req 1, 3).
- Staff teaching/non-teaching classification field shape (Req 3).
- Fee-collection percentage/target denominator (Req 4) — this design ships the collected amount only.

No other open questions remain; every other item requirements.md flagged has a concrete decision above.
