# Requirements Document

## Introduction

A mockup of the Principal dashboard was compared against the real ProctiraErp implementation (`apps/web`, `packages/backend`). The dashboard home page (`apps/web/src/app/(dashboard)/page.tsx`) already renders real, gateway-backed KPI cards and a role-specific snapshot panel (`getRoleDashboard` → `packages/backend/report/src/dashboards.ts`), with graceful `.catch(() => null)` degradation on every data fetch. The sidebar (`apps/web/src/components/layout/sidebar.tsx`) and header (`apps/web/src/components/layout/header.tsx`) are real, permission-gated chrome.

The mockup implies additional context and detail that the current implementation does not yet surface: a tenant/school identity block in the sidebar, a richer header (identity, help, notifications), descriptive subtext on KPI cards, a different principal snapshot metric set, categorized approval types, and an admin-visible "preview state" switcher for QA/demo purposes. Some of this is a straightforward wiring gap (real data exists but is not displayed). Some of it requires a genuine schema or taxonomy decision that this document deliberately does not lock in — those points are flagged as open questions for the design phase.

This document defines WHAT must be true of the system's behavior and why, using EARS-style acceptance criteria (WHEN/IF ... THE SYSTEM SHALL ...). It does not specify data models, component structure, or API contracts — those belong in `design.md`.

**Baseline already in place (cited for context, not treated as a gap):**

- `apps/web/src/app/(dashboard)/page.tsx` renders 4 KPI cards (Institutions, Students, Staff, Academic period) via `listInstitutionsPage`, `listStudents`, `listStaff`, `listAcademicPeriods`, each independently `.catch(() => null)` and rendered as "Currently unavailable" on failure.
- `getRoleDashboard(role)` (`apps/web/src/lib/reports/api.ts`) calls the gateway `/reports/dashboard?role=principal`, which is served by `loadDashboardAggregates(tenantId)` in `packages/backend/report/src/dashboards.ts`. It queries real tables (`institutions`, `students`, `enrollments`, `student_attendance`, `parent_fee_invoices`, `parent_fee_payments`) guarded by `relationExists()` (`to_regclass` checks) with fallback to `DEMO_AGGREGATES` when a table is absent or the pool is unavailable. The principal card set today is exactly 4 metrics: enrolment, all-time attendance %, open fee dues (count), and student count.
- `listPendingApprovals()` (`apps/web/src/lib/api/workflows.ts`) calls `/workflows/approvals/pending`, which in the mounted gateway path (`apps/api-gateway/src/domain-plugins.ts`) is served by `EngineBackedWorkflowUiStore`, a real adapter over the workflow engine — not the static demo seed. `WorkflowApproval` carries `definitionName`, `subjectType`, `subjectId`, `stepName`; `subjectType` is populated directly from the workflow instance's `entityType` (`apps/api-gateway/src/workflow-ui-engine-store.ts`), so there is no category/kind taxonomy anywhere in this path today.
- The sidebar has 22 permission/role-gated modules (`apps/web/src/components/layout/sidebar.tsx`) and a bare logo + product wordmark — no tenant/school identity block underneath it.
- The header (`apps/web/src/components/layout/header.tsx`) has global search (⌘K command palette), theme toggle, and language selector — but the user-menu avatar is a hardcoded "U" circle with no name, role, or tenant shown, and there is no notification affordance.
- **Correction to a claim in the initial investigation:** `/help` is not a missing route. `apps/web/src/app/(dashboard)/help/page.tsx` is a fully built page (module guides, keyboard shortcuts, operator runbooks, support-ticket link), and it is already reachable via the ⌘K command palette (`featureRegistry` id `'help'`, `routePrefix: 'help'`, confirmed in `apps/web/src/components/CommandPalette.tsx`). The real gap is narrower: no persistent chrome element (header or sidebar) links to it, so a user who does not know about ⌘K has no visible way to find it.
- Session data already available server-side (`apps/web/src/lib/auth/server.ts` `getSession()`, decoding `TokenPayload` from `apps/web/src/lib/auth/session.ts`) includes `displayName`, `email`, `tenantId`, and `roles[]` — this is not currently surfaced in the header.
- Admission applications have a real `RegistrationStatus` enum (`packages/backend/registration/src/registration-repository.ts`): `pending | under_review | approved | rejected | waitlisted`.
- Staff records (`apps/web/src/lib/api/staff.ts`) have a free-text `position: string` field only — no teaching/non-teaching boolean or enum.
- Nurse incident records (`NurseIncidentRecord` in `apps/web/src/lib/api/health.ts`, backed by `health_nurse_incidents` in `db/sql/046_health_incidents_etl_schema.sql`) have `category`, `severity`, and `notes` but no status/open-closed field of any kind.
- `TenantSettings` (`apps/web/src/lib/api/admin.server.ts`, backed by `packages/backend/tenant/src/tenant-settings.ts`) has `displayName`, locale, timezone, `academicYearStartMonth`, `branding`, and `contact` — no board/affiliation field and no branch/campus-count concept. `Institution` (`apps/web/src/lib/institutions/types.ts`) likewise has no parent/branch relationship field.
- The notification service (`packages/backend/notification/src/*`) tracks per-notification delivery status including `'read'` and a `readAt` timestamp, exposed via `GET /notifications/user/:userId` with an optional `status` filter — real data exists, but no unread-count aggregate endpoint exists for a header bell to call cheaply.
- `apps/web/src/lib/branding/previewCookie.ts` is a precedent for a permission-gated, cookie-based preview toggle (`Tenant-Theme-Preview` cookie + `branding:preview` permission unlocking draft branding tokens). It solves a different problem (draft vs. published branding) and is not directly reusable, but establishes that this codebase already has a pattern for "authenticated + permissioned + cookie-scoped preview mode that never affects other users."

