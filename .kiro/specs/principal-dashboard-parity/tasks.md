# Implementation Plan

## Overview

This plan implements the 7 requirements in `requirements.md` per the design in `design.md`. Work proceeds roughly bottom-up: schema/backend aggregates and endpoints first (Tasks 1-4), then the UI surfaces that consume them (Tasks 5, 11-13), then the preview-state switcher end to end (Tasks 6-10, the largest and most cross-cutting piece), then an integration pass (Task 14). Every task changes only additive/new code paths — no existing field, endpoint, or component contract is removed or retyped.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2.1", "2.2", "2.3", "3.1", "4.1", "6", "7.1", "11.1", "13.1"],
      "description": "Independent schema, backend field, and leaf-component groundwork with no dependencies on other tasks in this plan."
    },
    {
      "wave": 2,
      "tasks": ["2.4", "2.5", "3.2", "4.2", "7.2", "11.2", "13.2"],
      "description": "Builds on wave 1: nurse-incident count needs the migration, aggregate card wiring needs all four fields, the notification route needs the repository method, category propagation needs the type change, the preview resolver needs the permission and cookie codec, sidebar mount needs the component, subtext wiring needs the prop."
    },
    {
      "wave": 3,
      "tasks": ["2.6", "2.7", "3.3", "3.5", "4.3", "5", "8.1", "9.1", "11.3", "13.3"],
      "description": "Tests and consumers of wave-2 output: aggregate tests, the Redis cache wrapper around loadDashboardAggregates (needs all four fields wired first), web notification client, the Redis cache wrapper around countUnreadNotifications, category tests, approval badge UI, preview fixtures, preview set/clear routes, identity-block tests, subtext tests."
    },
    {
      "wave": 4,
      "tasks": ["2.8", "3.4", "3.6", "8.2", "9.2", "12.1"],
      "description": "Cache-wrapper tests for the dashboard aggregates and the unread-count, notification endpoint tests, dashboard-page preview interception (needs the resolver and fixtures), audit logging on the set/clear routes, header identity replacement."
    },
    {
      "wave": 5,
      "tasks": ["8.3", "9.3", "10.1", "12.3"],
      "description": "Preview-state rendering tests, set/clear route tests, the switcher control (needs the override plumbing from wave 4), and the notification bell (needs the web client from wave 3)."
    },
    {
      "wave": 6,
      "tasks": ["10.2", "12.4"],
      "description": "The fabricated-state banner (needs the switcher control) and header tests (need the avatar, help link, and bell all in place)."
    },
    {
      "wave": 7,
      "tasks": ["10.3"],
      "description": "Switcher component tests, run after the banner exists so both visibility gating and banner content can be asserted together."
    },
    {
      "wave": 8,
      "tasks": ["14.1", "14.2"],
      "description": "Final integration verification pass, run only after every other task is complete."
    }
  ]
}
```

## Tasks

- [ ] 1. Add `status` column migration for nurse incidents
  - Create `db/sql/103_health_nurse_incident_status.sql` adding `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))` to `health_nurse_incidents` via `ADD COLUMN IF NOT EXISTS`, idempotent per `tools/scripts/apply-sql.sh` conventions
  - Leave the existing `tenant_isolation` RLS policy untouched
  - Update `NurseIncidentRecord` (`apps/web/src/lib/api/health.ts`) and the backend incident type to include the new optional/defaulted `status` field, additively
  - _Requirements: 4.5, 4.6, 7.3, 7.5, 7.6_

- [ ] 2. Extend `DashboardAggregates` with the four new principal metrics
  - [ ] 2.1 Fix the existing attendance query and add `todayAttendancePercent`
    - In `packages/backend/report/src/dashboards.ts`, add a `WHERE date = CURRENT_DATE` filter to a new query (keep the existing all-time `attendancePercent` field untouched) using the same `relationExists()` guard as the existing attendance query
    - _Requirements: 4.1, 4.7, 4.8, 7.3, 7.6_
  - [ ] 2.2 Add `feeCollectedThisMonthCents`
    - Query `parent_fee_payments` for `status='succeeded' AND paid_at >= date_trunc('month', CURRENT_DATE)`, guarded by `relationExists()`
    - Do not add any target/percentage field — amount only, per the design's explicit deferral
    - _Requirements: 4.2, 4.3, 4.7, 4.8, 7.3, 7.6_
  - [ ] 2.3 Add `pendingAdmissionsCount`
    - Query `admission_applications` for `status IN ('pending','under_review')`, guarded by `relationExists()`
    - _Requirements: 4.4, 4.7, 4.8, 7.3, 7.6_
  - [ ] 2.4 Add `openHealthIncidentsCount`
    - Query `health_nurse_incidents` for `status = 'open'` (depends on Task 1's migration), guarded by `relationExists()`
    - _Requirements: 4.5, 4.7, 4.8, 7.3, 7.6_
  - [ ] 2.5 Update `DASHBOARDS.principal.cards` and `valuesForRole('principal', ...)`
    - Map the four new aggregate fields onto the principal card set, keeping existing card ids/fields additive per `DashboardAggregates`'s unchanged fields
    - _Requirements: 4.7, 7.6_
  - [ ] 2.6 Write unit tests for the four new aggregate fields
    - Cover the `relationExists()`-false branch (table absent → default), the demo-fallback branch, and the happy path, mirroring existing test style in `packages/backend/report/src/catalogue-service.test.ts`
    - _Requirements: 4.7, 4.8, 7.3_
  - [ ] 2.7 Wrap `loadDashboardAggregates` with an optional Redis read-through cache
    - Extract the existing query body into `computeAggregates(tenantId)`; add an optional `cache?: CacheClient` parameter; when present, wrap via `cache.getOrSet(tenantKey(tenantId, 'dashboard-aggregates', 'principal'), () => computeAggregates(tenantId), 90)`, following the exact pattern in `packages/backend/institution/src/cached-institution-repository.ts`
    - When `cache` is omitted (no `REDIS_URL`), behavior is unchanged from today — direct query, no new required dependency
    - Wire `CatalogueService` (`packages/backend/report/src/catalogue-service.ts`) to construct a `CacheClient` from `process.env['REDIS_URL']` when present and pass it through, mirroring `createStudentRepository` (`packages/backend/student/src/repository-factory.ts`)
    - _Requirements: 7.1, 7.2_
  - [ ] 2.8 Write tests for the cache-wrapped aggregates
    - Cover: `cache` omitted (unchanged direct-query behavior), cache hit (delegate not called), cache miss (delegate called once, result cached), and a `CacheClient` whose Redis calls throw (falls through to the real query, does not throw)
    - _Requirements: 7.1, 7.2_

- [ ] 3. Add the notification unread-count endpoint
  - [ ] 3.1 Add `countUnreadNotifications(tenantId, userId)` to the notification repository interface and implementations
    - Implement in `packages/backend/notification/src/pg-notification-repository.ts` as `SELECT COUNT(*)::int FROM notifications WHERE tenant_id=$1 AND recipient_user_id=$2 AND status IN ('sent','delivered')`, reusing the existing `idx_notifications_tenant_recipient`/`idx_notifications_tenant_status` indexes
    - Implement the equivalent in `packages/backend/notification/src/in-memory-repository.ts` for test/dev parity
    - _Requirements: 2.5, 2.6, 7.1_
  - [ ] 3.2 Add `GET /notifications/user/:userId/unread-count` route
    - Register in `packages/backend/notification/src/routes.ts` near the existing `GET /notifications/user/:userId` handler, with the same tenant-required guard, returning `{ count: number }`
    - _Requirements: 2.5, 2.6, 2.7, 7.1_
  - [ ] 3.3 Add `getUnreadNotificationCount(userId)` to the web client
    - Add to `apps/web/src/lib/api/notifications-inbox.ts` following the existing `gatewayFetch(..., { throwOnError: false })` → default-to-`0` pattern used by `listUserNotifications`
    - _Requirements: 2.5, 2.7_
  - [ ] 3.4 Write tests for the repository method and route
    - Cover zero-unread, some-unread, and unreachable-service cases
    - _Requirements: 2.5, 2.6, 2.7_
  - [ ] 3.5 Wrap `countUnreadNotifications` with an optional Redis read-through cache
    - When a `CacheClient` is available, wrap via `cache.getOrSet(tenantKey(tenantId, 'notification-unread-count', userId), () => repository.countUnreadNotifications(tenantId, userId), 30)`, following the same pattern as Task 2.7
    - When `cache` is omitted, behavior is unchanged — direct query on every call
    - Wire the notification stack factory (`packages/backend/notification/src/create-notification-stack.ts`) to construct a `CacheClient` from `process.env['REDIS_URL']` when present
    - _Requirements: 7.1, 7.2_
  - [ ] 3.6 Write tests for the cache-wrapped unread-count
    - Cover: `cache` omitted, cache hit, cache miss, and Redis-throws-falls-through, mirroring Task 2.8
    - _Requirements: 7.1, 7.2_

- [ ] 4. Add approval categorization via workflow instance metadata
  - [ ] 4.1 Extend `WorkflowApproval`/`UiWorkflowApproval` with an optional `category` field
    - Update `apps/web/src/lib/api/workflows.ts` and the backend `UiWorkflowApproval` type additively
    - Update `toUiApproval()` in `apps/api-gateway/src/workflow-ui-engine-store.ts` to read `instance.metadata?.category` and pass it through
    - _Requirements: 5.1, 5.2, 7.6_
  - [ ] 4.2 Set `category` when creating instances for known real definitions
    - Map `student_transfer` → `'transfer'` and `staff_leave` → `'leave'` at instance-creation time; do not introduce any category without a corresponding real workflow definition
    - _Requirements: 5.1, 5.3_
  - [ ] 4.3 Write tests for category propagation and the uncategorized case
    - Assert `toUiApproval()` surfaces `metadata.category` when present and omits it when absent
    - _Requirements: 5.2, 5.4_

- [ ] 5. Render approval category badges in the UI
  - Update `ApprovalsPanel` in `apps/web/src/app/(dashboard)/page.tsx` to render a `Badge` (`packages/ui/components/src/Badge.tsx`) per approval: `variant="secondary"` for `'transfer'`, `variant="outline"` for `'leave'`, and `variant="outline"` labeled "Uncategorized" as the fallback when `category` is absent
  - Preserve the existing tenant-scoping and role-based visibility already enforced by `listPendingApprovals()`
  - _Requirements: 5.1, 5.4, 5.5_

- [ ] 6. Add the `dashboard-preview` RBAC permission
  - Add `{ resource: 'dashboard-preview', action: 'manage' }` to the `admin` and `principal` entries in `DEFAULT_ROLES` (`packages/shared/auth/src/rbac.ts`)
  - Confirm the existing `/tenant/roles` CRUD path can also grant this permission to custom tenant roles without further code changes
  - Write a test asserting `admin`/`principal` carry the permission and `teacher`/`staff`/`guardian` do not
  - _Requirements: 6.12, 7.4_

- [ ] 7. Implement preview-state signal encode/decode and server-side resolution
  - [ ] 7.1 Implement cookie encode/decode helpers
    - Value format `"<state>|<epochSecondsWhenSet>"` for cookie `Dashboard-Preview-State`; `Path=/`, `SameSite=Lax`, `Max-Age=1800`, `Secure` in production, following the shape of `apps/web/src/lib/branding/previewCookie.ts`
    - _Requirements: 6.2, 6.9_
  - [ ] 7.2 Implement `resolvePreviewOverride(request)` server-side helper
    - Parses the cookie, re-checks the `dashboard-preview:manage` permission fresh against the caller's actual roles (never trusting cookie presence alone), and checks `now - epochSecondsWhenSet <= 1800`
    - Returns `null` (no override) on any parse error, missing permission, or expiry — fail closed in every case
    - _Requirements: 6.1, 6.8, 6.9, 6.11, 6.12, 7.1, 7.4_
  - [ ] 7.3 Write unit tests for the helper
    - Cover: no cookie, expired cookie, valid cookie without permission, valid cookie with permission, malformed cookie value
    - _Requirements: 6.1, 6.9, 6.12_

- [ ] 8. Build the five preview-state data fixtures and wire them into the dashboard page
  - [ ] 8.1 Build fixture data for each state
    - Filled: non-empty KPI values, populated approvals list, populated role snapshot, shaped exactly like real `RoleDashboard`/`WorkflowApproval[]`/KPI results
    - No approvals: all sources succeed except `approvals` forced to `[]`
    - Degraded: KPI cards forced to `null`, role snapshot/approvals still succeed
    - Error: every source forced to its failure/null branch
    - Loading: a promise that does not resolve while the state remains active
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ] 8.2 Intercept `apps/web/src/app/(dashboard)/page.tsx`'s data-fetch layer
    - Before the existing `Promise.all`, call `resolvePreviewOverride()`; when non-null, substitute the matching fixture for the six sources instead of calling the real gateway functions
    - Ensure the real fetch path is completely unaffected when no override is active
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.11_
  - [ ] 8.3 Write tests asserting each state renders its documented presentation
    - Including that "No approvals" is distinguishable from "Degraded" and from "Error"
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 9. Add preview-state set/clear routes with audit logging
  - [ ] 9.1 Add routes to set and clear the preview-state cookie
    - Gate both with the `dashboard-preview:manage` permission check server-side, independent of any client-side visibility
    - _Requirements: 6.1, 6.2, 6.12_
  - [ ] 9.2 Write the audit entry on every set and every clear
    - Use `appendAuditEntryOnClient(client, toCreateAuditLogInput({ tenantId, entityType: 'dashboard_preview', entityId: tenantId, operation: 'CREATE'|'DELETE', userId, userName, afterValues: { state }, ... }))` inside the same `withPgTenant` transaction pattern used by `packages/backend/health/src/routes.ts`
    - Ensure automatic expiry (Task 7.2 returning `null` for an expired cookie) is also treated as a clear for audit purposes when the client next calls the clear route or re-requests the dashboard past expiry
    - _Requirements: 6.13_
  - [ ] 9.3 Write tests for the set/clear routes and their audit entries
    - Assert an unauthorized caller cannot set the state, and that exactly one audit row is written per set/clear
    - _Requirements: 6.12, 6.13_

- [ ] 10. Build the preview-state switcher control and visible indicator
  - [ ] 10.1 Build the switcher control component
    - Visible only when the server has confirmed the caller holds `dashboard-preview:manage` (pass this as a server-derived boolean prop, not the client `AuthUser.permissions` array which is always empty today); offers exactly the five states
    - _Requirements: 6.1, 6.2_
  - [ ] 10.2 Build the visible fabricated-state banner
    - Reuse the `Alert`/`ScaffoldModeBanner` pattern (`apps/web/src/components/insights/ScaffoldModeBanner.tsx`), `variant="warning"`, naming the active state, shown only to the session that set it
    - _Requirements: 6.10_
  - [ ] 10.3 Write component tests for visibility gating and banner content
    - _Requirements: 6.1, 6.10_

- [ ] 11. Add the sidebar tenant identity block
  - [ ] 11.1 Build `TenantIdentityBlock` (`apps/web/src/components/layout/TenantIdentityBlock.tsx`)
    - Server Component reading `getTenantSettings().displayName`; accepts a `studentCount` prop sourced from the same data already backing the Students KPI card; renders nothing (not a blank placeholder) when settings are unavailable
    - Do not add any board/affiliation or branch/campus field — none exists on `TenantSettings` or `Institution`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ] 11.2 Mount it in `apps/web/src/components/layout/sidebar.tsx`
    - Place between the logo block and `<nav>`
    - _Requirements: 1.1_
  - [ ] 11.3 Write tests for the degraded and tenant-scoping cases
    - _Requirements: 1.3, 1.6_

- [ ] 12. Update the header with real identity, help link, and notification bell
  - [ ] 12.1 Replace the hardcoded avatar with real session identity
    - Read `getSession()` server-side, pass `displayName` (falling back to `email` via the existing `authUserFromTokenPayload()` fallback logic), primary role, and tenant name into `apps/web/src/components/layout/header.tsx`
    - _Requirements: 2.1, 2.2, 2.8_
  - [ ] 12.2 Add a help icon linking to `/help`
    - Plain link to the existing `/help` route; no new content, no fork
    - _Requirements: 2.3, 2.4_
  - [ ] 12.3 Add a notification bell using the Task 3 unread-count endpoint
    - Numeral badge when count > 0; plain bell with no badge on zero or on fetch failure — never an error state in the header
    - _Requirements: 2.5, 2.6, 2.7_
  - [ ] 12.4 Write tests for the fallback name, help link, and bell states
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

- [ ] 13. Add Students KPI card subtext
  - [ ] 13.1 Extend the local `KpiCard` component with an optional `subtext` prop
    - Render as a muted line under the headline value, or omit entirely when `null`
    - _Requirements: 3.4, 3.5_
  - [ ] 13.2 Compute and wire the Students subtext
    - Count students where `createdAt` falls within the active academic period's `startDate`/`endDate` (from the already-fetched `listAcademicPeriods()` result); add a narrow date-range filter to `StudentListFilters` (`apps/web/src/lib/api/students.ts`) if one does not already exist, rather than fetching the full roster client-side
    - Do not add subtext to the Institutions or Staff cards — no branch relationship or teaching/non-teaching field exists
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [ ] 13.3 Write tests for the subtext computation and its degraded case
    - _Requirements: 3.2, 3.4_

- [ ] 14. Integration verification pass
  - [ ] 14.1 Write an end-to-end test for the preview-state switcher covering authorization, all five states, expiry, and audit
    - Assert a user without the permission never sees the switcher and that a hand-crafted cookie has no effect on their rendered page
    - _Requirements: 6.1, 6.8, 6.9, 6.11, 6.12, 6.13_
  - [ ] 14.2 Run the full existing dashboard test suite and fix any regressions surfaced by the additive changes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

## Notes

- Tasks 1-4 (schema + backend) have no UI dependency and can be executed before, in parallel with, or independently of Tasks 11-13 (UI surfaces) except where explicitly noted in the dependency graph.
- Task 6 (RBAC permission) is a small, isolated change but sits on the critical path for the entire preview-state switcher (Tasks 7-10) — do it early.
- Tasks 2.7/2.8 and 3.5/3.6 add an optional Redis read-through cache (`@proctira/cache`) in front of the two hottest new reads. Both are opt-in via `REDIS_URL`; with it unset, the code paths behave exactly as they do without these tasks. Do not skip the "omitted `cache`" test case in 2.8/3.6 — it is what guarantees this feature works in every environment that doesn't run Redis.
- No task in this plan removes or retypes an existing field, endpoint, or component prop; every change is additive, consistent with Requirement 7 AC6.
- The three schema questions requirements.md and design.md both explicitly left open — board/affiliation, branch/campus relationship, and staff teaching/non-teaching classification — have no corresponding task here. They require a product-owner decision before any task can be written for them.