## Glossary

The terms below recur throughout the acceptance criteria in this document. Each definition restates only what is already established elsewhere in this document — it introduces no new claims.

- **Additive change (vs. breaking change):** Extending an existing data shape (e.g. `WorkflowApproval`, `TenantSettings`) by adding new fields without altering what's already there; a change that would alter a contract other code already relies on is a breaking change and must be identified explicitly rather than made silently.
- **Affordance:** A UI element (e.g. an icon or link) whose presence signals to the user that an action — such as opening help or notifications — is available.
- **Category/kind (approval taxonomy):** The icon/color classification Requirement 5 wants shown on each pending approval; no such field exists today (approvals currently carry only `definitionName`, `subjectType`, `subjectId`, and `stepName`), so both the field and its allowed values are an open question for the product owner rather than an assumption made in this document.
- **Chrome / dashboard shell:** The persistent header-and-sidebar layout that wraps every page inside the authenticated dashboard area; both terms are used interchangeably in this document.
- **Degrade gracefully / "Currently unavailable" pattern:** When one data source fails, only that section renders "Currently unavailable" (via `.catch(() => null)`) while the rest of the page keeps working, instead of an error blocking or blanking the whole page.
- **KPI card:** One of the summary metric cards on the dashboard home page (Institutions, Students, Staff, Academic period), each showing a headline number and fetched/degraded independently of the others.
- **Open schema question / open question:** A point this document deliberately leaves undecided — such as how a new field or relationship should be modeled — because the answer is a design-phase or product-owner decision, not something to assume while writing requirements.
- **Preview state:** One of the five selectable modes the Requirement 6 switcher can force the dashboard into: Filled, No approvals, Degraded (services down), Loading, and Error; used for demoing/QA and scoped only to the session of the user who set it.
- **Principal role dashboard / role snapshot:** The role-specific metrics panel on the dashboard home page (served by `getRoleDashboard` → `loadDashboardAggregates`); today it shows 4 metrics for principals (enrolment, all-time attendance %, open fee dues count, student count), which Requirement 4 proposes replacing with a different set of 4.
- **RBAC / permission gate:** Role-based access control (`packages/shared/auth/src/rbac.ts`) that decides who can see or use a feature; this document requires it to be enforced server-side, not merely as client-side UI visibility.
- **relationExists() / safe-fallback pattern:** Checking that a database table exists (via `to_regclass`) before querying it, and returning a defined default instead of throwing when it doesn't.
- **RLS (Row-Level Security):** The database-level mechanism (`db/README.md` § Row-Level Security) that enforces the `tenant_isolation` pattern so a query can only return rows belonging to the caller's own tenant.
- **Tenant:** The school/organization account a user belongs to; the session carries a `tenantId`, and data must always stay scoped to that tenant, never shown across tenants.
- **Workflow definition / workflow instance:** A workflow definition is a named approval process template (e.g. `student_transfer`, `staff_leave`); a workflow instance is one running or completed occurrence of that process, tied to a specific record and served by the workflow engine.

## Requirements

### Requirement 1: Sidebar tenant/school context block

**User Story:** As a principal, I want to see which school and tenant I'm operating in directly in the sidebar, so that I have constant confirmation of my working context, especially when I have access to more than one institution.

#### Acceptance Criteria

1. WHEN an authenticated user views any page inside the dashboard shell THEN the system SHALL display a tenant/school identity block in the sidebar showing at minimum the tenant's display name.
2. WHEN the tenant/school identity block is rendered THEN the system SHALL source the display name from real tenant data (e.g. `TenantSettings.displayName`) rather than a hardcoded string.
3. IF the tenant data required to render the identity block is temporarily unavailable THEN the system SHALL degrade gracefully (consistent with the existing `.catch(() => null)` → "Currently unavailable" pattern already used on the dashboard home page) rather than showing a blank block or throwing an error.
4. IF the identity block is to show board/affiliation, region, or a branch/campus count as implied by the mockup THEN the system SHALL treat the underlying schema for these fields as an open design decision, not something this document specifies — no board/affiliation field or branch/campus relationship exists on `TenantSettings` or `Institution` today (confirmed: no `board`, `affiliation`, parent/branch relationship, or campus-count field anywhere in the institution or tenant schemas).
5. WHEN a school-headcount figure is shown in the identity block THEN the system SHALL compute it from real student/enrolment data already exposed to the dashboard (e.g. the same source backing the existing Students KPI card) rather than a new, separately-defined count.
6. WHEN the identity block is rendered for a user scoped to a single institution THEN the system SHALL NOT display data belonging to another tenant, regardless of how the block's data is fetched or cached.

### Requirement 2: Header identity, help, and notifications

**User Story:** As any authenticated user, I want the header to show who I am and give me a visible way to reach help and notifications, so that I don't have to rely on discovering the command palette or guessing what my logged-in identity is.

#### Acceptance Criteria

1. WHEN an authenticated user views the header THEN the system SHALL display the user's real display name and at least one real role/tenant identifier, sourced from session data already available via `getSession()` (`displayName`, `roles[]`, `tenantId`), instead of the current hardcoded "U" avatar with no accompanying text.
2. IF the session's `displayName` is empty or absent THEN the system SHALL fall back to the user's email or another real identifier rather than rendering a blank or placeholder name.
3. WHEN a user activates a help affordance in the header THEN the system SHALL navigate to the existing `/help` page (`apps/web/src/app/(dashboard)/help/page.tsx`), which already exists and is functional — this requirement is about adding a persistent, discoverable entry point in the chrome, not about building new help content.
4. WHEN the header help affordance is added THEN the system SHALL NOT duplicate or fork the existing help content; it SHALL link to the single existing `/help` route.
5. WHEN a user activates a notification affordance in the header THEN the system SHALL display an indication of the user's unread/pending notification count sourced from real notification data.
6. IF no aggregate unread-count endpoint exists at design time (confirmed: the notification service exposes per-notification `status`/`readAt` via `GET /notifications/user/:userId` but no count aggregate) THEN the system SHALL treat the addition of such an endpoint as an explicit backend requirement of this feature, not an assumption to be silently made during implementation — the design phase must decide whether the endpoint is computed on read, cached, or event-driven.
7. WHEN the notification affordance has no unread notifications, or the notification service is unreachable THEN the system SHALL render a defined empty/unavailable state rather than an error or a silently stale count.
8. WHEN header identity data is fetched or displayed THEN the system SHALL only ever show data belonging to the authenticated user's own tenant and session.

### Requirement 3: KPI card descriptive subtext

**User Story:** As a principal, I want each KPI card to show a short explanatory line under the headline number, so that I understand what the number means without navigating away from the dashboard.

#### Acceptance Criteria

1. WHEN the Institutions KPI card is rendered with subtext describing a main-campus/branch breakdown (as shown in the mockup, e.g. "Main campus + 2 branches") THEN the system SHALL treat the underlying branch/campus relationship as an open schema question, because no parent/branch relationship field exists on `Institution` or anywhere in the institution schema today — this document does not specify how that relationship should be modeled.
2. WHEN the Students KPI card is rendered with subtext describing new enrolments within the current term (e.g. "38 new this term") THEN the system SHALL compute this from real, already-available data: student `createdAt` timestamps (`apps/web/src/lib/api/students.ts`) filtered against the active academic period's `startDate`/`endDate` (already fetched on the dashboard home page via `listAcademicPeriods`).
3. WHEN the Staff KPI card is rendered with subtext describing a teaching/non-teaching breakdown (e.g. "71 teaching · 15 non-teaching") THEN the system SHALL NOT infer this classification heuristically from the existing free-text `position` field — `Staff.position` (`apps/web/src/lib/api/staff.ts`) is unstructured free text today, and any teaching/non-teaching split requires an explicit classification field. This document flags the addition of that field as a requirement whose exact shape (boolean, enum, or derived from a role/designation taxonomy) is a design-phase decision.
4. IF a KPI card's subtext data source is unavailable THEN the system SHALL omit or degrade the subtext independently of the card's headline number, consistent with the existing per-card `.catch(() => null)` degradation pattern, rather than hiding the entire card or blocking the page.
5. WHEN subtext requiring a new field (teaching/non-teaching classification) or a new relationship (branch/campus) has not yet been added to the schema THEN the system SHALL render the card without that specific subtext rather than fabricating a plausible-looking number.

### Requirement 4: Principal snapshot metric set

**User Story:** As a principal, I want my dashboard snapshot to show the four metrics that matter most for daily operational awareness (today's attendance, fee collection progress, pending admissions, and open health incidents), so that I can act on what needs attention today.

#### Acceptance Criteria

1. WHEN the principal role dashboard snapshot is rendered THEN the system SHALL display today's attendance percentage, computed from `student_attendance` filtered to the current date — this refines the existing attendance metric in `loadDashboardAggregates` (`packages/backend/report/src/dashboards.ts`), which today computes an all-time present-share rather than a today-specific one.
2. WHEN the principal role dashboard snapshot is rendered THEN the system SHALL display a fee-collection metric expressed as both a collected amount and a percentage, computed from `parent_fee_payments` (which already has `paid_at` and `amount_cents`, confirmed in `db/sql/010_parent_portal_schema.sql`).
3. IF the fee-collection percentage requires a "monthly target" denominator THEN the system SHALL treat the definition and source of that target as an open question, because no collection-target, budget, or quota concept exists anywhere in the fees/finance schema today (confirmed: no `monthlyTarget`/`collectionTarget`/budget field found) — this document does not assume how the target is set (e.g. a fixed configured value, a derived figure from fee-plan totals, or a manually entered goal).
4. WHEN the principal role dashboard snapshot is rendered THEN the system SHALL display a pending-admissions count, computed as the count of admission applications whose `RegistrationStatus` is `pending` or `under_review` (`packages/backend/registration/src/registration-repository.ts`).
5. WHEN the principal role dashboard snapshot is rendered THEN the system SHALL display an open-incidents count for health/nurse incidents.
6. IF no status/open-closed field exists on nurse incident records (confirmed: `NurseIncidentRecord` and the backing `health_nurse_incidents` table have `category`, `severity`, and `notes` only, no status column) THEN the system SHALL treat adding such a field as an explicit requirement of this feature, and the migration behavior for existing rows (i.e., what status pre-existing incidents receive by default) SHALL be decided and documented at design time rather than left implicit.
7. WHEN the principal snapshot metric set changes from its current 4 metrics (enrolment, all-time attendance %, open fee dues count, student count) to the 4 metrics above THEN the system SHALL preserve the existing safe-fallback behavior in `loadDashboardAggregates` — every new aggregate query SHALL check relation existence before querying and fall back to a defined default rather than crashing when the backing table is absent.
8. WHEN any principal snapshot metric's data source is unreachable THEN the system SHALL render that specific metric as unavailable without blocking the rendering of the other three metrics.

### Requirement 5: Approval categorization

**User Story:** As a principal, I want pending approvals to show a visual category (icon and color) so I can scan the list and immediately tell what kind of decision each item needs.

#### Acceptance Criteria

1. WHEN a pending approval is displayed THEN the system SHALL show a category/kind indicator (icon and/or color) derived from a real, defined taxonomy field on the approval — not from ad-hoc string matching against `definitionName` or `subjectType`.
2. IF no category/kind field exists on `WorkflowApproval` or the underlying workflow instance today (confirmed: `WorkflowApproval` has `definitionName`, `subjectType`, `subjectId`, `stepName` only, and `subjectType` is populated directly from `entityType` with no separate categorization layer) THEN the system SHALL treat the addition of that field, and the enumeration of its values, as an open question for the product owner rather than an assumption made during requirements or design.
3. WHEN the category taxonomy is defined THEN the system SHALL derive its values only from workflow definitions and subject types that genuinely exist in the system (e.g. the real `student_transfer` and `staff_leave` definitions confirmed in `apps/api-gateway/src/workflow-ui-seed.ts` and the workflow engine) — the system SHALL NOT introduce categories such as "purchase order" or "scholarship disbursement" unless a corresponding real workflow definition exists or is being created as part of this same effort, and any such gap SHALL be raised as an open question before the taxonomy is finalized.
4. WHEN an approval's category cannot be determined (e.g. an older approval predating the taxonomy, or a workflow definition not mapped to any category) THEN the system SHALL render a defined fallback/uncategorized presentation rather than omitting the approval or erroring.
5. WHEN the approvals panel renders categorized approvals THEN the system SHALL preserve the existing tenant-scoping and role-based visibility already enforced by `listPendingApprovals()` and the engine-backed approvals store.

### Requirement 6: Preview-state switcher (admin-visible, shippable feature)

**User Story:** As a tenant administrator or principal with the appropriate permission, I want to force the dashboard into a specific data state (filled, empty, degraded, loading, or error) for demoing and QA, so that I can verify how the dashboard behaves in each state without waiting for that state to occur naturally, and without risk of affecting real users or other tenants.

#### Acceptance Criteria

1. WHEN a user without the required permission views the dashboard THEN the system SHALL NOT display the preview-state switcher control, and SHALL NOT allow that user's session to be affected by any preview state set by another user.
2. WHEN a user with the required permission activates the preview-state switcher THEN the system SHALL offer exactly five selectable states: Filled, No approvals, Degraded (services down), Loading, and Error.
3. WHEN the "Filled" state is active THEN the system SHALL render the dashboard as if every data source returned a full, populated, successful response (non-empty KPI values, a populated approvals list, a populated role snapshot).
4. WHEN the "No approvals" state is active THEN the system SHALL render the dashboard with all data sources succeeding except the approvals panel, which SHALL render its existing empty state ("All caught up" / no approvals waiting) — this state SHALL NOT be indistinguishable from a genuine service failure.
5. WHEN the "Degraded (services down)" state is active THEN the system SHALL render a defined subset of dashboard sections in their existing "Currently unavailable" / unreachable presentation while leaving at least one section functional, reflecting a partial-outage condition distinct from total failure.
6. WHEN the "Loading" state is active THEN the system SHALL render the dashboard's loading/skeleton presentation and SHALL NOT resolve to a final data state on its own while the preview state remains set to "Loading."
7. WHEN the "Error" state is active THEN the system SHALL render the dashboard's defined error presentation for the affected sections, distinct from both the "Degraded" and "No approvals" presentations.
8. WHEN a preview state is set THEN the system SHALL scope that state to the setting user's own session and tenant, and SHALL NOT alter the dashboard rendering for any other user, session, or tenant — including other administrators within the same tenant who have not themselves activated a preview state.
9. WHEN a preview state has been active for longer than a defined maximum duration THEN the system SHALL automatically expire it and return the dashboard to reflecting real data, so that an administrator cannot leave a real tenant's dashboard permanently stuck in a fabricated state by forgetting to turn it off.
10. WHEN a preview state is active THEN the system SHALL make this fact visibly obvious in the UI to the user who set it, so that the fabricated state is never mistaken for real production data by the person viewing it.
11. WHEN a preview state is active for an administrator THEN the system SHALL NOT cause that state to be visible to, or to affect data returned to, parents, students, teachers, or any other end-user role — the preview mechanism SHALL be strictly confined to the session/context that activated it.
12. WHEN the preview-state control is accessed THEN the system SHALL enforce a role or permission gate on both the ability to see the control and the ability to invoke the underlying state-forcing mechanism — visibility of the control in the UI is not sufficient authorization by itself; the server-side data path SHALL also enforce the same permission.
13. WHEN a preview state is set or cleared THEN the system SHALL make this action attributable (actor, tenant, timestamp) consistent with this repository's existing pattern of auditing administrative actions, given that this mechanism can force a production-capable surface to display fabricated data.

### Requirement 7: Non-functional and cross-cutting constraints

**User Story:** As a platform operator, I want every change made under this spec to uphold the repository's existing tenant-isolation, degradation, and safe-query conventions, so that closing this gap does not introduce a regression in isolation or reliability.

#### Acceptance Criteria

1. WHEN any new field, query, or endpoint is added to satisfy Requirements 1 through 6 THEN the system SHALL scope it to the authenticated caller's tenant, consistent with the existing `withPgTenant` / RLS `tenant_isolation` pattern already used throughout the backend (`db/README.md` § Row-Level Security).
2. WHEN any new dashboard data source is added or an existing one is extended THEN the system SHALL degrade that specific section independently on failure, consistent with the existing per-source `.catch(() => null)` → "Currently unavailable" pattern on `apps/web/src/app/(dashboard)/page.tsx`, rather than allowing one failing source to block or blank the entire page.
3. WHEN any new backend aggregate query is added to `packages/backend/report/src/dashboards.ts` or an equivalent aggregation path THEN the system SHALL check that the backing relation exists (following the existing `relationExists()` / `to_regclass` pattern) before querying it, and SHALL fall back to a defined default rather than throwing when the relation is absent.
4. WHEN the preview-state control (Requirement 6) is implemented THEN the system SHALL enforce RBAC on it using the repository's existing permission model (`packages/shared/auth/src/rbac.ts`), and SHALL NOT rely on client-side visibility alone as an authorization boundary.
5. WHEN any new schema field flagged as an open question in this document (board/affiliation, branch/campus relationship, staff teaching/non-teaching classification, nurse-incident status, approval category/kind) is eventually defined THEN the system SHALL treat that definition as a design-phase decision requiring explicit sign-off, and SHALL NOT have that decision made implicitly by whichever implementation happens to be written first.
6. WHEN existing tests, routes, or consumers depend on the current shape of `WorkflowApproval`, `NurseIncidentRecord`, `TenantSettings`, `DashboardAggregates`, or the principal card set in `DASHBOARDS.principal` THEN the system SHALL extend these shapes additively where possible and SHALL identify any breaking change explicitly, rather than silently altering a contract other code already relies on.
