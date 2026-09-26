# PROCTIRA FIX LEDGER — work one task at a time, update this file

Generated 26 Sep 2026 from `proctira-design/graph/gaps.json` (static UI→API→DB trace) and the `ux-review` blocks in `proctira-design/**/*.html` (high severity only). Claude: read `PROCTIRA_FIX_PROMPT.md` §0–§1 first, then take the **first task whose Status is OPEN**, set it to `IN_PROGRESS`, do the work on branch `fix/<task-id>`, fill **Done-when** with real command output, set Status to `FULLY_CLOSED` / `PARTIAL` / `OPEN (needs decision: …)` / `EXTERNALLY_UNVERIFIED` / `WONT_FIX (reason)`, commit this file with the fix, then take the next. Never edit an Evidence line — it is the audit trail. One task per commit.

## Scoreboard (update after every task — from `node docs/multitenant/trace-graph.mjs . <outDir>`; the original `proctira-design/tools/trace-graph.mjs` path does not exist in this repo, the real script lives at `docs/multitenant/trace-graph.mjs` and is the one actually used for every run below)

| Metric | Baseline 26 Sep 2026 | Latest (after PR #415, tool fix) |
|---|---|---|
| UI calls unresolved | 3 | 1 (`GET /custom-fields`, real — see A1-003) |
| Route handlers in unmounted packages | 117 | 107 (audit's 10 handlers were misreported unmounted; tool bug, not a real gap — see A1-001/A1-002/A2-005) |
| Packages with routes, no persistence | 10 | 10 (unchanged) |
| Orphan tables | 10 | 10 (unchanged) |
| Unused API client functions | 27 | 27 (unchanged) |
| Route handlers never called by UI | 545 | 547 (drift from `main` advancing since the original scan, not from this fix — `api_unused_by_ui`, confirmed via a same-commit run before any ledger change: 550) |

**Note on the "Latest" column above:** the tool itself had 2 parsing bugs (fixed in PR #415, not yet merged as of this entry) that produced false positives specifically in `ui_api_unresolved` and `routes_unmounted` for the `audit` package. Numbers here are from the fixed tool. Once PR #415 merges, re-run and confirm these hold on `main` directly rather than trusting this entry alone.

## A · Wiring gaps (from gaps.json)

### A1 · UI calls with no backend route

### A1-001 · `PUT /audit-logs/retention` has no route
- **Status:** WONT_FIX (stale finding — route exists and works; the gap-scan tool had a parsing bug, now fixed)
- **Evidence:** gaps.ui_api_unresolved → PUT /audit-logs/retention
- **Detail:** Called by `saveAuditRetention()` in `apps/web/src/lib/api/platform.server.ts`.
- **How to close:** Find the intended handler (grep the tail segment in packages/backend and apps/api-gateway). If the package is unmounted → mount it (see A2). If the path differs → fix the server path to the documented contract, add a route test, re-run trace.
- **Done-when:** Root cause: `docs/multitenant/trace-graph.mjs`'s `explicitMounts` parser had two bugs (unbounded lazy regex crossing statement boundaries + a second map never populated from it) that caused it to misread `auditPlugin`'s real gateway prefix. `auditPlugin` is genuinely mounted at `/api/v1/audit-logs` (`apps/api-gateway/src/app.ts:787-790`, comment explicitly notes this prefix was chosen to avoid clashing with a platform-admin stub at `/api/v1/audit`). Verified live, not just by reading code — `app.inject()` against the real built gateway (temporary test file, run then deleted, not committed): `PUT /api/v1/audit-logs/retention` → `200 {"tenantId":"...","retentionMonths":24,"archivalEnabled":false,...}`, config persisted and read back correctly on a follow-up `GET`. Tool fix: PR #415 (`chore/trace-graph-explicit-mounts-fix`, commit `3af2ebbb`). Trace metrics before → after (full repo re-run): `ui_api_unresolved` 3 → 1, `routes_unmounted` 117 → 107, `routeHandlers` unchanged at 974 (no real handler added/removed, only the resolved path corrected), `resolvedCalls` 345 → 347. No code change was needed or made for this task itself — see A2-005, since the same tool bug also mis-flagged the whole `audit` package as unmounted.

### A1-002 · `POST /audit-logs/archival/execute` has no route
- **Status:** WONT_FIX (stale finding — route exists and works; the gap-scan tool had a parsing bug, now fixed)
- **Evidence:** gaps.ui_api_unresolved → POST /audit-logs/archival/execute
- **Detail:** Called by `runAuditArchival()` in `apps/web/src/lib/api/platform.server.ts`.
- **How to close:** Find the intended handler (grep the tail segment in packages/backend and apps/api-gateway). If the package is unmounted → mount it (see A2). If the path differs → fix the server path to the documented contract, add a route test, re-run trace.
- **Done-when:** Same root cause and tool fix as A1-001 (PR #415, commit `3af2ebbb`) — one investigation covered both, since both are `auditPlugin` routes affected by the same mis-parsed mount prefix. Verified live: after setting retention with `archivalEnabled: true, archivalDestination: 's3://test-bucket'` via the `PUT` above, `POST /api/v1/audit-logs/archival/execute` → `200 {"archivedCount":0,"cutoffDate":"...","destination":"s3://test-bucket","executedAt":"..."}`. Trace metrics: same before → after figures as A1-001 (this task didn't move the numbers independently; the fix and re-run cover both entries in `ui_api_unresolved` at once). No application code change was needed.

### A1-003 · `GET /custom-fields` has no route
- **Status:** OPEN (needs decision: mount with a new Postgres schema, redirect the client to an existing endpoint, or continue parking — this is a real, confirmed gap, not a tool artifact, and closing it properly is a larger change than a wiring fix)
- **Evidence:** gaps.ui_api_unresolved → GET /custom-fields
- **Detail:** Called by `getStudentCustomFields()` in `apps/web/src/lib/api/students.ts`. Client already degrades gracefully today (`result.ok && result.data ? ... : []`) rather than erroring, so this is a silent empty-list gap in production, not a visible crash.
- **How to close:** Find the intended handler (grep the tail segment in packages/backend and apps/api-gateway). If the package is unmounted → mount it (see A2). If the path differs → fix the server path to the documented contract, add a route test, re-run trace.
- **Done-when:** Verified as a REAL gap, not a stale tool finding, using the same standard applied to A1-001/A1-002 — `app.inject()` against the real built gateway (temporary test file, run then deleted): `GET /api/v1/custom-fields?entityType=student&isActive=true&pageSize=100` → `404 {"code":"NOT_FOUND","message":"Route not found",...}`. Confirmed no registration exists anywhere (`grep` across `apps/api-gateway/src/app.ts` and `domain-plugins.ts` for `custom-field`/`customField`: zero matches). `apps/api-gateway/src/mount-matrix.ts:454-462` already documents this as a deliberate park: `parkedReason: "P0-01 PARKED — no durable Postgres schema or repository exists. The prior unconditional registrar made every DATABASE_URL-backed gateway fail during startup."` `packages/backend/custom-field/src/create-custom-field-repositories.ts` confirms the package fails closed when `DATABASE_URL` is set (`assertPostgresRepositoryAvailable('custom-field', null)` — always refuses, no fake Pg adapter exists) rather than silently degrading to in-memory in production. `db/sql/` has no `custom_field_definitions`/`custom_field_values` schema; the only `custom_fields` hit anywhere in `db/sql` is an unrelated JSONB column on `admission_applications`. Closing this properly needs a new migration + a real Postgres repository (this is A4's scope, not a same-PR wiring fix per this task's own "if the package is unmounted → mount it (see A2)" instruction) — escalating per rule 4 (design decision required) rather than guessing at schema shape.

### A2 · Packages with route handlers never mounted in the gateway

### A2-004 · Disposition package `admin-dashboard` (4 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=admin-dashboard
- **Detail:** Handlers: GET ${prefix}/cache (scalability-routes.ts); GET ${prefix}/queue (scalability-routes.ts); GET ${prefix}/health (scalability-routes.ts); POST ${prefix}/cache/flush (scalability-routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-005 · Disposition package `audit` (10 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=audit
- **Detail:** Handlers: POST ${prefix} (routes.ts); POST ${prefix}/batch (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/retention (routes.ts); PUT ${prefix}/retention (routes.ts); POST ${prefix}/archival/execute (routes.ts); GET ${prefix}/archival/candidates (routes.ts); GET ${prefix}/chain/verify (routes.ts); GET ${prefix}/dsar/:subjectId (routes.ts); GET ${prefix}/:id (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-006 · Disposition package `custom-field` (8 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=custom-field
- **Detail:** Handlers: POST ${prefix}/definitions (routes.ts); PUT ${prefix}/definitions/:id (routes.ts); GET ${prefix}/definitions (routes.ts); GET ${prefix}/definitions/:id (routes.ts); DELETE ${prefix}/definitions/:id (routes.ts); PUT ${prefix}/values/:entityType/:entityId (routes.ts); GET ${prefix}/values/:entityType/:entityId (routes.ts); DELETE ${prefix}/values/:entityType/:entityId (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-007 · Disposition package `dashboards` (6 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=dashboards
- **Detail:** Handlers: GET ${prefix}/country (routes.ts); GET ${prefix}/state/:stateId (routes.ts); GET ${prefix}/board-admin/:boardId (routes.ts); GET ${prefix}/school/:institutionId (routes.ts); GET ${prefix}/teacher (routes.ts); GET ${prefix}/me (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-008 · Disposition package `data-warehouse` (17 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=data-warehouse
- **Detail:** Handlers: POST ${prefix} (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/:warehouseId (routes.ts); PUT ${prefix}/:warehouseId (routes.ts); DELETE ${prefix}/:warehouseId (routes.ts); POST ${prefix}/:warehouseId/indicators (routes.ts); GET ${prefix}/:warehouseId/indicators (routes.ts); POST ${prefix}/:warehouseId/units (routes.ts); GET ${prefix}/:warehouseId/units (routes.ts); POST ${prefix}/:warehouseId/subgroups (routes.ts); GET ${prefix}/:warehouseId/subgroups (routes.ts); POST ${prefix}/:warehouseId/time-periods (routes.ts) …
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-009 · Disposition package `install` (8 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=install
- **Detail:** Handlers: GET /status (install-plugin.ts); POST /configure/cdn (install-plugin.ts); POST /configure/database (install-plugin.ts); POST /configure/storage (install-plugin.ts); POST /configure/cache (install-plugin.ts); POST /configure/queue (install-plugin.ts); POST /finalize (install-plugin.ts); GET /health (install-plugin.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-010 · Disposition package `plugin` (9 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=plugin
- **Detail:** Handlers: POST ${prefix} (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/:pluginId (routes.ts); POST ${prefix}/install (routes.ts); GET ${prefix}/installations (routes.ts); GET ${prefix}/installations/:installId (routes.ts); POST ${prefix}/installations/:installId/enable (routes.ts); POST ${prefix}/installations/:installId/disable (routes.ts); POST ${prefix}/installations/:installId/uninstall (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-011 · Disposition package `policy` (11 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=policy
- **Detail:** Handlers: POST ${prefix} (routes.ts); PUT ${prefix}/:id (routes.ts); POST ${prefix}/:id/activate (routes.ts); POST ${prefix}/:id/deactivate (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/:id (routes.ts); GET ${prefix}/:id/versions (routes.ts); POST ${prefix}/evaluate (routes.ts); POST ${prefix}/:id/assignments (routes.ts); GET ${prefix}/:id/assignments (routes.ts); DELETE ${prefix}/:id/assignments/:assignmentId (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-012 · Disposition package `survey` (10 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=survey
- **Detail:** Handlers: POST ${prefix} (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/:id (routes.ts); PUT ${prefix}/:id (routes.ts); DELETE ${prefix}/:id (routes.ts); POST ${prefix}/distribute (routes.ts); GET ${prefix}/:id/status (routes.ts); POST ${prefix}/:id/remind (routes.ts); POST ${prefix}/submit (routes.ts); GET ${prefix}/:id/aggregate (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A2-013 · Disposition package `theme` (9 handlers)
- **Status:** OPEN
- **Evidence:** gaps.routes_unmounted → pkg=theme
- **Detail:** Handlers: POST ${prefix} (routes.ts); GET ${prefix} (routes.ts); GET ${prefix}/tokens (routes.ts); GET ${prefix}/:themeId (routes.ts); PUT ${prefix}/:themeId (routes.ts); POST ${prefix}/:themeId/publish (routes.ts); POST ${prefix}/:themeId/rollback (routes.ts); GET ${prefix}/:themeId/preview (routes.ts); GET ${prefix}/:themeId/revisions (routes.ts)
- **How to close:** Write disposition in docs/audits/UNMOUNTED_PACKAGES.md: MOUNT (add registrar in apps/api-gateway/src/domain-plugins.ts + mount test + authz test), SUPERSEDED (name the gateway *-ui-plugin that serves the UI; mark package README deprecated), or PARK (owner + wave). Do not delete code.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3 · Packages exposing routes with no SQL/Prisma persistence

### A3-014 · Persistence for `admin-dashboard`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → admin-dashboard
- **Detail:** In-memory repository: no repository at all.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-015 · Persistence for `billing`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → billing
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-016 · Persistence for `custom-field`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → custom-field
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-017 · Persistence for `dashboards`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → dashboards
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-018 · Persistence for `data-warehouse`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → data-warehouse
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-019 · Persistence for `install`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → install
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-020 · Persistence for `plugin`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → plugin
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-021 · Persistence for `policy`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → policy
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-022 · Persistence for `survey`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → survey
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A3-023 · Persistence for `theme`
- **Status:** OPEN
- **Evidence:** gaps.pkg_without_persistence → theme
- **Detail:** In-memory repository: yes.
- **How to close:** Only if the A2 disposition is MOUNT (or the package is already mounted, e.g. billing): implement a pg repository over the existing db/sql tables (or write a new migration with tenant FK + RLS copied from 015_rls_policies.sql), wire it via the create*Repository() factory, add an integration test that round-trips one record, update the persistence comment block in domain-plugins.ts.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4 · Tables defined in db/sql that no backend code references

### A4-024 · Orphan table `schema_migrations`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → schema_migrations
- **Detail:** Defined in `db/sql/021_wave7_integrity_schema.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-025 · Orphan table `control_plane_documents`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → control_plane_documents
- **Detail:** Defined in `db/sql/022_control_plane_schema.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-026 · Orphan table `report_definitions`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → report_definitions
- **Detail:** Defined in `db/sql/037_reports_schema.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-027 · Orphan table `transactional_outbox`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → transactional_outbox
- **Detail:** Defined in `db/sql/056_transactional_outbox_schema.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-028 · Orphan table `staff_payroll_lines`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → staff_payroll_lines
- **Detail:** Defined in `db/sql/062_staff_payroll_posting.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-029 · Orphan table `staff_payroll_ledger_entries`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → staff_payroll_ledger_entries
- **Detail:** Defined in `db/sql/062_staff_payroll_posting.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-030 · Orphan table `student_merges`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → student_merges
- **Detail:** Defined in `db/sql/063_student_merge_registry.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-031 · Orphan table `search_index_documents`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → search_index_documents
- **Detail:** Defined in `db/sql/065_search_index_schema.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-032 · Orphan table `transcript_signing_keys`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → transcript_signing_keys
- **Detail:** Defined in `db/sql/076_transcript_authenticity_complete.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A4-033 · Orphan table `grade_change_audit_orphan_quarantine`
- **Status:** OPEN
- **Evidence:** gaps.orphan_tables → grade_change_audit_orphan_quarantine
- **Detail:** Defined in `db/sql/096_w1_data_14_audit_fk_integrity.sql`.
- **How to close:** Read the migration header/ticket. Either wire the first consumer (repository + test) or record in docs/audits/SCHEMA_AHEAD_OF_CODE.md with owner and target wave. `schema_migrations` is infrastructure → WONT_FIX (expected).
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5 · API client functions no page uses

### A5-034 · Unused client fn `recordHighRiskAuditEvent`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → recordHighRiskAuditEvent
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-035 · Unused client fn `createRole`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → createRole
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-036 · Unused client fn `updateRolePermissions`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → updateRolePermissions
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-037 · Unused client fn `deleteRole`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → deleteRole
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-038 · Unused client fn `assignRolesToUser`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → assignRolesToUser
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-039 · Unused client fn `permissionKey`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → permissionKey
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-040 · Unused client fn `roleHasPermission`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → roleHasPermission
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-041 · Unused client fn `togglePermission`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → togglePermission
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-042 · Unused client fn `getTenantGeneralSettings`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → getTenantGeneralSettings
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-043 · Unused client fn `updateTenantGeneralSettings`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → updateTenantGeneralSettings
- **Detail:** In `apps/web/src/lib/api/admin.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-044 · Unused client fn `listAuditEntries`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → listAuditEntries
- **Detail:** In `apps/web/src/lib/api/audit.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-045 · Unused client fn `getAuditEntry`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → getAuditEntry
- **Detail:** In `apps/web/src/lib/api/audit.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-046 · Unused client fn `listAuditEntityTypes`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → listAuditEntityTypes
- **Detail:** In `apps/web/src/lib/api/audit.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-047 · Unused client fn `mapCountryAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapCountryAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-048 · Unused client fn `mapStateAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapStateAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-049 · Unused client fn `mapBoardAdminAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapBoardAdminAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-050 · Unused client fn `mapSchoolAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapSchoolAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-051 · Unused client fn `mapTeacherAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapTeacherAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-052 · Unused client fn `mapParentStudentAggregate`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → mapParentStudentAggregate
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-053 · Unused client fn `fetchCountryDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchCountryDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-054 · Unused client fn `fetchStateDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchStateDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-055 · Unused client fn `fetchBoardAdminDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchBoardAdminDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-056 · Unused client fn `fetchSchoolDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchSchoolDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-057 · Unused client fn `fetchTeacherDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchTeacherDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-058 · Unused client fn `fetchParentStudentDashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchParentStudentDashboard
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-059 · Unused client fn `fetchBoardComparison`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchBoardComparison
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A5-060 · Unused client fn `fetchCrossBoardTransfer`
- **Status:** OPEN
- **Evidence:** gaps.api_fn_unused → fetchCrossBoardTransfer
- **Detail:** In `apps/web/src/lib/api/dashboards.ts`.
- **How to close:** grep for callers in apps/*, tests, actions and apps/mobile. If none: delete the function and its types; if a page should use it: wire it. Re-run trace.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6 · Route handlers never called by the web UI (one task per package)

### A6-061 · Review 43 uncalled handlers in `api-gateway`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=api-gateway
- **Detail:** DELETE /Users/:id; DELETE /tenants/:id; GET /*; GET /Groups; GET /Groups/:id; GET /ResourceTypes; GET /Schemas; GET /ServiceProviderConfig; GET /Users; GET /Users/:id; GET /deprecated-example; GET /deprecation-policy; GET /error-codes; GET /health; GET /health/live; GET /health/ready; GET /health/records; GET /providers/capabilities; GET /reports/board/:boardId/summary; GET /services …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-062 · Review 38 uncalled handlers in `health`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=health
- **Detail:** DELETE /health/allergies/:id; DELETE /health/conditions/:id; DELETE /health/insurance/:id; DELETE /health/measurements/:id; DELETE /health/screening-programs/:id; DELETE /health/vaccinations/:id; GET /health/break-glass; GET /health/conditions/student/:studentId; GET /health/counselling/sessions/student/:studentId; GET /health/dsar/:studentId; GET /health/insurance/student/:studentId; GET /health/measurements/student/:studentId; GET /health/screening-programs; GET /health/screening-programs/:id; GET /health/special-needs/accommodation-plans/student/:studentId; GET /health/special-needs/assessments/student/:studentId; GET /health/special-needs/diagnoses/student/:studentId; GET /health/special-needs/referrals/student/:studentId; POST /health/break-glass; POST /health/break-glass/:id/approve …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-063 · Review 34 uncalled handlers in `developer-portal`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=developer-portal
- **Detail:** DELETE /developer/accounts/:accountId/keys/:keyId; DELETE /developer/accounts/:accountId/sandboxes/:sandboxId; DELETE /developer/accounts/:accountId/webhooks/:webhookId; DELETE /developer/docs/:slug; GET /developer/accounts/:accountId; GET /developer/accounts/:accountId/keys; GET /developer/accounts/:accountId/sandboxes; GET /developer/accounts/:accountId/submissions; GET /developer/accounts/:accountId/webhooks; GET /developer/accounts/:accountId/webhooks/:webhookId; GET /developer/accounts/:accountId/webhooks/:webhookId/deliveries; GET /developer/analytics/:pluginName; GET /developer/docs; GET /developer/docs/:slug; GET /developer/marketplace; GET /developer/marketplace/:pluginName; GET /developer/submissions/:submissionId; PATCH /developer/accounts/:accountId; PATCH /developer/accounts/:accountId/webhooks/:webhookId; PATCH /developer/docs/:slug …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-064 · Review 34 uncalled handlers in `transport`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=transport
- **Detail:** DELETE /transport/routes/:id; DELETE /transport/stops/:id; DELETE /transport/vehicles/:id; GET /transport/alert-rules; GET /transport/alerts; GET /transport/attendance; GET /transport/attendance-on-bus; GET /transport/fee-links; GET /transport/fee-structures; GET /transport/live; GET /transport/routes; GET /transport/routes/:id; GET /transport/routes/:routeId/stops; GET /transport/stops; GET /transport/vehicles; GET /transport/vehicles/:id; GET /transport/vehicles/:vehicleId/gps; POST /transport/alert-rules; POST /transport/alerts/:id/acknowledge; POST /transport/alerts/evaluate …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-065 · Review 31 uncalled handlers in `institution`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=institution
- **Detail:** DELETE /institution-subjects/:id; DELETE /institutions/:id/calendar/:eventId; DELETE /institutions/condition-options/:id; DELETE /subjects/:id; GET /institution-subjects; GET /institutions/:areaId/descendants; GET /institutions/:areaId/institutions; GET /institutions/:id/calendar; GET /institutions/buildings; GET /institutions/condition-options; GET /institutions/floors; GET /institutions/health; GET /institutions/lands; GET /institutions/ready; GET /institutions/rooms; GET /institutions/tree; GET /subjects; GET /subjects/:id; POST /institution-subjects; POST /institutions/:areaId/move …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-066 · Review 31 uncalled handlers in `report`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=report
- **Detail:** DELETE /reports/schedules/:scheduleId; DELETE /reports/templates/:templateId; GET /reports/artifacts/:id; GET /reports/artifacts/:id/download; GET /reports/catalogue; GET /reports/dashboard; GET /reports/health; GET /reports/jobs; GET /reports/jobs/:jobId; GET /reports/jobs/:jobId/download; GET /reports/ready; GET /reports/runs; GET /reports/schedules; GET /reports/schedules/:scheduleId; GET /reports/templates; GET /reports/templates/:id; GET /reports/templates/:templateId; PATCH /reports/schedules/:scheduleId; POST /reports/generate; POST /reports/jobs/:jobId/cancel …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-067 · Review 24 uncalled handlers in `auth`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=auth
- **Detail:** GET /api/v1/auth/callback; GET /api/v1/auth/login; GET /api/v1/auth/logout; GET /api/v1/auth/me; GET /api/v1/auth/roles; GET /api/v1/auth/tenants; GET /api/v1/auth/ticket; GET /auth/external/:providerId/callback; GET /auth/external/:providerId/login; GET /auth/external/providers; GET /auth/me; GET /tenants/mine; POST /admin/users/invite; POST /api/v1/auth/password; POST /api/v1/auth/refresh; POST /auth/external/:providerId/callback; POST /auth/login; POST /auth/logout; POST /auth/mfa/otp/resend; POST /auth/mfa/otp/send …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-068 · Review 24 uncalled handlers in `tenant`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=tenant
- **Detail:** DELETE /tenant/branding/draft; DELETE /tenants/:id; DELETE /tenants/:id/domains/:domainId; GET /tenant/branding; GET /tenant/branding/active; GET /tenant/branding/draft; GET /tenant/branding/versions; GET /tenant/permissions; GET /tenants; GET /tenants/:id; GET /tenants/:id/config; GET /tenants/:id/domains; GET /tenants/:id/usage; PATCH /tenant/roles/:id/permissions; POST /tenant/branding/draft; POST /tenant/branding/publish; POST /tenant/branding/rollback; POST /tenants; POST /tenants/:id/decommission; POST /tenants/:id/domains …
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-069 · Review 17 uncalled handlers in `billing`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=billing
- **Detail:** GET /billing/plans; GET /billing/plans/:id; GET /billing/protected; GET /billing/subscriptions/:id; POST /billing/entitlements/check; POST /billing/plans; POST /billing/students; POST /billing/subscriptions; POST /billing/subscriptions/:id/activate; POST /billing/subscriptions/:id/cancel; POST /billing/subscriptions/:id/downgrade; POST /billing/subscriptions/:id/reactivate; POST /billing/subscriptions/:id/suspend; POST /billing/subscriptions/:id/upgrade; POST /billing/usage/query; POST /billing/usage/record; PUT /billing/plans/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-070 · Review 17 uncalled handlers in `data-warehouse`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=data-warehouse
- **Detail:** DELETE /warehouses/:warehouseId; GET /warehouses; GET /warehouses/:warehouseId; GET /warehouses/:warehouseId/areas; GET /warehouses/:warehouseId/indicators; GET /warehouses/:warehouseId/subgroups; GET /warehouses/:warehouseId/time-periods; GET /warehouses/:warehouseId/units; POST /warehouses; POST /warehouses/:warehouseId/areas; POST /warehouses/:warehouseId/import; POST /warehouses/:warehouseId/indicators; POST /warehouses/:warehouseId/query; POST /warehouses/:warehouseId/subgroups; POST /warehouses/:warehouseId/time-periods; POST /warehouses/:warehouseId/units; PUT /warehouses/:warehouseId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-071 · Review 17 uncalled handlers in `fees`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=fees
- **Detail:** GET /fees/invoices; GET /fees/invoices/:id/ledger; GET /fees/ledger/trial-balance; GET /fees/payments; GET /fees/plans; GET /fees/receipts; GET /fees/receipts/:id; POST /fees/concessions/:id/approve; POST /fees/concessions/:id/reject; POST /fees/invoices; POST /fees/invoices/:id/credit-notes; POST /fees/invoices/:id/void; POST /fees/invoices/:id/write-offs; POST /fees/payments; POST /fees/plans; POST /fees/reconciliation/import; POST /fees/structures/clone-period
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-072 · Review 17 uncalled handlers in `scholarship`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=scholarship
- **Detail:** DELETE /scholarships/programs/:id; GET /scholarships/applications; GET /scholarships/applications/:id; GET /scholarships/applications/:id/compliance; GET /scholarships/applications/:id/disbursements; GET /scholarships/disbursements; GET /scholarships/programs; GET /scholarships/programs/:id; GET /scholarships/reports/utilization; POST /scholarships/applications; POST /scholarships/applications/:id/approve; POST /scholarships/applications/:id/reject; POST /scholarships/compliance; POST /scholarships/disbursements; POST /scholarships/programs; PUT /scholarships/disbursements/:id; PUT /scholarships/programs/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-073 · Review 16 uncalled handlers in `privacy`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=privacy
- **Detail:** GET /privacy/correction-requests; GET /privacy/correction-requests/:id; GET /privacy/erasure-requests; GET /privacy/erasure-requests/:id; GET /privacy/legal-holds; GET /privacy/tenant-offboard; GET /privacy/tenant-offboard/:id; POST /privacy/correction-requests; POST /privacy/correction-requests/:id/apply; POST /privacy/correction-requests/:id/transition; POST /privacy/erasure-requests; POST /privacy/erasure-requests/:id/execute; POST /privacy/erasure-requests/:id/transition; POST /privacy/legal-holds; POST /privacy/legal-holds/:id/release; POST /privacy/tenant-offboard
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-074 · Review 15 uncalled handlers in `assessment`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=assessment
- **Detail:** DELETE /report-cards/templates/:id; GET /assessments/health; GET /assessments/ready; GET /report-cards/comments; GET /report-cards/jobs/:jobId; GET /report-cards/jobs/:jobId/download; GET /report-cards/templates; GET /report-cards/templates/:id; POST /report-cards/comments; POST /report-cards/generate; POST /report-cards/generate/bulk; POST /report-cards/jobs/:jobId/process; POST /report-cards/templates; POST /results; PUT /report-cards/templates/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-075 · Review 13 uncalled handlers in `staff`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=staff
- **Detail:** GET /staff/:id/offboard; GET /staff/certifications/:certificationId; GET /staff/contracts/:id; GET /staff/programs/:programId; GET /staff/programs/:programId/sessions; GET /staff/sessions/:sessionId; GET /staff/sessions/:sessionId/attendance; PATCH /staff/contracts/:id; POST /staff/:id/offboard; POST /staff/:id/submit; POST /staff/certifications/process-expiry; POST /staff/sessions; PUT /staff/programs/:programId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-076 · Review 13 uncalled handlers in `workflow`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=workflow
- **Detail:** GET /workflow-engine; GET /workflow-engine/:caseId; GET /workflow-engine/health; GET /workflow-engine/instances/:instanceId; GET /workflow-engine/instances/:instanceId/audit; GET /workflow-engine/ready; POST /workflow-engine; POST /workflow-engine/:caseId/attachments; POST /workflow-engine/:caseId/resolve; POST /workflow-engine/instances/:instanceId/transition; PUT /workflow-engine/:caseId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-077 · Review 11 uncalled handlers in `policy`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=policy
- **Detail:** DELETE /policies/:id/assignments/:assignmentId; GET /policies; GET /policies/:id; GET /policies/:id/assignments; GET /policies/:id/versions; POST /policies; POST /policies/:id/activate; POST /policies/:id/assignments; POST /policies/:id/deactivate; POST /policies/evaluate; PUT /policies/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-078 · Review 10 uncalled handlers in `audit`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=audit
- **Detail:** GET /audit; GET /audit/:id; GET /audit/archival/candidates; GET /audit/chain/verify; GET /audit/dsar/:subjectId; GET /audit/retention; POST /audit; POST /audit/archival/execute; POST /audit/batch; PUT /audit/retention
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-079 · Review 10 uncalled handlers in `lms`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=lms
- **Detail:** GET /lms/bank/:id; GET /lms/content/:id; GET /lms/files/:id/download; GET /lms/modules; GET /lms/submissions; GET /lms/submissions/:id; POST /lms/assignments/:id/from-bank; POST /lms/files/:id/signed-download; POST /lms/modules; POST /lms/modules/:id/items
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-080 · Review 10 uncalled handlers in `notification`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=notification
- **Detail:** DELETE /notifications/devices/:deviceId; GET /notifications/delivery-capabilities; GET /notifications/devices; GET /notifications/health; GET /notifications/preferences; GET /notifications/ready; PATCH /notifications/preferences; POST /notifications/:notificationId/read; POST /notifications/devices; POST /notifications/send
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-081 · Review 10 uncalled handlers in `survey`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=survey
- **Detail:** DELETE /surveys/:id; GET /surveys; GET /surveys/:id; GET /surveys/:id/aggregate; GET /surveys/:id/status; POST /surveys; POST /surveys/:id/remind; POST /surveys/distribute; POST /surveys/submit; PUT /surveys/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-082 · Review 10 uncalled handlers in `timetable`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=timetable
- **Detail:** DELETE /timetable/bell-schedules/:id; DELETE /timetable/meetings/:id; DELETE /timetable/periods/:id; GET /timetable/bell-schedules/:id; GET /timetable/generation-jobs/:id; POST /timetable/clone-period; POST /timetable/sections/:id/enrollments/bulk; PUT /timetable/bell-schedules/:id; PUT /timetable/meetings/:id; PUT /timetable/periods/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-083 · Review 9 uncalled handlers in `gradebook`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=gradebook
- **Detail:** DELETE /gradebook/comments-bank/:id; GET /gradebook/audits; GET /gradebook/board-exports/:id/download; GET /gradebook/report-cards/:id; GET /gradebook/transcripts/:id; GET /gradebook/transcripts/:id/download; POST /gradebook/board-exports/:id/process; POST /gradebook/board-exports/:id/signed-download; PUT /gradebook/comments-bank/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-084 · Review 9 uncalled handlers in `plugin`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=plugin
- **Detail:** GET /plugins; GET /plugins/:pluginId; GET /plugins/installations; GET /plugins/installations/:installId; POST /plugins; POST /plugins/install; POST /plugins/installations/:installId/disable; POST /plugins/installations/:installId/enable; POST /plugins/installations/:installId/uninstall
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-085 · Review 9 uncalled handlers in `theme`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=theme
- **Detail:** GET /themes; GET /themes/:themeId; GET /themes/:themeId/preview; GET /themes/:themeId/revisions; GET /themes/tokens; POST /themes; POST /themes/:themeId/publish; POST /themes/:themeId/rollback; PUT /themes/:themeId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-086 · Review 8 uncalled handlers in `attendance`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=attendance
- **Detail:** GET /attendance/audit/:attendanceId; GET /attendance/health; GET /attendance/ready; GET /attendance/threshold-check; POST /attendance/devices; POST /attendance/ingest; POST /attendance/staff; POST /attendance/student
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-087 · Review 8 uncalled handlers in `custom-field`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=custom-field
- **Detail:** DELETE /custom-fields/definitions/:id; DELETE /custom-fields/values/:entityType/:entityId; GET /custom-fields/definitions; GET /custom-fields/definitions/:id; GET /custom-fields/values/:entityType/:entityId; POST /custom-fields/definitions; PUT /custom-fields/definitions/:id; PUT /custom-fields/values/:entityType/:entityId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-088 · Review 8 uncalled handlers in `install`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=install
- **Detail:** GET /health; GET /status; POST /configure/cache; POST /configure/cdn; POST /configure/database; POST /configure/queue; POST /configure/storage; POST /finalize
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-089 · Review 7 uncalled handlers in `examination`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=examination
- **Detail:** DELETE /examinations/:id/sessions/:sessionId; DELETE /examinations/:id/sessions/:sessionId/invigilators/:allocationId; GET /examinations/:examinationId/documents/jobs/:jobId; GET /examinations/:examinationId/documents/jobs/:jobId/download; GET /examinations/:examinationId/results/analysis; POST /examinations/:examinationId/results/analysis; POST /examinations/:id/reevaluations/:requestId/reject
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-090 · Review 7 uncalled handlers in `parent-portal`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=parent-portal
- **Detail:** GET /parent-portal/children/:studentId/:param; GET /parent-portal/consents/:id/history; GET /parent-portal/fees/receipts/:id; GET /student-portal/me/:param; POST /parent-portal/consents/:id/supersede; POST /parent-portal/consents/:id/withdraw; POST /parent-portal/fees/invoices/:id/void
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-091 · Review 7 uncalled handlers in `registration`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=registration
- **Detail:** GET /registrations/form-config/:institutionId; GET /registrations/institutions; GET /registrations/language; GET /registrations/schools/search; PATCH /registrations/applications/:id/placement; POST /registrations; POST /registrations/language
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-092 · Review 6 uncalled handlers in `dashboards`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=dashboards
- **Detail:** GET /dashboards/board-admin/:boardId; GET /dashboards/country; GET /dashboards/me; GET /dashboards/school/:institutionId; GET /dashboards/state/:stateId; GET /dashboards/teacher
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-093 · Review 6 uncalled handlers in `etl`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=etl
- **Detail:** DELETE /pipelines/:pipelineId; GET /pipelines/:pipelineId; GET /pipelines/:pipelineId/executions; GET /pipelines/:pipelineId/executions/:executionId; POST /pipelines/:pipelineId/execute; PUT /pipelines/:pipelineId
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-094 · Review 5 uncalled handlers in `library`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=library
- **Detail:** GET /library/copies/by-barcode; GET /library/fines/policy; GET /library/fines/summary; POST /library/holds/:id/cancel; PUT /library/fines/policy
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-095 · Review 5 uncalled handlers in `student`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=student
- **Detail:** DELETE /students/:id/documents/:docId; GET /students/:id/documents/:docId; GET /students/certificates/verify; POST /students/certificates/:id/revoke; POST /students/merge
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-096 · Review 4 uncalled handlers in `admin-dashboard`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=admin-dashboard
- **Detail:** GET /api/v1/admin/scalability/cache; GET /api/v1/admin/scalability/health; GET /api/v1/admin/scalability/queue; POST /api/v1/admin/scalability/cache/flush
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-097 · Review 1 uncalled handlers in `communication`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=communication
- **Detail:** GET /communication/campaigns/:id
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A6-098 · Review 1 uncalled handlers in `hostel`
- **Status:** OPEN
- **Evidence:** gaps.api_unused_by_ui → pkg=hostel
- **Detail:** GET /hostel/fee-structures/summary
- **How to close:** Classify each handler: MOBILE (called from apps/mobile — cite the Dio call), INTERNAL (jobs/webhooks/other packages — cite caller), UI-MISSING (feature exists, no screen → open a UI ticket), DEAD (no caller anywhere → delete with tests). Record the table in docs/audits/UNCALLED_ROUTES.md. Delete only DEAD ones, one PR per package.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### A7 · Pages that call no API (informational — confirm each is a hub/marketing/redirect page; if not, add a task)

`web:/forgot-password`, `web:/logout`, `web:/mfa`, `web:/mfa/setup`, `web:/oauth/callback`, `web:/reset-password`, `web:/help`, `web:/institutions/[id]`, `web:/reports/dashboards`, `web:/students/enroll`, `web:/auth/mfa-setup`, `web:/legal/privacy`, `web:/legal/terms`, `admin-console:/forbidden`, `admin-console:/login`, `registration-portal:/apply/[institutionType]/documents`, `registration-portal:/apply/[institutionType]`, `registration-portal:/apply/[institutionType]/review`, `registration-portal:/apply/success`, `registration-portal:/`, `registration-portal:/schools`, `registration-portal:/track/[trackingNumber]`, `registration-portal:/track`, `public-website:/about`, `public-website:/compliance`, `public-website:/contact`, `public-website:/cookies`, `public-website:/installation`, `public-website:/legal`, `public-website:/`, `public-website:/privacy`, `public-website:/product`, `public-website:/security`, `public-website:/status`, `public-website:/terms`, `developer-portal:/dashboard`, `developer-portal:/docs`, `developer-portal:/marketplace`, `developer-portal:/`, `install-wizard:/`

## B · High-severity UX defects found in code (one task per observation, grouped by module)

### B · mobile (29)

### B-099 · `mobile://features/assessment_results` — Screen is read-only but Home labels it "Marks entry" and "Enter unit test & CCE…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/assessment/presentation/assessment_results_screen.dart + bloc/assessment_bloc.dart
- **Detail:** Screen is read-only but Home labels it "Marks entry" and "Enter unit test & CCE marks" (home_screen.dart:66, 93). There is no marks-entry flow on mobile; teachers will look for it here.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-100 · `mobile://features/assessment_results` — studentId comes from the query string and Home pushes "/assessments" without one…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/assessment/presentation/assessment_results_screen.dart + bloc/assessment_bloc.dart
- **Detail:** studentId comes from the query string and Home pushes "/assessments" without one (app_router.dart:192-194), so the BLoC requests results for studentId "" — no student selector exists on the screen.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-101 · `mobile://features/attendance` — Teacher must type a raw "Institution ID" and free-text "Class" (attendance_scree…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/attendance/presentation/attendance_screen.dart + attendance_geofence_widget.dart
- **Detail:** Teacher must type a raw "Institution ID" and free-text "Class" (attendance_screen.dart:226-244) to load a roster — no picker from cached institutions/classes, so a typo yields an empty roster with no explanation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-102 · `mobile://features/attendance` — The bottom "Submit · n of m marked" button calls _loadRoster() (line 341), i.e.…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/attendance/presentation/attendance_screen.dart + attendance_geofence_widget.dart
- **Detail:** The bottom "Submit · n of m marked" button calls _loadRoster() (line 341), i.e. it reloads the list; marks were already queued on each tap. The label promises a submission step that does not exist and can discard un-synced local state confusion.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-103 · `mobile://features/attendance` — Geofence can never pass: _AppGeofenceLocator writes latitude/longitude as null i…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/attendance/presentation/attendance_screen.dart + attendance_geofence_widget.dart
- **Detail:** Geofence can never pass: _AppGeofenceLocator writes latitude/longitude as null into institutions_cache (attendance_geofence_widget.dart:121-122) and Institution API payload has no coordinates, so the banner always reports "No GPS coordinates configured".
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-104 · `mobile://features/login` — Biometric unlock replays the stored access/refresh tokens with userId "biometric…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/auth/presentation/login_screen.dart
- **Detail:** Biometric unlock replays the stored access/refresh tokens with userId "biometric-user" (login_screen.dart:115-119); BiometricService says tokens should be re-issued by the backend after the check. Session identity is wrong and expired tokens will fail silently.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-105 · `mobile://features/home` — Every service tile pushes a bare route ("/assessments", "/examinations", "/healt…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/home/presentation/home_screen.dart
- **Detail:** Every service tile pushes a bare route ("/assessments", "/examinations", "/health", "/scholarships") without ?studentId (home_screen.dart:68, 89-144). Those screens read studentId from the query and receive "" — the BLoC then requests results for an empty student.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-106 · `mobile://features/home` — App is offline-first (SyncEngine.pendingCount, sync_conflicts table) but Home sh…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/home/presentation/home_screen.dart
- **Detail:** App is offline-first (SyncEngine.pendingCount, sync_conflicts table) but Home shows no sync status, pending-upload count or conflict badge anywhere.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-107 · `mobile://features/institution_detail` — Contact, periods and infrastructure are never cached (line 43-51) — offline user…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/institutions/presentation/institution_detail_screen.dart
- **Detail:** Contact, periods and infrastructure are never cached (line 43-51) — offline users get three tabs of "requires an internet connection", yet the offline-first app caches everything else.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-108 · `mobile://features/institutions` — _refresh() fetches only fetchInstitution(tenantId) (institutions_screen.dart:57-…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/institutions/presentation/institutions_screen.dart
- **Detail:** _refresh() fetches only fetchInstitution(tenantId) (institutions_screen.dart:57-60), so the "list" can only ever contain the tenant's own record; a search box and list UI over a single item is misleading, and the Home tile promises "cluster info".
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-109 · `mobile://features/notification_preferences` — _savePreferences() only shows a SnackBar (line 140-147); nothing is persisted lo…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/notifications/presentation/notification_preferences_screen.dart
- **Detail:** _savePreferences() only shows a SnackBar (line 140-147); nothing is persisted locally or sent to the backend, and all toggles reset to true on every visit (line 17-27). Users believe they muted alerts they still receive.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-110 · `mobile://features/parent_consents` — Shell screen (23 lines) shows an API path instead of consents; backend supports…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/parent_portal/presentation/parent_consents_screen.dart
- **Detail:** Shell screen (23 lines) shows an API path instead of consents; backend supports decide, withdraw, supersede and history (parent-portal/src/routes.ts) with versioned consents — none of that is reachable from mobile.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-111 · `mobile://features/parent_fees` — Shell screen shows "pay via sandbox POST /parent-portal/fees/invoices/:id/pay" t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/parent_portal/presentation/parent_fees_screen.dart
- **Detail:** Shell screen shows "pay via sandbox POST /parent-portal/fees/invoices/:id/pay" to a parent (line 15-16); no invoice list, receipt or payment flow exists on mobile although the backend has plans, invoices, payments and receipts routes.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-112 · `mobile://features/parent_home` — No child selector: the backend parent-portal exposes /children and per-child vie…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/parent_portal/presentation/parent_home_screen.dart
- **Detail:** No child selector: the backend parent-portal exposes /children and per-child views, but this hub and its three sub-screens never say which student the guardian is acting for.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-113 · `mobile://features/parent_messages` — Screen is a 23-line shell that prints an API path to the guardian (line 14-16);…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/parent_portal/presentation/parent_messages_screen.dart
- **Detail:** Screen is a 23-line shell that prints an API path to the guardian (line 14-16); the backend routes GET/POST /parent-portal/messages/threads and /threads/:threadId/messages exist but nothing on mobile calls them.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-114 · `mobile://features/profile` — ProfileBloc emits placeholder data — displayName "User", role "parent", empty em…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/profile/presentation/profile_screen.dart + bloc/profile_bloc.dart
- **Detail:** ProfileBloc emits placeholder data — displayName "User", role "parent", empty email/phone/userId (profile_bloc.dart:132-141) — so every teacher sees "User · Parent". The hero is shown exactly as coded here.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-115 · `mobile://features/profile` — Language and Theme tiles push "/profile/language" and "/profile/theme" (profile_…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/profile/presentation/profile_screen.dart + bloc/profile_bloc.dart
- **Detail:** Language and Theme tiles push "/profile/language" and "/profile/theme" (profile_screen.dart:142, 149) but neither route exists in app_router.dart — tapping them throws a GoRouter error page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-116 · `mobile://features/profile` — Workspace "tap to switch" calls context.go("/tenant") (line 121); the router red…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/profile/presentation/profile_screen.dart + bloc/profile_bloc.dart
- **Detail:** Workspace "tap to switch" calls context.go("/tenant") (line 121); the router redirect sends authenticated users straight back to "/" (app_router.dart:291-293), so the tile does nothing.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-117 · `mobile://features/report_detail` — Both "quick reports" render hard-coded tables of "—" with the note "Live data wi…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/reports/presentation/report_detail_screen.dart
- **Detail:** Both "quick reports" render hard-coded tables of "—" with the note "Live data will populate once the … API is wired up" (line 530-612). Home advertises "Attendance & exam PDFs"; the screens are placeholders.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-118 · `mobile://features/report_detail` — Download ends in a SnackBar "Downloaded N bytes" (line 79-84); the bytes are not…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/reports/presentation/report_detail_screen.dart
- **Detail:** Download ends in a SnackBar "Downloaded N bytes" (line 79-84); the bytes are not saved, opened or shared, so the user cannot actually get the PDF.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-119 · `mobile://features/scholarship_application` — "Upload Documents" is an unimplemented stub that shows "Document upload coming s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/scholarship/presentation/scholarship_application_screen.dart
- **Detail:** "Upload Documents" is an unimplemented stub that shows "Document upload coming soon" (line 176-183) while ScholarshipApplicationSubmitted accepts documentIds — applicants cannot attach income or caste certificates, which every listed scheme requires.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-120 · `mobile://features/scholarship_application` — The form never shows which program or student it is for — only ids are passed in…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/scholarship/presentation/scholarship_application_screen.dart
- **Detail:** The form never shows which program or student it is for — only ids are passed in (line 17-18); combined with the missing studentId from the programs list, a guardian with two children cannot tell whom they are applying for.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-121 · `mobile://features/scholarship_programs` — Tapping a program pushes "/scholarships/apply/:id" with no studentId (line 145-1…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/scholarship/presentation/scholarship_programs_screen.dart
- **Detail:** Tapping a program pushes "/scholarships/apply/:id" with no studentId (line 145-147) although the apply route expects ?studentId; the application is then submitted for studentId "" (scholarship_application_screen.dart:71-81).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-122 · `mobile://features/scholarship_programs` — Closed programs and programs past deadline are still tappable and open the appli…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/scholarship/presentation/scholarship_programs_screen.dart
- **Detail:** Closed programs and programs past deadline are still tappable and open the application form (line 144-147); nothing blocks or explains.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-123 · `mobile://features/scholarship_status` — Error state's Retry button does nothing — onRetry is an empty closure with a com…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/scholarship/presentation/scholarship_status_screen.dart
- **Detail:** Error state's Retry button does nothing — onRetry is an empty closure with a comment (line 52-55).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-124 · `mobile://features/document_capture` — No document type or label is captured — the queue only carries a file path (docu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/students/presentation/document_capture_screen.dart
- **Detail:** No document type or label is captured — the queue only carries a file path (document_capture_screen.dart:62-65), so the profile later lists "aadhaar_front_….jpg"-style names with no meaning to the school.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-125 · `mobile://features/student_profile` — Hero chip and "Institution" row show the raw institutionId and "Student ID" show…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/students/presentation/student_profile_screen.dart
- **Detail:** Hero chip and "Institution" row show the raw institutionId and "Student ID" shows the internal record id (student_profile_screen.dart:94-98, 160-165). No class, section, roll number or guardian — the fields a school user actually needs.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-126 · `mobile://features/students` — Row subtitle is nationalId · institutionId, i.e. a national id number and a raw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/students/presentation/students_screen.dart
- **Detail:** Row subtitle is nationalId · institutionId, i.e. a national id number and a raw tenant institution id (students_screen.dart:130-139) — sensitive and meaningless in a list; class/section is what a teacher scans for.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-127 · `mobile://features/tenant_selection` — Screen is a developer stub (file comment, line 6-8): the user must type a raw wo…
- **Status:** OPEN
- **Evidence:** ux-review · apps/mobile/lib/features/tenant/presentation/tenant_selection_screen.dart
- **Detail:** Screen is a developer stub (file comment, line 6-8): the user must type a raw workspace id by hand. There is no directory lookup, QR/invite code or validation that the id exists — a typo silently binds the device to a non-existent tenant.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · institutions (18)

### B-128 · `/institutions` — Two of four KPI tiles ("Students enrolled", "Reporting today") are hard-coded to…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/page.tsx
- **Detail:** Two of four KPI tiles ("Students enrolled", "Reporting today") are hard-coded to "—" with the foot "Connect enrollment API for live data" (page.tsx KpiCard calls) — placeholder copy ships to end users.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-129 · `/institutions/[id]/classes` — Class teacher and Room are read from section.customData (classTeacher / room) wh…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/classes/page.tsx
- **Detail:** Class teacher and Room are read from section.customData (classTeacher / room) which nothing writes — on real data every row shows "Unassigned" / "—" and there is no way to assign a teacher or room from this tab.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-130 · `/institutions/[id]/curriculum` — One page mixes four different create forms (unit, per-unit lesson, outcome) inli…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/curriculum/page.tsx
- **Detail:** One page mixes four different create forms (unit, per-unit lesson, outcome) inline with the list, all sharing a single `error` string at the top (curriculum-panel.tsx) — an error from "Add lesson" on unit 3 appears above the scope selectors.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-131 · `/institutions/[id]/curriculum` — "Mark taught" is irreversible in the UI (button becomes disabled "Taught"); ther…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/curriculum/page.tsx
- **Detail:** "Mark taught" is irreversible in the UI (button becomes disabled "Taught"); there is no confirmation and no un-mark, yet it directly changes the coverage KPI.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-132 · `/institutions/[id]/edit` — The edit page sits under the detail layout, so the hero shows Edit + "School rep…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/edit/page.tsx
- **Detail:** The edit page sits under the detail layout, so the hero shows Edit + "School report" buttons and the eight section tabs with none active — the user can click "Edit" while already editing, and the unsaved form is one tab-click from being lost with no prompt.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-133 · `/institutions/[id]/gradebook` — Error and empty copy expose developer internals to end users: "apply db/sql/003_…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/gradebook/page.tsx
- **Detail:** Error and empty copy expose developer internals to end users: "apply db/sql/003_sis_timetable_schedule_schema.sql on Postgres", "Seed with db/seeds/004_sis_gradebook_credit_section.sql or create sections from master schedule (WS2)" (page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-134 · `/institutions/[id]/gradebook` — Publish / Lock / Approve are one-click bulk transitions with no confirmation, an…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/gradebook/page.tsx
- **Detail:** Publish / Lock / Approve are one-click bulk transitions with no confirmation, and Publish is irreversible for parents/students (NEXT_ACTION.PUBLISHED = null) — gradebook-workflow-panel.tsx.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-135 · `/institutions/[id]/grades` — UtilizationBar colour logic is unreachable: `pct >= 95 ? amber : pct >= 100 ? re…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/grades/page.tsx
- **Detail:** UtilizationBar colour logic is unreachable: `pct >= 95 ? amber : pct >= 100 ? red : green` — 100 %+ can never be red because ≥95 matches first (grades/page.tsx UtilizationBar).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-136 · `/institutions/[id]/infrastructure` — Read-only tab: the empty state says "Add land, buildings, and rooms" and the ban…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/infrastructure/page.tsx
- **Detail:** Read-only tab: the empty state says "Add land, buildings, and rooms" and the banner says "log a repair request", but there is no add/edit/repair action anywhere on the page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-137 · `/institutions/[id]/overview` — Enrollment-by-grade and Recent activity are read only from institution.customDat…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/overview/page.tsx
- **Detail:** Enrollment-by-grade and Recent activity are read only from institution.customData (enrollmentByGrade / recentActivity) — no API populates these, so on real data both cards always show their empty copy.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-138 · `/institutions/[id]/schedule` — Conflict rows print raw truncated ids: "day 1 · period 3f9a1c2e · staff 7b2d… ·…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/schedule/page.tsx
- **Detail:** Conflict rows print raw truncated ids: "day 1 · period 3f9a1c2e · staff 7b2d… · room 91ee…" (page.tsx conflicts list) — the user cannot tell which teacher or room clashes.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-139 · `/institutions/[id]/schedule` — "Unpublish to draft" on a published section is a single click with no confirmati…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/schedule/page.tsx
- **Detail:** "Unpublish to draft" on a published section is a single click with no confirmation, and status is shown as the raw enum string ("PUBLISHED") in a plain text cell.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-140 · `/institutions/[id]/schedule/[sectionId]` — Withdraw is an immediate, unconfirmed single-click on each row (WithdrawStudentB…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/schedule/[sectionId]/page.tsx
- **Detail:** Withdraw is an immediate, unconfirmed single-click on each row (WithdrawStudentButton) — no undo, and the enrolled-count header updates silently.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-141 · `/institutions/[id]/schedule/[sectionId]` — Bulk assign expects raw student UUIDs pasted into a textarea (placeholder "e.g.…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/schedule/[sectionId]/page.tsx
- **Detail:** Bulk assign expects raw student UUIDs pasted into a textarea (placeholder "e.g. "), and failures are reported as truncated ids ("2 failed (7b2d3e1a, 91ee0c4f)") — section-roster-controls.tsx.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-142 · `/institutions/[id]/timetable` — The "timetable" is a flat sorted table (Day / Period / Section / Staff / Room /…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/timetable/page.tsx
- **Detail:** The "timetable" is a flat sorted table (Day / Period / Section / Staff / Room / Status) — there is no week grid, although components/timetable/weekly-grid.tsx exists and is used only by the student/parent portals. The mockup shows the grid as the primary view.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-143 · `/institutions/[id]/timetable/generate` — Recent jobs render as "DONE · 184 assigned · 2 clashes" text lines with no times…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/timetable/generate/page.tsx
- **Detail:** Recent jobs render as "DONE · 184 assigned · 2 clashes" text lines with no timestamp, no who-ran-it, and no link to the resulting grid (page.tsx jobs list).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-144 · `/institutions/[id]/timetable/substitutions` — The substitute is entered as a raw "Substitute staff ID" text field (substitutio…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/timetable/substitutions/page.tsx
- **Detail:** The substitute is entered as a raw "Substitute staff ID" text field (substitution-create-form.tsx) even though a staff option list is loaded for the absence form on the same page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-145 · `/institutions/[id]/timetable/substitutions` — Meeting slot options read "Mon · staff 7b2d3e1a…" — day plus a truncated staff U…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/institutions/[id]/timetable/substitutions/page.tsx
- **Detail:** Meeting slot options read "Mon · staff 7b2d3e1a…" — day plus a truncated staff UUID — with no period time or section name (page.tsx meetingOptions).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · staff (17)

### B-146 · `/staff` — StaffTypeTabs (All / Teaching / Non-teaching / On leave) are decorative: page.ts…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/page.tsx
- **Detail:** StaffTypeTabs (All / Teaching / Non-teaching / On leave) are decorative: page.tsx reads `type` from the URL but never maps it into StaffListFilters, so clicking a tab changes the URL and nothing else.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-147 · `/staff/[id]` — 'Apply for leave' (LeaveBalanceCard) links to /staff/[id]/leaves/new, a route th…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/[id]/page.tsx
- **Detail:** 'Apply for leave' (LeaveBalanceCard) links to /staff/[id]/leaves/new, a route that does not exist in apps/web — dead link on every profile.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-148 · `/staff/[id]` — Raw ids everywhere: AssignmentCard shows classId.slice(0,12) as the class chip a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/[id]/page.tsx
- **Detail:** Raw ids everywhere: AssignmentCard shows classId.slice(0,12) as the class chip and subjectId as the title; AssignmentsTab table prints institutionId / classId / subjectId; role shows the enum SUBJECT_TEACHER.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-149 · `/staff/[id]/appraisals/new` — Page copy promises 'total score and rating band are calculated automatically as…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/[id]/appraisals/new/page.tsx
- **Detail:** Page copy promises 'total score and rating band are calculated automatically as you fill in scores' but appraisal-form.tsx computes nothing client-side — there is no running total or band anywhere on the form (mockup adds one to show the gap).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-150 · `/staff/[id]/assignments/new` — Class options only load when ?institutionId= is in the URL (page.tsx fetches lis…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/[id]/assignments/new/page.tsx
- **Detail:** Class options only load when ?institutionId= is in the URL (page.tsx fetches listClassesByInstitution from searchParams); picking an institution in the form does not refetch, so the Class select stays empty unless the user arrives via a pre-built link.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-151 · `/staff/[id]/edit` — Only 7 fields are editable (name, DOB, identity number, phone, email, position);…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/[id]/edit/page.tsx
- **Detail:** Only 7 fields are editable (name, DOB, identity number, phone, email, position); designation, subjects, school posting, joining date and qualification shown on the profile all live in customData and cannot be changed anywhere in the UI.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-152 · `/staff/attendance` — Monthly summary rows print `Staff {staffId.slice(0,8)}… · present N · leave N…`…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/attendance/page.tsx
- **Detail:** Monthly summary rows print `Staff {staffId.slice(0,8)}… · present N · leave N…` as one text string — truncated UUIDs instead of names, no table, no alignment of numbers.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-153 · `/staff/attendance` — listStaff({ pageSize: 100 }) caps the grid at 100 people with no pagination or s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/attendance/page.tsx
- **Detail:** listStaff({ pageSize: 100 }) caps the grid at 100 people with no pagination or search; larger schools silently lose staff from the marking list.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-154 · `/staff/contracts` — Both forms require a raw 'Staff UUID' text field (new-contract-form.tsx, new-qua…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/contracts/page.tsx
- **Detail:** Both forms require a raw 'Staff UUID' text field (new-contract-form.tsx, new-qualification-form.tsx) — no staff picker; the registry rows then show `Staff {staffId.slice(0,8)}…`, so no name appears anywhere on the page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-155 · `/staff/contracts` — Contracts and qualifications are concatenated strings inside  ('permanent · no b…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/contracts/page.tsx
- **Detail:** Contracts and qualifications are concatenated strings inside  ('permanent · no band · active · renewal due') — raw enum values, no status pill, no table, no link to the staff profile.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-156 · `/staff/import` — 'Commit import' is enabled before any dry-run has been performed and has no conf…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/import/page.tsx
- **Detail:** 'Commit import' is enabled before any dry-run has been performed and has no confirmation, so the copy 'Dry-run validates every row, then commit' is not enforced — a user can commit unvalidated data in one click.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-157 · `/staff/leaves` — Request form asks for a raw 'Staff UUID' (new-staff-leave-form.tsx) and each lis…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/leaves/page.tsx
- **Detail:** Request form asks for a raw 'Staff UUID' (new-staff-leave-form.tsx) and each list row shows `Staff {staffId.slice(0,8)}…` — the person's name never appears; the profile's 'Apply for leave' link points to a route that does not exist.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-158 · `/staff/leaves` — Approve/Reject buttons render for every row regardless of status (StaffLeaveDeci…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/leaves/page.tsx
- **Detail:** Approve/Reject buttons render for every row regardless of status (StaffLeaveDecisionButtons only checks pending after click), with no confirmation and no reason capture on reject.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-159 · `/staff/new` — Page subtitle promises 'designation, school posting, and qualifications' and 'em…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/new/page.tsx
- **Detail:** Page subtitle promises 'designation, school posting, and qualifications' and 'employee ID generated on save', but staff-form.tsx has only 7 fields (no designation, school, subjects, qualification) and Identity number is typed manually.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-160 · `/staff/payroll` — Rows are rendered as one concatenated sentence per  ('name · band — · present 20…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/payroll/page.tsx
- **Detail:** Rows are rendered as one concatenated sentence per  ('name · band — · present 20 · leave 1 · payable 20') — a numeric extract with no columns, alignment or totals, and the deductions column that the CSV contains is not shown at all.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-161 · `/staff/substitutions` — Meeting options are built as `Mon · section 3f9a1b2c… · staff 8d0e…` (truncated…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/substitutions/page.tsx
- **Detail:** Meeting options are built as `Mon · section 3f9a1b2c… · staff 8d0e…` (truncated UUIDs) and the substitute is a raw 'Substitute staff ID' text field — impossible to use without copying ids from elsewhere.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-162 · `/staff/substitutions` — Table cells Meeting / Original / Substitute print sectionMeetingId / originalSta…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/staff/substitutions/page.tsx
- **Detail:** Table cells Meeting / Original / Substitute print sectionMeetingId / originalStaffId / substituteStaffId sliced to 8 chars; status is raw enum text.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · parent (17)

### B-163 · `/parent` — page.tsx identifies the child as "Student " + studentId.slice(0, 8) + "…" (a tru…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/page.tsx
- **Detail:** page.tsx identifies the child as "Student " + studentId.slice(0, 8) + "…" (a truncated UUID such as "Student 1a2b3c4d…"). ParentChildLink carries no name, so parents with two children cannot tell them apart; the mock-up shows names to illustrate what is needed.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-164 · `/parent` — 14 identical cards, each with a full-width button, replicate the sidebar one-for…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/page.tsx
- **Detail:** 14 identical cards, each with a full-width button, replicate the sidebar one-for-one; only "Open messages" is primary-styled, so the visual hierarchy suggests Messages is the main task with no data to support it. No pending counts (unpaid invoices, pending consents, unread threads) are surfaced.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-165 · `/parent/attendance` — No way to act on an absence: there is no "inform school" / leave-request action…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/attendance/page.tsx
- **Detail:** No way to act on an absence: there is no "inform school" / leave-request action and absences are not linked to the Messages module, so the parent must copy the date into a new thread manually.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-166 · `/parent/consents` — Approve and Deny both fire decideConsentAction immediately with no confirmation…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/consents/page.tsx + _components/consent-decision-buttons.tsx + parent-actions.ts (decideConsentAction)
- **Detail:** Approve and Deny both fire decideConsentAction immediately with no confirmation dialog and no reason field; a mis-tap on "Deny" for a field trip is irreversible from the portal (no undo, status leaves "pending").
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-167 · `/parent/consents` — consents/page.tsx identifies the child as "Student " + studentId.slice(0, 8) + "…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/consents/page.tsx + _components/consent-decision-buttons.tsx + parent-actions.ts (decideConsentAction)
- **Detail:** consents/page.tsx identifies the child as "Student " + studentId.slice(0, 8) + "…" (a truncated UUID such as "Student 1a2b3c4d…"). ParentChildLink carries no name, so parents with two children cannot tell them apart; the mock-up shows names to illustrate what is needed.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-168 · `/parent/fees` — "Pay (sandbox)" calls payInvoiceAction(invoiceId) on a single click: no amount c…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/fees/page.tsx + _components/pay-invoice-button.tsx + parent-actions.ts (payInvoiceAction)
- **Detail:** "Pay (sandbox)" calls payInvoiceAction(invoiceId) on a single click: no amount confirmation, no partial-payment amount, no payment-method step, and success is only signalled by router.refresh() (the returned message "Payment recorded (sandbox). Receipt …" is never shown).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-169 · `/parent/fees` — Currency: remaining balance is hard-coded formatAmount(openRemaining, "INR") whi…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/fees/page.tsx + _components/pay-invoice-button.tsx + parent-actions.ts (payInvoiceAction)
- **Detail:** Currency: remaining balance is hard-coded formatAmount(openRemaining, "INR") while each invoice uses invoice.currency || "USD"; Intl.NumberFormat(undefined, …) with no locale means grouping may not be lakh-style and a missing currency shows "$".
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-170 · `/parent/grades` — Two unlabeled  lists (grades, then report cards) stacked in one card; a report-c…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/grades/page.tsx
- **Detail:** Two unlabeled  lists (grades, then report cards) stacked in one card; a report-card row is literally the word "Report card" plus a raw status ("completed") with no term, date, or link to /parent/report-cards where the detail lives.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-171 · `/parent/homework` — item.status (HomeworkItem) is never rendered, so a parent cannot see whether the…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/homework/page.tsx
- **Detail:** item.status (HomeworkItem) is never rendered, so a parent cannot see whether the child submitted; overdue items are not flagged and there is no sort or filter by due date.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-172 · `/parent/library` — Loan rows print only loan.status and "due YYYY-MM-DD"; hold rows only "status ·…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/library/page.tsx
- **Detail:** Loan rows print only loan.status and "due YYYY-MM-DD"; hold rows only "status · position N". Neither shows the book title, so a student sees "active · due 2026-09-26" with no idea which book it is.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-173 · `/parent/library` — The page passes status="ok" and hasRows unconditionally, so a failed searchLibra…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/library/page.tsx
- **Detail:** The page passes status="ok" and hasRows unconditionally, so a failed searchLibraryOpac/listLibraryLoans call is never surfaced — the frame never shows its forbidden or error branch on this route.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-174 · `/parent/messages` — create-thread-form.tsx labels the child selector "Student ID" and its options ar…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/messages/page.tsx + _components/create-thread-form.tsx + parent-actions.ts (createThreadAction)
- **Detail:** create-thread-form.tsx labels the child selector "Student ID" and its options are id.slice(0, 8) + "…" (raw UUID prefixes); with zero linked children it degrades to a free-text input asking the parent to type a UUID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-175 · `/parent/messages/[threadId]` — Every message is rendered as an identical grey box labelled with message.senderR…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/messages/[threadId]/page.tsx + _components/reply-form.tsx + parent-actions.ts (replyToThreadAction)
- **Detail:** Every message is rendered as an identical grey box labelled with message.senderRole ("guardian"/"staff") — no sender name, no visual distinction between my messages and the school’s, no avatar.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-176 · `/parent/offers` — Accepting an offer (an enrolment — irreversible) is a single click on "Pay (sand…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/offers/page.tsx + _components/accept-offer-form.tsx + parent-actions.ts (acceptGuardianOfferAction)
- **Detail:** Accepting an offer (an enrolment — irreversible) is a single click on "Pay (sandbox) & accept" with a pre-filled "SANDBOX-PAY" reference and no confirmation step or summary of what is being accepted (class, session, fee).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-177 · `/parent/offers` — The page copy and permanent amber banner expose implementation state ("sandbox p…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/offers/page.tsx + _components/accept-offer-form.tsx + parent-actions.ts (acceptGuardianOfferAction)
- **Detail:** The page copy and permanent amber banner expose implementation state ("sandbox payment only", "same as staff", "sandbox fee accept") to parents — this is a product-readiness flag, not a parent-facing message.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-178 · `/parent/report-cards` — card.outputUrl exists but is only used to print the string "· download available…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/report-cards/page.tsx
- **Detail:** card.outputUrl exists but is only used to print the string "· download available from school"; the parent is never given the link. Card heading is "Report card · completed" with no term or academic year.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-179 · `/parent/timetable` — components/timetable/weekly-grid.tsx prints slot.sectionName ("9-B") as the slot…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(parent)/parent/timetable/page.tsx
- **Detail:** components/timetable/weekly-grid.tsx prints slot.sectionName ("9-B") as the slot title — the WeeklySlot type has no subject or teacher field, so every period in the week reads "9-B · Period 3 · 09:20–10:00 · Room 204". The mock-up shows subjects to illustrate what is missing.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · student (17)

### B-180 · `/student` — The page is titled "Today" but fetches nothing: page.tsx renders a static LINKS…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/page.tsx
- **Detail:** The page is titled "Today" but fetches nothing: page.tsx renders a static LINKS array of 8 cards. There is no today-at-a-glance (next period, homework due today, unread notices), so the headline promise is not kept.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-181 · `/student` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-182 · `/student/attendance` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/attendance/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-183 · `/student/calendar` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/calendar/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-184 · `/student/grades` — Grades and report cards are pushed into one  with no heading between them; a row…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/grades/page.tsx
- **Detail:** Grades and report cards are pushed into one  with no heading between them; a row reads "UT-2 · A" and the next "Report card / completed" with nothing telling the student these are different things.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-185 · `/student/grades` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/grades/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-186 · `/student/homework` — The student page omits item.subject that the parent page prints, and neither pag…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/homework/page.tsx
- **Detail:** The student page omits item.subject that the parent page prints, and neither page shows item.status (HomeworkItem has one) — a student cannot tell submitted from pending, nor overdue from upcoming.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-187 · `/student/homework` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/homework/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-188 · `/student/library` — Loan rows print only loan.status and "due YYYY-MM-DD"; hold rows only "status ·…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/library/page.tsx
- **Detail:** Loan rows print only loan.status and "due YYYY-MM-DD"; hold rows only "status · position N". Neither shows the book title, so a student sees "active · due 2026-09-26" with no idea which book it is.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-189 · `/student/library` — The page passes status="ok" and hasRows unconditionally, so a failed searchLibra…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/library/page.tsx
- **Detail:** The page passes status="ok" and hasRows unconditionally, so a failed searchLibraryOpac/listLibraryLoans call is never surfaced — the frame never shows its forbidden or error branch on this route.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-190 · `/student/library` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/library/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-191 · `/student/notices` — Student notice rows show title + body only — no sentAt date and no channel, so t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/notices/page.tsx
- **Detail:** Student notice rows show title + body only — no sentAt date and no channel, so the student cannot tell a notice from last week from one sent today (parent page prints both).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-192 · `/student/notices` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/notices/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-193 · `/student/pal` — The plan is a read-only list: no link or button starts a practice session for a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/pal/page.tsx
- **Detail:** The plan is a read-only list: no link or button starts a practice session for a skill, so the "plan" has no next step. Mastery is a text suffix "mastery 62%" rather than a meter.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-194 · `/student/pal` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/pal/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-195 · `/student/timetable` — components/timetable/weekly-grid.tsx prints slot.sectionName ("9-B") as the slot…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/timetable/page.tsx
- **Detail:** components/timetable/weekly-grid.tsx prints slot.sectionName ("9-B") as the slot title — the WeeklySlot type has no subject or teacher field, so every period in the week reads "9-B · Period 3 · 09:20–10:00 · Room 204". The mock-up shows subjects to illustrate what is missing.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-196 · `/student/timetable` — app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating betw…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(student)/student/timetable/page.tsx
- **Detail:** app/(student) has no loading.tsx or error.tsx (only layout.tsx): navigating between student pages shows a blank main area while the server component awaits the gateway, and a thrown error falls through to the root boundary instead of a portal-scoped panel. The parent group has both.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · admin-console (15)

### B-197 · `/` — Timeline outcome is a 2 px coloured dot only (green success / red failure, page.…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/page.tsx
- **Detail:** Timeline outcome is a 2 px coloured dot only (green success / red failure, page.tsx "inline-flex h-2 w-2 rounded-full") with no icon or text — the one signal an operator scans for is colour-only.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-198 · `/audit` — The tenant filter is a free-text "Tenant id" input (audit-filter.tsx) while the…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/audit/page.tsx
- **Detail:** The tenant filter is a free-text "Tenant id" input (audit-filter.tsx) while the table deliberately resolves ids to names "so raw UUIDs are never surfaced" — the operator must know tnt_003 to filter for Green Valley.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-199 · `/break-glass` — Target tenant is a free-text "Target tenant ID" input (placeholder "tnt_001 or '…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/break-glass/page.tsx
- **Detail:** Target tenant is a free-text "Target tenant ID" input (placeholder "tnt_001 or 'platform'"), and the page ignores the ?tenantId that Support passes in its "Request break-glass" link (BreakGlassPage reads no searchParams) — the operator retypes an id they were just looking at.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-200 · `/break-glass/requests` — The policy alert says "You cannot approve your own request", but ApprovalActions…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/break-glass/requests/page.tsx
- **Detail:** The policy alert says "You cannot approve your own request", but ApprovalActions renders Approve / Deny for every pending card when canDecide is true — nothing compares request.requester with the session user (requests/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-201 · `/health` — There is no refresh control or auto-refresh; the only freshness cue is the "Snap…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/health/page.tsx
- **Detail:** There is no refresh control or auto-refresh; the only freshness cue is the "Snapshot generated …" subtitle, and a stale snapshot looks identical to a live one (health/page.tsx has no age check). Refresh button and stale banner here are designed additions.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-202 · `/plans/[id]` — Saving changes entitlements for every tenant on the tier "at the next billing cy…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/plans/[id]/page.tsx
- **Detail:** Saving changes entitlements for every tenant on the tier "at the next billing cycle" with no confirmation, no count of affected tenants, and no success message — the form just re-renders (updateEntitlementsAction has no state).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-203 · `/plugins` — Reviewed table row action is opacity-0 until hover (group-hover:opacity-100), in…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/plugins/page.tsx
- **Detail:** Reviewed table row action is opacity-0 until hover (group-hover:opacity-100), invisible on touch; the name link already opens the same page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-204 · `/plugins/[id]` — All four decisions (Approve, Reject, Revoke, Disable) are offered regardless of…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/plugins/[id]/page.tsx
- **Detail:** All four decisions (Approve, Reject, Revoke, Disable) are offered regardless of status (decision-form.tsx renders a fixed 2×2 grid) — Revoke is shown for a plugin that was never approved, and an already-revoked plugin can be "approved" again.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-205 · `/plugins/[id]` — No confirmation for Revoke / Disable, which pull a live plugin from every tenant…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/plugins/[id]/page.tsx
- **Detail:** No confirmation for Revoke / Disable, which pull a live plugin from every tenant; one justification textarea serves opposite actions, and the four equally sized buttons give no primary path.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-206 · `/support` — "Request break-glass" links to /break-glass?tenantId=… but the break-glass form…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/support/page.tsx
- **Detail:** "Request break-glass" links to /break-glass?tenantId=… but the break-glass form ignores the parameter, so the tenant just selected must be retyped as a raw id (support/page.tsx ↔ break-glass/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-207 · `/tenants` — The row "View" button is opacity-0 until hover (tenants/page.tsx group-hover:opa…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/tenants/page.tsx
- **Detail:** The row "View" button is opacity-0 until hover (tenants/page.tsx group-hover:opacity-100); on touch devices it never appears, and keyboard users only discover it on focus. The name is also a link, so the button is redundant.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-208 · `/tenants/[id]` — Decommission and "Permanently offboard" are irreversible submits with no confirm…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/tenants/[id]/page.tsx
- **Detail:** Decommission and "Permanently offboard" are irreversible submits with no confirmation step — the only guard is a 10-character textarea (lifecycle-actions.tsx availableActions / ActionButton disabled until reason ≥ 10).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-209 · `/tenants/new` — Hosting region is a free-text input defaulting to "us-east-1" (new-tenant-form.t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/tenants/new/page.tsx
- **Detail:** Hosting region is a free-text input defaulting to "us-east-1" (new-tenant-form.tsx), while every real tenant here lives in ap-south-1; a typo provisions into the wrong region with no validation or picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-210 · `/themes/[id]` — The reviewer-notes Textarea has no label and no aria-label (themes/[id]/page.tsx…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(admin)/themes/[id]/page.tsx
- **Detail:** The reviewer-notes Textarea has no label and no aria-label (themes/[id]/page.tsx ``) — placeholder is its only name.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-211 · `/login` — A console that gates break-glass and tenant decommission has a single email + pa…
- **Status:** OPEN
- **Evidence:** ux-review · apps/admin-console/src/app/(auth)/login/page.tsx
- **Detail:** A console that gates break-glass and tenant decommission has a single email + password step — no MFA / passkey prompt anywhere in login-form.tsx or the auth routes.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · lms (15)

### B-212 · `/lms/analytics` — Class is a free-text input defaulting to '7A' (page.tsx L331, L360–365) and quiz…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/analytics/page.tsx
- **Detail:** Class is a free-text input defaulting to '7A' (page.tsx L331, L360–365) and quizzes are matched by gradeLevel === classKey (L333–335). The school's sections are '9-B'; a grade level '9' never equals '9-B', so quiz cards silently vanish.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-213 · `/lms/assignments/[id]` — Submissions table shows the raw studentId in mono (page.tsx L313) — no student n…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/assignments/[id]/page.tsx
- **Detail:** Submissions table shows the raw studentId in mono (page.tsx L313) — no student name, class or avatar. A teacher grading 34 quizzes cannot tell who is who; the mockup adds names the API does not return.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-214 · `/lms/assignments/[id]` — Every submission row embeds two forms — GradeSubmissionForm and RubricGradeForm…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/assignments/[id]/page.tsx
- **Detail:** Every submission row embeds two forms — GradeSubmissionForm and RubricGradeForm (L322–333). When no rubric is attached the second form degrades to 'Criterion ID' / 'Points' / level-index inputs (depth-grade-forms.tsx L109–128), which is raw API plumbing in the grading grid.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-215 · `/lms/assignments/new` — School and Board fall back to a text input with placeholder 'Paste an ID' when t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/assignments/new/page.tsx
- **Detail:** School and Board fall back to a text input with placeholder 'Paste an ID' when the lists are empty (new-assignment-form.tsx L353–358, L385–390; i18n fieldIdPlaceholder) — a teacher is asked for a UUID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-216 · `/lms/assignments/new` — One page holds six cards and, for a quiz, an unbounded list of question fieldset…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/assignments/new/page.tsx
- **Detail:** One page holds six cards and, for a quiz, an unbounded list of question fieldsets with no section navigation, progress or save-and-continue (L180–698). The mockup adds a sticky section index; the code has none.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-217 · `/lms/bank` — The form shows every type's answer fields at once — Correct MCQ index, MSQ corre…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/bank/page.tsx
- **Detail:** The form shows every type's answer fields at once — Correct MCQ index, MSQ correct indexes, Numeric answer, Numeric tolerance, Match pairs (bank-item-form.tsx L107–148) — regardless of the Type select; a teacher writing an essay item sees 5 irrelevant inputs.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-218 · `/lms/bank` — 'School ID' is a required free-text input (L67–70) and scope is hard-coded to 's…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/bank/page.tsx
- **Detail:** 'School ID' is a required free-text input (L67–70) and scope is hard-coded to 'school' (L23); the item cannot be board-scoped and the teacher must know a UUID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-219 · `/lms/content` — Kind offers 'File' but there is no file input — the only content field is a 'Bod…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/content/page.tsx
- **Detail:** Kind offers 'File' but there is no file input — the only content field is a 'Body or URL' textarea (content-form.tsx L53–71); a teacher cannot actually upload a file here.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-220 · `/lms/content` — 'School ID' is a required free-text field (L48–51) with no picker; scope is hard…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/content/page.tsx
- **Detail:** 'School ID' is a required free-text field (L48–51) with no picker; scope is hard-coded 'school' (L22).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-221 · `/lms/discussions` — Posts carry no author or timestamp — the post type is {id, body, hidden, pinned}…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/discussions/page.tsx
- **Detail:** Posts carry no author or timestamp — the post type is {id, body, hidden, pinned} (discussion-forms.tsx L70) and the list renders body text only (L125–130). A moderator cannot see who wrote what; the mockup adds names the API does not provide.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-222 · `/lms/lessons` — A lesson can carry exactly one resource, entered as 'Resource title' + 'Video or…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/lessons/page.tsx
- **Detail:** A lesson can carry exactly one resource, entered as 'Resource title' + 'Video or link URL' at creation (lesson-form.tsx L151–158); there is no way to add, edit or remove resources afterwards and no file upload despite the 'file' resource kind.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-223 · `/lms/lessons` — 'School ID' is a required free-text field (L127–130) — the teacher must paste a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/lessons/page.tsx
- **Detail:** 'School ID' is a required free-text field (L127–130) — the teacher must paste a UUID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-224 · `/lms/pal` — When no students load, the lookup degrades to a text Input with placeholder 'Pas…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/pal/page.tsx
- **Detail:** When no students load, the lookup degrades to a text Input with placeholder 'Paste an ID' and validates it against a UUID regex (pal-lookup.tsx L675–682, L590, L634–637) — the error 'Enter a valid student ID' asks a teacher for a UUID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-225 · `/lms/rubrics` — The subtitle promises 'Criteria × levels' but the form creates a single 'First c…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/rubrics/page.tsx
- **Detail:** The subtitle promises 'Criteria × levels' but the form creates a single 'First criterion' with a 'Max points' number and no levels (rubric-form.tsx L265–287, createRubricAction takes criterionName + maxPoints). There is no route to add criteria or levels afterwards.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-226 · `/lms/rubrics` — 'School ID' is a required free-text field (L269–272); scope is hard-coded to 'sc…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/lms/rubrics/page.tsx
- **Detail:** 'School ID' is a required free-text field (L269–272); scope is hard-coded to 'school' (L246).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · health (14)

### B-227 · `/health/[studentId]` — "Record screening" and "Edit record" buttons are inert ( with no href/onClick) —…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/[studentId]/page.tsx
- **Detail:** "Record screening" and "Edit record" buttons are inert ( with no href/onClick) — the two primary actions on the page do nothing.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-228 · `/health/[studentId]` — The confidentiality notice hard-codes "visible to you as a Health Officer" regar…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/[studentId]/page.tsx
- **Detail:** The confidentiality notice hard-codes "visible to you as a Health Officer" regardless of the viewer’s actual role (nurse, counsellor, admin); no role-based redaction exists — a record is either fully visible or fully denied. The redacted class-teacher view here is a proposal to match the i18n promise "Class teachers see only the follow-up status, never the diagnosis".
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-229 · `/health/allergies` — The register is derived from HealthRecord.allergies (string[]) so severity, reac…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/allergies/page.tsx
- **Detail:** The register is derived from HealthRecord.allergies (string[]) so severity, reaction and treatment stored in AllergyRecord are never shown; a life-threatening peanut allergy looks identical to mild hay fever.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-230 · `/health/allergies/new` — "Student ID" is a raw text field validated against a UUID v4 regex (create-aller…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/allergies/new/page.tsx (+ _components/create-allergy-form.tsx)
- **Detail:** "Student ID" is a raw text field validated against a UUID v4 regex (create-allergy-form.tsx UUID_RE); a nurse has no way to obtain that value. Replaced by a student picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-231 · `/health/counselling` — The View and More icon buttons in SessionRow have no handler or href; there is n…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/counselling/page.tsx
- **Detail:** The View and More icon buttons in SessionRow have no handler or href; there is no session detail route, so sealed notes can never be opened even by the assigned counsellor.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-232 · `/health/counselling/new` — Both "Student ID" and "Counsellor ID" are raw UUID v4 text inputs with placehold…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/counselling/new/page.tsx (+ _components/create-counselling-session-form.tsx)
- **Detail:** Both "Student ID" and "Counsellor ID" are raw UUID v4 text inputs with placeholders like "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"; the person scheduling cannot know either value. Replaced by pickers.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-233 · `/health/incidents` — Rows show "student 7f3a9c1e…" — the first 8 characters of the student UUID — ins…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/incidents/page.tsx
- **Detail:** Rows show "student 7f3a9c1e…" — the first 8 characters of the student UUID — instead of the student’s name; the nurse cannot tell who was treated without opening another module.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-234 · `/health/incidents/new` — "Student ID" and "Institution ID (optional)" are raw UUID text inputs; "Reported…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/incidents/new/page.tsx (+ _components/create-nurse-incident-form.tsx)
- **Detail:** "Student ID" and "Institution ID (optional)" are raw UUID text inputs; "Reported by" is free text rather than the signed-in nurse. Replaced by pickers / default actor.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-235 · `/health/phi-access` — Actor and Student columns print truncated UUIDs ("7f3a9c1e…") in monospace — an…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/phi-access/page.tsx (+ lib/auth/health-route-guards.tsx PhiAccessDenied, lib/api/health.ts canAccessPhiAccessLogs)
- **Detail:** Actor and Student columns print truncated UUIDs ("7f3a9c1e…") in monospace — an audit log that cannot name who accessed whose record is not reviewable without a second system.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-236 · `/health/phi-access` — No filters, date range, search or pagination; listPhiAccessLogs returns every ev…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/phi-access/page.tsx (+ lib/auth/health-route-guards.tsx PhiAccessDenied, lib/api/health.ts canAccessPhiAccessLogs)
- **Detail:** No filters, date range, search or pagination; listPhiAccessLogs returns every event for the tenant into one table.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-237 · `/health/screenings` — The page is read-only: there is no "New program" action, no row link and no way…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/screenings/page.tsx
- **Detail:** The page is read-only: there is no "New program" action, no row link and no way to record results, although the route validates "configurable screening programs" (per the file header comment on configurable screening programs).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-238 · `/health/special-needs` — "Add to register" and the per-row View / Edit buttons have no handler or href —…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/special-needs/page.tsx
- **Detail:** "Add to register" and the per-row View / Edit buttons have no handler or href — the register cannot be changed from the UI although the notice says accommodations are binding across modules.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-239 · `/health/vaccinations` — Each row’s primary label is the truncated student UUID ("7f3a9c1e…") linking to…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/vaccinations/page.tsx
- **Detail:** Each row’s primary label is the truncated student UUID ("7f3a9c1e…") linking to /health/[studentId]; names are never resolved.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-240 · `/health/vaccinations/new` — "Student ID" is a raw UUID v4 text input (create-vaccination-form.tsx); replaced…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/health/vaccinations/new/page.tsx (+ _components/create-vaccination-form.tsx)
- **Detail:** "Student ID" is a raw UUID v4 text input (create-vaccination-form.tsx); replaced by a student picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · registration (13)

### B-241 · `/` — StatsBar values (“12,847”, “2.5M”, “98%”, “✓”) are hard-coded literals in page.t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/page.tsx
- **Detail:** StatsBar values (“12,847”, “2.5M”, “98%”, “✓”) are hard-coded literals in page.tsx, not from any API — a public portal showing invented figures; the fourth “stat” is a tick glyph.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-242 · `/` — Institution type cards pass typeId=primary|secondary|tvet|preschool to /schools,…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/page.tsx
- **Detail:** Institution type cards pass typeId=primary|secondary|tvet|preschool to /schools, but the institutions API filters by typeId as an entity id (lib/api.ts getInstitutions → InstitutionLocation.typeId) — the slug is unlikely to match, so the pre-filter silently does nothing. Not verifiable without the backend.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-243 · `/apply/[institutionType]` — Invalid date / email / phone show raw error codes: errorMessage() in personal-in…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/page.tsx + components/registration/personal-info-form.tsx
- **Detail:** Invalid date / email / phone show raw error codes: errorMessage() in personal-info-form.tsx returns the code itself (“invalid_date”, “invalid_email”, “invalid_phone”) for anything other than “required”, although translated strings exist in messages/en.json (registration.invalidDateOfBirth…).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-244 · `/apply/[institutionType]` — The applicant is never shown which school they are applying to — the page only p…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/page.tsx + components/registration/personal-info-form.tsx
- **Detail:** The applicant is never shown which school they are applying to — the page only prints the raw institutionType slug (“secondary”) as the eyebrow; the school name is not fetched. Mockup adds a school-context card with “Change school”.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-245 · `/apply/[institutionType]/documents` — Next is disabled while required documents are missing but nothing tells the user…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/documents/page.tsx + components/registration/documents-step.tsx + document-upload.tsx
- **Detail:** Next is disabled while required documents are missing but nothing tells the user which ones (documents-step.tsx computes missingRequired and only uses it for `disabled`). Mockup adds a summary alert.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-246 · `/apply/[institutionType]/documents` — File bytes live only in memory (registration-context.tsx fileMapRef); after a re…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/documents/page.tsx + components/registration/documents-step.tsx + document-upload.tsx
- **Detail:** File bytes live only in memory (registration-context.tsx fileMapRef); after a refresh the chip still shows the file as uploaded, and the loss is discovered only at submit on the review step (“must be re-uploaded before submit”).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-247 · `/apply/[institutionType]/review` — The “Institution” row prints configuration.institutionId — a raw UUID — instead…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/review/page.tsx + components/registration/review-step.tsx
- **Detail:** The “Institution” row prints configuration.institutionId — a raw UUID — instead of the school name (review-step.tsx line ~180); Gender prints the enum value (“male”) and Date of Birth the raw ISO string.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-248 · `/apply/[institutionType]/review` — Documents are listed as “{documentType}: {fileName}” where documentType is the f…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/[institutionType]/review/page.tsx + components/registration/review-step.tsx
- **Detail:** Documents are listed as “{documentType}: {fileName}” where documentType is the form field id, not its label; there is no Edit link back to a section, and no declaration/consent step before an irreversible submit.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-249 · `/apply/success` — If sessionStorage has no tracking number (new tab, cleared storage, direct visit…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/apply/success/page.tsx + success-card.tsx
- **Detail:** If sessionStorage has no tracking number (new tab, cleared storage, direct visit) the card shows a bare “—” with no explanation and no Track button (success-card.tsx). Mockup designs a recovery message.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-250 · `/schools` — No pagination: the page requests pageSize = MAX_PUBLIC_PAGE_SIZE once and ignore…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/schools/page.tsx + components/institutions/institution-map.tsx
- **Detail:** No pagination: the page requests pageSize = MAX_PUBLIC_PAGE_SIZE once and ignores meta.totalPages (institution-map.tsx), so districts with more schools than one page are silently truncated and the “N schools found” count is wrong.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-251 · `/track` — On submit the student’s date of birth is put in the URL query string (?dob=2012-…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/track/page.tsx + components/tracking/tracking-form.tsx
- **Detail:** On submit the student’s date of birth is put in the URL query string (?dob=2012-03-14, tracking-form.tsx) — a child’s PII ends up in browser history, server logs and shared links.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-252 · `/track/[trackingNumber]` — Any API failure is caught and rendered as “No application was found…” (page.tsx…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/track/[trackingNumber]/page.tsx + components/tracking/status-card.tsx
- **Detail:** Any API failure is caught and rendered as “No application was found…” (page.tsx try/catch → result = null) — an outage is indistinguishable from a wrong tracking number, and there is no retry.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-253 · `/track/[trackingNumber]` — Verification value (student DOB) is read from the URL query (?dob=) and re-sent…
- **Status:** OPEN
- **Evidence:** ux-review · apps/registration-portal/src/app/track/[trackingNumber]/page.tsx + components/tracking/status-card.tsx
- **Detail:** Verification value (student DOB) is read from the URL query (?dob=) and re-sent as a GET parameter (checkApplicationStatus) — PII in URLs, history, and logs.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · examinations (13)

### B-254 · `/examinations` — No search, filter or pagination: listExaminations() returns everything and the t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/page.tsx
- **Detail:** No search, filter or pagination: listExaminations() returns everything and the table renders all rows — a school with years of exam cycles gets one unbounded list (the mockup adds a filter bar).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-255 · `/examinations/[id]` — The hero (layout.tsx) has no actions at all — no Edit, no cancel/close, no "open…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/page.tsx
- **Detail:** The hero (layout.tsx) has no actions at all — no Edit, no cancel/close, no "open registration" — and no edit route exists for an examination after creation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-256 · `/examinations/[id]/candidates` — The Student column prints candidate.studentId in monospace — a raw UUID with no…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/candidates/page.tsx
- **Detail:** The Student column prints candidate.studentId in monospace — a raw UUID with no name — and "Registration #" is the first 8 chars of the candidate id upper-cased (candidates/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-257 · `/examinations/[id]/candidates` — RegisterCandidateDialog takes "Student ID" as a text input with placeholder "Stu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/candidates/page.tsx
- **Detail:** RegisterCandidateDialog takes "Student ID" as a text input with placeholder "Student UUID"; no student search, so registration is impossible without copying ids from elsewhere.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-258 · `/examinations/[id]/documents` — No progress feedback for processing jobs beyond "128 / 412" text; the page is a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/documents/page.tsx
- **Detail:** No progress feedback for processing jobs beyond "128 / 412" text; the page is a server component with no polling, so the user must reload to see completion.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-259 · `/examinations/[id]/ops` — Four unrelated workflows (sessions, seating, double entry, re-evaluation) are st…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/ops/page.tsx
- **Detail:** Four unrelated workflows (sessions, seating, double entry, re-evaluation) are stacked on one 590-line panel (exam-ops-panel.tsx) sharing a single state.message; a success from "Resolve marks" shows above the sessions form.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-260 · `/examinations/[id]/ops` — Staff, candidate and evaluator are all raw-UUID text inputs (placeholders "Staff…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/ops/page.tsx
- **Detail:** Staff, candidate and evaluator are all raw-UUID text inputs (placeholders "Staff UUID", "Candidate ID", "Evaluator UUID") — none of the four forms has a picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-261 · `/examinations/[id]/results` — The Student column is the raw studentId in monospace; the marks CSV is keyed by…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/results/page.tsx
- **Detail:** The Student column is the raw studentId in monospace; the marks CSV is keyed by studentId too (placeholder ",85,55") — no names anywhere in the results flow.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-262 · `/examinations/[id]/results` — "Publish results" is a single button press that locks marks and exposes them to…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/[id]/results/page.tsx
- **Detail:** "Publish results" is a single button press that locks marks and exposes them to parents; exam-ops-controls.tsx shows no confirmation dialog — the mockup adds one.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-263 · `/examinations/board-exports` — Institution is a free-text "Institution ID" field and the cohort is "Student IDs…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/board-exports/page.tsx
- **Detail:** Institution is a free-text "Institution ID" field and the cohort is "Student IDs" pasted as a UUID list (board-export-trigger-form.tsx) — no pickers on a compliance-critical form.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-264 · `/examinations/board-exports` — Successful jobs show the artifact as the last two path segments of artifactUri i…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/board-exports/page.tsx
- **Detail:** Successful jobs show the artifact as the last two path segments of artifactUri in monospace text, not a download link; users cannot actually get the pack from this page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-265 · `/examinations/new` — PageHeader description is developer text: "Creates via POST /examinations — name…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/new/page.tsx
- **Detail:** PageHeader description is developer text: "Creates via POST /examinations — name, code, academic period, window, subject, centre, and grading scheme (Req. 10.1 / 10.7)." (new/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-266 · `/examinations/new` — The form allows exactly one subject and one centre (subjects.0.*, centers.0.*) a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/examinations/new/page.tsx
- **Detail:** The form allows exactly one subject and one centre (subjects.0.*, centers.0.*) although an exam cycle normally spans several subjects and centres; there is no "add another" control.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · fees (11)

### B-267 · `/fees/dunning` — Overdue table prints the full studentId UUID in a  cell and the send-audit list…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/dunning/page.tsx
- **Detail:** Overdue table prints the full studentId UUID in a  cell and the send-audit list prints full invoiceId UUIDs (dunning-console.tsx) — no student name, class or guardian contact anywhere on a page whose job is contacting families.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-268 · `/fees/dunning` — Sending reminders to N families has no confirmation and no preview of the messag…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/dunning/page.tsx
- **Detail:** Sending reminders to N families has no confirmation and no preview of the message; "Remove" on a suppression is also a one-click destructive action.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-269 · `/fees/invoices` — Student is entered as a raw UUID v4 text field ("Student UUID", validated by UUI…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/invoices/page.tsx
- **Detail:** Student is entered as a raw UUID v4 text field ("Student UUID", validated by UUID_RE in new-invoice-form.tsx); the list shows "Student 3f9a2c1e…" and "plan 8b1d…" truncated ids instead of names.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-270 · `/fees/invoices` — "Pay (sandbox)" fires payInvoiceStaffAction on a single click with no confirmati…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/invoices/page.tsx
- **Detail:** "Pay (sandbox)" fires payInvoiceStaffAction on a single click with no confirmation, and the refund dialog defaults to the full paid amount — both are money-moving actions without a confirm step (pay-invoice-staff-button.tsx, refund-dialog.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-271 · `/fees/plans` — Plans are read-only after creation: no edit, archive or delete action exists in…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/plans/page.tsx
- **Detail:** Plans are read-only after creation: no edit, archive or delete action exists in plans/page.tsx or new-fee-plan-form.tsx; a typo in the amount can only be fixed by creating a second plan.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-272 · `/fees/receipts` — Receipt rows show "invoice 8b1d2c3e…" (truncated invoiceId) and no student name…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/receipts/page.tsx
- **Detail:** Receipt rows show "invoice 8b1d2c3e…" (truncated invoiceId) and no student name — staff cannot answer "did the Mehta family pay?" from this page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-273 · `/fees/reconciliation` — CSV must be pasted into a plain text area (reconciliation-workspace.tsx); there…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/reconciliation/page.tsx
- **Detail:** CSV must be pasted into a plain text area (reconciliation-workspace.tsx); there is no file upload, so a 500-line bank export has to be opened and copied by hand.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-274 · `/fees/reports` — Dues-by-class rows are labelled "Class 3f9a2c1e…" — classId.slice(0,8) — because…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/reports/page.tsx
- **Detail:** Dues-by-class rows are labelled "Class 3f9a2c1e…" — classId.slice(0,8) — because DuesReport.byClass carries no class name (fees-reports-panel.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-275 · `/fees/scholarship-netting` — All four inputs are raw ids typed by hand — "Student UUID", "Disbursement ID", "…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/scholarship-netting/page.tsx
- **Detail:** All four inputs are raw ids typed by hand — "Student UUID", "Disbursement ID", "Invoice UUID (optional)" (scholarship-netting-form.tsx). The officer must copy ids from Scholarships → Disbursements; the natural flow is a "Net against fees" action on a processed disbursement.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-276 · `/fees/structures` — Bulk invoice form takes "Class UUID" and "Student UUIDs (comma-separated)" as fr…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/structures/page.tsx
- **Detail:** Bulk invoice form takes "Class UUID" and "Student UUIDs (comma-separated)" as free text (structures-workspace.tsx); there is no picker and no preview of how many students will be invoiced before the action runs.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-277 · `/fees/structures` — Bulk invoicing a class is irreversible (creates N invoices visible to parents) a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/fees/structures/page.tsx
- **Detail:** Bulk invoicing a class is irreversible (creates N invoices visible to parents) and runs on a single click without confirmation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · communication (10)

### B-278 · `/communication/campaigns` — "Sandbox send" fires immediately on click with no confirmation (send-campaign-bu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/campaigns/page.tsx
- **Detail:** "Sandbox send" fires immediately on click with no confirmation (send-campaign-button.tsx onSend) although it changes status to sent and writes delivery rows for every recipient.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-279 · `/communication/campaigns` — listCampaigns uses throwOnError:false and returns [] on failure, so a gateway ou…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/campaigns/page.tsx
- **Detail:** listCampaigns uses throwOnError:false and returns [] on failure, so a gateway outage renders the same "No campaigns yet." as a genuinely empty tenant.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-280 · `/communication/campaigns/new` — Hostel and route scopes ask for a raw "Hostel UUID (optional)" / "Route UUID (op…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/campaigns/new/page.tsx (+ _components/new-campaign-form.tsx)
- **Detail:** Hostel and route scopes ask for a raw "Hostel UUID (optional)" / "Route UUID (optional)" text input (new-campaign-form.tsx); users cannot know these ids. Replaced here by pickers.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-281 · `/communication/circulars/[id]` — The manual ack form asks for a raw "Recipient id" text input (circular-ack-panel…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/circulars/[id]/page.tsx (+ _components/circular-ack-panel.tsx)
- **Detail:** The manual ack form asks for a raw "Recipient id" text input (circular-ack-panel.tsx); staff have no way to look up that id from this screen.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-282 · `/communication/circulars/[id]` — "Send circular" fires without confirmation and creates ack rows for every recipi…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/circulars/[id]/page.tsx (+ _components/circular-ack-panel.tsx)
- **Detail:** "Send circular" fires without confirmation and creates ack rows for every recipient; there is no recipient count or summary before sending.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-283 · `/communication/circulars/new` — "Audience ids (comma-separated)" and "Recipient ids (comma-separated)" are raw U…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/circulars/new/page.tsx (+ _components/new-circular-form.tsx, actions.ts createCircularAction)
- **Detail:** "Audience ids (comma-separated)" and "Recipient ids (comma-separated)" are raw UUID text inputs (new-circular-form.tsx); the required recipientIds list cannot realistically be typed by an admin. Replaced by an auto-resolved picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-284 · `/communication/delivery` — Rows print the raw recipientId ("whatsapp · failed · 7f3a9c1e-…") — the console…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/delivery/page.tsx (+ _components/delivery-log-table.tsx)
- **Detail:** Rows print the raw recipientId ("whatsapp · failed · 7f3a9c1e-…") — the console never resolves recipients to a name or masked phone/email.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-285 · `/communication/emergency` — Dual-confirm is enforced only server-side by actorId; the UI shows "Confirm as m…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/emergency/page.tsx (+ _components/emergency-blast-panel.tsx, actions.ts confirmEmergencyBlastAction)
- **Detail:** Dual-confirm is enforced only server-side by actorId; the UI shows "Confirm as me" to the same person who already gave confirmation 1 and only reports the rejection afterwards. The button should be disabled with the reason once the actor has confirmed.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-286 · `/communication/emergency` — "Sandbox dispatch" and "Confirm as me" are single-click buttons with no confirma…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/emergency/page.tsx (+ _components/emergency-blast-panel.tsx, actions.ts confirmEmergencyBlastAction)
- **Detail:** "Sandbox dispatch" and "Confirm as me" are single-click buttons with no confirmation dialog and no recipient count, for an action that bypasses quiet hours for every user in the tenant.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-287 · `/communication/emergency` — Confirmations render as text "confirm 1 recorded · confirm 2 recorded" without w…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/communication/emergency/page.tsx (+ _components/emergency-blast-panel.tsx, actions.ts confirmEmergencyBlastAction)
- **Detail:** Confirmations render as text "confirm 1 recorded · confirm 2 recorded" without who/when, so the second actor cannot verify they are actually a distinct person from the first.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · hostel (10)

### B-288 · `/hostel/assignments` — Assignment rows read "Student 3f9a2c1e · bed 8b1d2c3e" — both are truncated UUID…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/assignments/page.tsx
- **Detail:** Assignment rows read "Student 3f9a2c1e · bed 8b1d2c3e" — both are truncated UUIDs (assignments/page.tsx). Neither student name nor bed label is shown, so the list is unusable for a warden.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-289 · `/hostel/assignments` — New assignment takes "Student UUID" as free text; the bed select lists labels bu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/assignments/page.tsx
- **Detail:** New assignment takes "Student UUID" as free text; the bed select lists labels but falls back to a "Bed UUID" input when no beds exist (new-assignment-form.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-290 · `/hostel/attendance` — Roll call is one form submission per student with a typed "Student UUID" (attend…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/attendance/page.tsx
- **Detail:** Roll call is one form submission per student with a typed "Student UUID" (attendance-form.tsx); a 48-bed block needs 48 submissions. There is no list of residents to tick off.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-291 · `/hostel/attendance` — Roll rows print the status word first and "student 3f9a2c1e" second — the person…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/attendance/page.tsx
- **Detail:** Roll rows print the status word first and "student 3f9a2c1e" second — the person is a truncated UUID, so absences cannot be acted on from this page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-292 · `/hostel/fees` — Amount is entered in paise ("Amount (cents)" label in fee-structure-form.tsx) an…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/fees/page.tsx
- **Detail:** Amount is entered in paise ("Amount (cents)" label in fee-structure-form.tsx) and listed as "3800000 INR" (raw amountCents, no formatting) — an Indian accounts officer will enter ₹38,000 and create a ₹380 structure.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-293 · `/hostel/gate-passes` — Each row is "pending · overdue return / student 3f9a2c1e · out 2026-09-26T16:00…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/gate-passes/page.tsx
- **Detail:** Each row is "pending · overdue return / student 3f9a2c1e · out 2026-09-26T16:00 → in 2026-09-26T19:00" — raw enum, truncated UUID and sliced ISO timestamps; no student name, hostel, or requester shown.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-294 · `/hostel/leaves` — LeaveDecisionButtons renders Approve and Reject on every row regardless of statu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/leaves/page.tsx
- **Detail:** LeaveDecisionButtons renders Approve and Reject on every row regardless of status (the status prop is accepted but never checked in leave-decision-buttons.tsx), so an approved leave can be rejected again with one click and no confirmation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-295 · `/hostel/leaves` — Rows are "Student 3f9a2c1e · pending" — truncated UUID, no name, class or bed; t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/leaves/page.tsx
- **Detail:** Rows are "Student 3f9a2c1e · pending" — truncated UUID, no name, class or bed; the warden cannot recognise who is asking.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-296 · `/hostel/mess` — Menu items and subscriptions are write-only: mess-ops-forms.tsx posts them but p…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/mess/page.tsx
- **Detail:** Menu items and subscriptions are write-only: mess-ops-forms.tsx posts them but page.tsx only lists plans ("3 meals · active"), so nobody can see this week's menu or who is subscribed.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-297 · `/hostel/visitors` — Rows show "student 3f9a2c1e" (truncated UUID) — security at the gate cannot see…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/hostel/visitors/page.tsx
- **Detail:** Rows show "student 3f9a2c1e" (truncated UUID) — security at the gate cannot see which child is being visited; no relationship or phone is captured by NewVisitorForm.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · students (9)

### B-298 · `/students` — Grade filter is permanently empty: page.tsx hard-codes `const grades = []` (comm…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/page.tsx
- **Detail:** Grade filter is permanently empty: page.tsx hard-codes `const grades = []` (comment admits GET /institutions returns no grades), so the 'All grades' select can never filter and the Grade / Section column renders '—' for the demo tenant.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-299 · `/students/[id]` — Raw ids in the UI: CurrentEnrollmentCard renders `enrollment.institutionId` and…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/[id]/page.tsx
- **Detail:** Raw ids in the UI: CurrentEnrollmentCard renders `enrollment.institutionId` and falls back to `enrollment.gradeId`; EnrollmentTab and Transfers tables print institutionId / sourceInstitutionId / destinationInstitutionId; SiblingsCard lists `row.siblingId` as a mono UUID and asks for a 'Sibling student ID' text input rather than a student picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-300 · `/students/[id]` — 'Graduate' (graduate-student-button.tsx) and bulk graduate use window.confirm an…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/[id]/page.tsx
- **Detail:** 'Graduate' (graduate-student-button.tsx) and bulk graduate use window.confirm and then only print the result as small text; no undo and the page does not refresh the status pill after success.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-301 · `/students/[id]/transfer` — Source enrollment options are rendered as `Institution {institutionId} · Grade {…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/[id]/transfer/page.tsx
- **Detail:** Source enrollment options are rendered as `Institution {institutionId} · Grade {gradeId}` (transfer-form.tsx) — raw UUIDs in a user-facing select.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-302 · `/students/[id]/transfer` — The Transfer checklist (CHECKLIST_ITEMS) and Approval chain (APPROVAL_STEPS) are…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/[id]/transfer/page.tsx
- **Detail:** The Transfer checklist (CHECKLIST_ITEMS) and Approval chain (APPROVAL_STEPS) are hard-coded constants in page.tsx: 'All fees settled: Pending term 2 balance' and 'Parent consent: Required' are shown for every student regardless of reality, and every approval step is always 'upcoming'.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-303 · `/students/import` — ImportStepper is 'visual-only' (active={1} hard-coded in page.tsx) — it never ad…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/import/page.tsx
- **Detail:** ImportStepper is 'visual-only' (active={1} hard-coded in page.tsx) — it never advances to Validate / Review / Import even while the client panel is processing or showing results.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-304 · `/students/new` — The photo drop-zone in student-form.tsx is decorative on create: 'Browse files'…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/new/page.tsx
- **Detail:** The photo drop-zone in student-form.tsx is decorative on create: 'Browse files' is permanently disabled and the user is told to upload from the profile afterwards — a dead control in the first card of the form.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-305 · `/students/records` — The only input is a raw 'Student ID' text field (issue-transcript-form.tsx) and…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/records/page.tsx
- **Detail:** The only input is a raw 'Student ID' text field (issue-transcript-form.tsx) and the transcripts table prints studentId as a mono UUID — no student name anywhere on the page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-306 · `/students/records` — GPA snapshots and report-card jobs are rendered as concatenated  strings ('statu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/students/records/page.tsx
- **Detail:** GPA snapshots and report-card jobs are rendered as concatenated  strings ('status · student … · artifactUri ?? errorMessage ?? id') with no table, no status pill and error text mixed with file paths.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · website (7)

### B-307 · `/about` — The “proctira / proctira-erp” repository card is a plain  with no link to GitHub…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/about/page.tsx
- **Detail:** The “proctira / proctira-erp” repository card is a plain  with no link to GitHub (about/page.tsx lines 426–439), yet the installation page sends “Browse the source on GitHub” here (#opensource). Visitors reach a dead end.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-308 · `/cookies` — The policy refers to “the consent banner on this site” but no consent banner or…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/cookies/page.tsx
- **Detail:** The policy refers to “the consent banner on this site” but no consent banner or cookie-preferences control exists anywhere in apps/public-website — the promised opt-out cannot be exercised.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-309 · `/installation` — “Browse the source on GitHub” and “Read the full deployment docs” both link to /…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/installation/page.tsx
- **Detail:** “Browse the source on GitHub” and “Read the full deployment docs” both link to /about#opensource (installation/page.tsx lines 655, 793), where the repository card is not a link — neither promise is kept.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-310 · `/installation` — Requirements table (4 columns, w-full) has no overflow wrapper or card transform…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/installation/page.tsx
- **Detail:** Requirements table (4 columns, w-full) has no overflow wrapper or card transform; at 390 px it forces horizontal page scroll. Mockup wraps it in .table-wrap and adds data-label cells.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-311 · `/privacy` — The policy is boilerplate: the first paragraph literally says “It is provided as…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/privacy/page.tsx
- **Detail:** The policy is boilerplate: the first paragraph literally says “It is provided as a starting template and should be tailored… before publication” and the banner says the effective date is unset (privacy/page.tsx). Shipping this to a public route is a legal-review blocker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-312 · `/status` — Three of six components (SMS, DBT, Reports) can never be probed — probeKey is nu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/status/page.tsx
- **Detail:** Three of six components (SMS, DBT, Reports) can never be probed — probeKey is null in SERVICES — so even a fully configured deployment shows “Not monitored” for half the board.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-313 · `/terms` — “Governing law” contains an instruction to the operator (“Operators must replace…
- **Status:** OPEN
- **Evidence:** ux-review · apps/public-website/src/app/terms/page.tsx
- **Detail:** “Governing law” contains an instruction to the operator (“Operators must replace this section with the applicable jurisdiction.”) rendered to end users — unfinished legal text on a public route (terms/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · auth (7)

### B-314 · `/login` — Two competing primary paths: a full-width "Sign in with SSO (Keycloak)" button s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/login/page.tsx + login-form.tsx + components/auth/auth-demo-mode-banner.tsx + oauth-icon.tsx
- **Detail:** Two competing primary paths: a full-width "Sign in with SSO (Keycloak)" button sits above the email form, then OAuth buttons below — three sign-in methods with no guidance on which one a given school uses. Copy also leaks the IdP product name ("Keycloak").
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-315 · `/mfa` — The "Resend" button is a  with no onClick handler — it does nothing. For TOTP th…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/mfa/page.tsx + mfa-form.tsx (MfaCodeInput from @proctira/ui)
- **Detail:** The "Resend" button is a  with no onClick handler — it does nothing. For TOTP there is nothing to resend; the copy "Didn't receive a code?" is SMS-OTP language that misleads authenticator-app users.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-316 · `/mfa-setup` — MFASetup.tsx is a Vite-era React Router feature mounted inside Next via : its "B…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/mfa-setup/page.tsx → mfa-setup-loader.tsx → mfa-setup-client.tsx → features/auth/MFASetup.tsx; (auth)/mfa/setup/page.tsx and app/auth/mfa-setup/page.tsx are permanentRedirect stubs
- **Detail:** MFASetup.tsx is a Vite-era React Router feature mounted inside Next via : its "Back to sign in" links go to /auth/signin and "Finish setup" navigates to /auth/mfa-verify — neither exists in the App Router (the real routes are /login and /mfa), so both exits are dead. It also loads with ssr:false, so the page is blank until the client bundle runs.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-317 · `/mfa-setup` — Enrolment is never verified: handleFinish only navigates after the checkbox; the…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/mfa-setup/page.tsx → mfa-setup-loader.tsx → mfa-setup-client.tsx → features/auth/MFASetup.tsx; (auth)/mfa/setup/page.tsx and app/auth/mfa-setup/page.tsx are permanentRedirect stubs
- **Detail:** Enrolment is never verified: handleFinish only navigates after the checkbox; the TOTP secret is not confirmed with a first code before the user leaves, and the comment admits setupMfa() is mocked client-side.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-318 · `/oauth/callback` — page.tsx iterates Object.entries(searchParams) but searchParams is typed as a Pr…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/oauth/callback/page.tsx → /api/auth/oauth/callback
- **Detail:** page.tsx iterates Object.entries(searchParams) but searchParams is typed as a Promise in this Next 15 signature and is never awaited — on Next 15 the loop sees no entries and the redirect drops code and state, breaking the OAuth exchange (page-level bug, not just UX).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-319 · `/reset-password` — The token is only checked on submit: a user with an expired/missing ?token= fill…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/reset-password/page.tsx + reset-password-form.tsx (PasswordStrengthMeter, scorePasswordDetails)
- **Detail:** The token is only checked on submit: a user with an expired/missing ?token= fills in both passwords before learning "This reset link is missing or invalid." No pre-flight validation of the token on page load.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-320 · `/signup` — The "Institution" field is free text ("Your school or organization") with no ten…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(auth)/signup/page.tsx + signup-form.tsx (RolePicker, PasswordStrengthMeter, fetchSignupRoles, signUp)
- **Detail:** The "Institution" field is free text ("Your school or organization") with no tenant lookup, while roles are fetched from GET /api/v1/tenant/signup-roles — a self-serve sign-up on a multi-tenant school ERP with no way to know which tenant the account lands in, and the login page says "Don't have an account? Contact your administrator."
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · admin (7)

### B-321 · `/admin` — ScaffoldModeBanner is rendered with `force` so the "Scaffold / demo mode" warnin…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/page.tsx
- **Detail:** ScaffoldModeBanner is rendered with `force` so the "Scaffold / demo mode" warning shows on every load, even in production with live APIs (admin/page.tsx line ~337). It trains admins to ignore the banner.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-322 · `/admin/notification-rules` — Delete fires immediately with no confirmation (RuleRowActions.handleDelete in no…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/notification-rules/page.tsx
- **Detail:** Delete fires immediately with no confirmation (RuleRowActions.handleDelete in notification-rules-controls.tsx); the trash icon sits 8 px from the pause switch.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-323 · `/admin/permissions` — All 184 permissions render in a single flat table with no search, module filter,…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/permissions/page.tsx
- **Detail:** All 184 permissions render in a single flat table with no search, module filter, grouping or pagination (permissions/page.tsx sorts and maps the whole catalogue).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-324 · `/admin/roles` — Delete role uses window.confirm() (DeleteRoleButton) and never says how many use…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/roles/page.tsx
- **Detail:** Delete role uses window.confirm() (DeleteRoleButton) and never says how many users hold the role, although that is exactly the information needed before deleting.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-325 · `/admin/tenant` — Primary / accent colour are free-text inputs expecting a hex string with no colo…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/tenant/page.tsx
- **Detail:** Primary / accent colour are free-text inputs expecting a hex string with no colour picker or swatch preview (TenantSettingsForm primaryColor / accentColor); a typo silently breaks the tenant theme.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-326 · `/admin/users` — Suspend uses window.confirm() (admin-console-controls.tsx UserRowActions.toggleS…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/users/page.tsx
- **Detail:** Suspend uses window.confirm() (admin-console-controls.tsx UserRowActions.toggleStatus) — native, unstyled, not translated, and the "Reactivate" path has no confirmation at all.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-327 · `/admin/users` — No search, filter, sort or pagination: listTenantUsers() renders every account i…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admin/users/page.tsx
- **Detail:** No search, filter, sort or pagination: listTenantUsers() renders every account in one table. A school with 150 staff scrolls a 150-row page to find one person.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · assessments (7)

### B-328 · `/assessments` — page.tsx reads `search`, `type` and `page` from the URL and passes them to listG…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/page.tsx
- **Detail:** page.tsx reads `search`, `type` and `page` from the URL and passes them to listGradingSchemes, but renders no search box, type filter or pagination controls — the filters are unreachable from the UI and the list is capped at 25 with no next page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-329 · `/assessments/items` — The weight-sum rule (must equal 100%) is only reported after submit as an `error…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/items/page.tsx
- **Detail:** The weight-sum rule (must equal 100%) is only reported after submit as an `errors.items.message`; there is no running total while the user edits weights (assessment-items-form.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-330 · `/assessments/outcomes` — Subtitle says "Link these IDs on assessment items" but neither this page nor ass…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/outcomes/page.tsx
- **Detail:** Subtitle says "Link these IDs on assessment items" but neither this page nor assessment-items-form.tsx has any outcome-linking control — the feature the page exists for is absent.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-331 · `/assessments/report-cards` — page.tsx only ever lists sections of institutionList[0] — the first institution…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/report-cards/page.tsx
- **Detail:** page.tsx only ever lists sections of institutionList[0] — the first institution returned — with no institution selector; a multi-school tenant can never see other schools' classes here.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-332 · `/assessments/results` — The first grid column is literally "Student UUID" — a free-text input validated…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/results/page.tsx
- **Detail:** The first grid column is literally "Student UUID" — a free-text input validated with UUID_REGEX ("Student UUID is not a valid UUID"); teachers have no student picker and no names appear anywhere in the grid (results-entry-grid.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-333 · `/assessments/results` — The grid starts empty: there is no "load the class roster" step, so a teacher mu…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/results/page.tsx
- **Detail:** The grid starts empty: there is no "load the class roster" step, so a teacher must add one row per student by hand and know each student's id; the CSV import likewise keys rows by studentId.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-334 · `/assessments/schemes/[id]/edit` — Editing bands on a scheme already used by assessment items silently changes how…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/assessments/schemes/[id]/edit/page.tsx
- **Detail:** Editing bands on a scheme already used by assessment items silently changes how existing results are graded ("will continue to use the new bounds") — no impact warning, no usage count, no versioning.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · reports (7)

### B-335 · `/reports` — Board summary requires the user to paste a board UUID into a text box (board-sum…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/page.tsx
- **Detail:** Board summary requires the user to paste a board UUID into a text box (board-summary-panel.tsx L1325–1330, placeholder 'e.g. board UUID'); the session already knows the tenant's board(s).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-336 · `/reports` — Two competing generate paths on one page: each card's 'Run' goes to /reports/new…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/page.tsx
- **Detail:** Two competing generate paths on one page: each card's 'Run' goes to /reports/new, while the 'Generate export' panel (catalogue-generate-panel.tsx) generates in place and downloads — same action, different flows, and neither links to the run's results page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-337 · `/reports/[id]/results` — There is no way to run the report from its results page — no 'Run again' button…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/[id]/results/page.tsx
- **Detail:** There is no way to run the report from its results page — no 'Run again' button (page.tsx L263–273); the user must go back to the catalogue. The mockup adds one.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-338 · `/reports/new` — The only required filter in the catalogue, 'Academic period', is a plain text In…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/new/page.tsx
- **Detail:** The only required filter in the catalogue, 'Academic period', is a plain text Input expecting an academicPeriodId (catalogue.ts enrolment_by_grade: type 'text'; FilterControl L855–863). Users must know an internal ID; there is no period picker.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-339 · `/reports/new` — After 'Generate report' the page shows a text alert and stays put (L695–701): no…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/new/page.tsx
- **Detail:** After 'Generate report' the page shows a text alert and stays put (L695–701): no link to the run, no status polling, no download — the promise 'download once the run completes' is not fulfilled on this screen.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-340 · `/reports/schedules` — 'Delete' removes a schedule instantly with no confirmation (schedule-actions.tsx…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/schedules/page.tsx
- **Detail:** 'Delete' removes a schedule instantly with no confirmation (schedule-actions.tsx L1069–1082) — a ghost button sitting next to 'Run now' and 'Pause'.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-341 · `/reports/schedules` — Hour is entered and displayed in UTC (schedule-form.tsx L1213–1215, table column…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/reports/schedules/page.tsx
- **Detail:** Hour is entered and displayed in UTC (schedule-form.tsx L1213–1215, table column 'Hour UTC' L948) for staff who work in IST; the mockup adds an IST hint but the model is wrong for the audience.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · transport (7)

### B-342 · `/transport/assignments` — Rows print "Driver 7f3a9c1e · vehicle 2b4c…" and "Student 9e12… · route 4a7b…" —…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/assignments/page.tsx (+ _components/assignment-forms.tsx)
- **Detail:** Rows print "Driver 7f3a9c1e · vehicle 2b4c…" and "Student 9e12… · route 4a7b…" — truncated UUIDs instead of names, registration numbers and route names.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-343 · `/transport/assignments` — "Driver staff UUID" and "Student UUID" are raw text inputs validated by regex (a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/assignments/page.tsx (+ _components/assignment-forms.tsx)
- **Detail:** "Driver staff UUID" and "Student UUID" are raw text inputs validated by regex (assignment-forms.tsx); replaced by pickers. The Stop select lists every stop of every route, not just the chosen route’s.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-344 · `/transport/attendance` — Marking is one student per form submit: pick route, date, direction, student (a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/attendance/page.tsx (+ _components/attendance-panel.tsx)
- **Detail:** Marking is one student per form submit: pick route, date, direction, student (a select of truncated UUIDs "7f3a9c1e · route 4a7b…"), status, then "Save mark". A 40-seat bus needs 40 submissions.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-345 · `/transport/attendance` — The trip roster is never rendered — trip.data is fetched but only the summary co…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/attendance/page.tsx (+ _components/attendance-panel.tsx)
- **Detail:** The trip roster is never rendered — trip.data is fetched but only the summary counts are shown in the card description; the attendant cannot see who is still unmarked.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-346 · `/transport/fees` — Fee links show only the raw status word and "invoice 7f3a9c1e" / reason text — n…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/fees/page.tsx (+ _components/fees-panel.tsx)
- **Detail:** Fee links show only the raw status word and "invoice 7f3a9c1e" / reason text — no student, route or stop, so a pending link cannot be traced to a family.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-347 · `/transport/live` — The freshly issued device key is printed in a plain status paragraph ("Key (copy…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/live/page.tsx (+ _components/live-map.tsx, gps-device-forms.tsx)
- **Detail:** The freshly issued device key is printed in a plain status paragraph ("Key (copy now): …") with no copy control, no masking and no persistence warning — and it is shown next to a ping form that asks the same key back in a plain text input.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-348 · `/transport/routes/[id]/stops` — "Remove" deletes a stop immediately with no confirmation (stops-manager.tsx dele…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/transport/routes/[id]/stops/page.tsx (+ _components/stops-manager.tsx)
- **Detail:** "Remove" deletes a stop immediately with no confirmation (stops-manager.tsx deleteRouteStopAction on click), even when students are assigned to it.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · workflows (7)

### B-349 · `/workflows` — A definition can be viewed but never edited, versioned or deactivated from the U…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/page.tsx
- **Detail:** A definition can be viewed but never edited, versioned or deactivated from the UI: the only row action is 'View' (page.tsx L186–196) and the detail page offers just 'New definition'. Active/Inactive is display-only.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-350 · `/workflows/approvals` — Reject fires immediately with no confirmation and no reason / comment field (app…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/approvals/page.tsx
- **Detail:** Reject fires immediately with no confirmation and no reason / comment field (approval-decision-buttons.tsx L738–741) — an irreversible decision on a student transfer or fee waiver with one click.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-351 · `/workflows/approvals` — Subject is rendered as subjectType + raw UUID in a code chip (approvals/page.tsx…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/approvals/page.tsx
- **Detail:** Subject is rendered as subjectType + raw UUID in a code chip (approvals/page.tsx L307–311). The approver cannot see which student, invoice or leave they are deciding on; the mockup adds a human summary line that the API does not provide.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-352 · `/workflows/definitions/[id]` — The only action is a Pencil-icon button labelled 'New definition' (page.tsx L569…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/definitions/[id]/page.tsx
- **Detail:** The only action is a Pencil-icon button labelled 'New definition' (page.tsx L569–574): the edit affordance leads to a blank create form, and there is no way to edit, deactivate or version this definition.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-353 · `/workflows/definitions/new` — Steps are authored as comma-separated text in a textarea ('stepName,roleName' pe…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/definitions/new/page.tsx
- **Detail:** Steps are authored as comma-separated text in a textarea ('stepName,roleName' per line — new-definition-form.tsx L839–852) and parsed with split(','); lines with a missing role are silently discarded (L765–775). This is a developer input, not a school administrator's.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-354 · `/workflows/definitions/new` — Approver role is free text (PRINCIPAL, DISTRICT_ADMIN) with no picker of the ten…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/definitions/new/page.tsx
- **Detail:** Approver role is free text (PRINCIPAL, DISTRICT_ADMIN) with no picker of the tenant's actual roles; a typo creates a step nobody can approve.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-355 · `/workflows/instances` — Subject column shows subjectType + raw UUID (instances/page.tsx L431–436); an ad…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/workflows/instances/page.tsx
- **Detail:** Subject column shows subjectType + raw UUID (instances/page.tsx L431–436); an administrator cannot tell which student or invoice a run concerns.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · developer (6)

### B-356 · `/` — Footer hard-codes “All systems operational” with a green dot (page.tsx line ~480…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/page.tsx + components/layout/site-header.tsx
- **Detail:** Footer hard-codes “All systems operational” with a green dot (page.tsx line ~480) while no probe exists; the public website’s /status page explicitly refuses to invent an all-green board. Mockup replaces it with an honest pill.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-357 · `/` — Marketing copy contradicts the docs: hero says “API v3”, “240+ endpoints”, host…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/page.tsx + components/layout/site-header.tsx
- **Detail:** Marketing copy contradicts the docs: hero says “API v3”, “240+ endpoints”, host api.proctira.dev/v3 and header X-Tenant; docs/page.tsx documents /api/v1, host api.example.edu and header X-Tenant-ID.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-358 · `/dashboard` — The route renders with no header, sidebar or footer: app/(portal)/layout.tsx def…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/dashboard/page.tsx + api-key-demo-form.tsx
- **Detail:** The route renders with no header, sidebar or footer: app/(portal)/layout.tsx defines a sidebar shell but no page lives inside the (portal) group, so /dashboard, /docs and /marketplace get only the root layout. Mockup adds the marketing header/footer for orientation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-359 · `/dashboard` — components/layout/sidebar.tsx links to /dashboard/api-keys, /dashboard/plugins,…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/dashboard/page.tsx + api-key-demo-form.tsx
- **Detail:** components/layout/sidebar.tsx links to /dashboard/api-keys, /dashboard/plugins, /dashboard/webhooks, /dashboard/sandbox — none of these routes exist — and uses emoji glyphs as icons.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-360 · `/docs` — Same missing-chrome problem as /dashboard: no header, nav or footer is rendered…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/docs/page.tsx
- **Detail:** Same missing-chrome problem as /dashboard: no header, nav or footer is rendered (no (portal) group page), so a visitor arriving from the marketing home has no way back except the browser.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-361 · `/marketplace` — No header, navigation or footer renders on this route (see /dashboard) — the cat…
- **Status:** OPEN
- **Evidence:** ux-review · apps/developer-portal/src/app/marketplace/page.tsx + marketplace-catalog.tsx + lib/marketplace-catalog.ts
- **Detail:** No header, navigation or footer renders on this route (see /dashboard) — the catalog is an orphan page.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · admissions (6)

### B-362 · `/admissions` — Three write forms (Update status, Create interview slot, Book interview) sit abo…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/page.tsx
- **Detail:** Three write forms (Update status, Create interview slot, Book interview) sit above the data they act on; the application list itself has no per-row actions, so the user must find a name in a dropdown instead of clicking the row.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-363 · `/admissions` — Create interview slot demands a raw 'Institution UUID'; waitlist rows show `app…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/page.tsx
- **Detail:** Create interview slot demands a raw 'Institution UUID'; waitlist rows show `app {applicationId.slice(0,8)}…`; application rows print status as the raw enum ('under_review') beside the institution.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-364 · `/admissions/[id]` — Offer rows read `{offer.status} · {feeAmount} {feeCurrency}` ('sent · 25000 INR'…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/[id]/page.tsx
- **Detail:** Offer rows read `{offer.status} · {feeAmount} {feeCurrency}` ('sent · 25000 INR') with raw enum status and an unformatted amount; Accept form pre-fills 'SANDBOX-PAY' as the payment reference in production UI.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-365 · `/admissions/[id]` — Send, Accept and Decline are one-click with no confirmation, although Accept irr…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/[id]/page.tsx
- **Detail:** Send, Accept and Decline are one-click with no confirmation, although Accept irreversibly enrols the student and Decline closes the offer.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-366 · `/admissions/enquiries` — Every lead row (enquiry-panel.tsx) embeds two full forms — stage select + Save s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/enquiries/page.tsx
- **Detail:** Every lead row (enquiry-panel.tsx) embeds two full forms — stage select + Save stage, and follow-up due/owner/notes + Add follow-up — plus a Convert button, so a 30-lead pipeline renders 90 inputs; there is no list/detail split, search, stage filter or sort.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-367 · `/admissions/merit` — 'Ingest entrance scores' asks for a raw 'Application ID' text input (merit-panel…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/admissions/merit/page.tsx
- **Detail:** 'Ingest entrance scores' asks for a raw 'Application ID' text input (merit-panel.tsx) — the officer must copy a UUID from another page; the same data can already be saved on /admissions/[id].
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · data-warehouse (6)

### B-368 · `/data-warehouse` — ScaffoldModeBanner copy is developer vocabulary shown to end users: 'backend/dat…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/page.tsx
- **Detail:** ScaffoldModeBanner copy is developer vocabulary shown to end users: 'backend/data-warehouse package remains PARKED', 'gateway', 'Insights surface' (page.tsx L84–93). A principal cannot act on it.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-369 · `/data-warehouse/field-mapping` — Steps 3 'Validate' and 4 'Run' have no routes: 'Continue to validate' only shows…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/field-mapping/page.tsx
- **Detail:** Steps 3 'Validate' and 4 'Run' have no routes: 'Continue to validate' only shows an alert (field-mapping-form.tsx L430–448). The stepper promises a wizard that ends at step 2.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-370 · `/data-warehouse/field-mapping` — Source columns and samples are hard-coded demo data ('Ada Lovelace', 'SCH-001',…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/field-mapping/page.tsx
- **Detail:** Source columns and samples are hard-coded demo data ('Ada Lovelace', 'SCH-001', L399–404) — the page never reads the file chosen on the import step, and there is no file name / column count context.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-371 · `/data-warehouse/import` — Database connection string is a plain text Input (import-source-forms.tsx L963–9…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/import/page.tsx
- **Detail:** Database connection string is a plain text Input (import-source-forms.tsx L963–972) — credentials in the URL are visible on screen and only masked later for the history row (L938). The mockup uses a password field.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-372 · `/data-warehouse/import` — 'Continue to mapping' is always enabled before any source is chosen or uploaded…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/import/page.tsx
- **Detail:** 'Continue to mapping' is always enabled before any source is chosen or uploaded (page.tsx L605–612); the stepper's step 1 can be skipped with no file attached.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-373 · `/data-warehouse/map` — The 'Map' card is a permanent placeholder — a dashed box saying 'Interactive map…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/data-warehouse/map/page.tsx
- **Detail:** The 'Map' card is a permanent placeholder — a dashed box saying 'Interactive map renders here.' (map/page.tsx L1068–1077). The route ships a promise, not a map; the mockup shows what a first marker layer should look like.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · attendance (5)

### B-374 · `/attendance` — The "Published section meetings" card prints "periodId=" in monospace on every s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/attendance/page.tsx
- **Detail:** The "Published section meetings" card prints "periodId=" in monospace on every slot and its description says "(ISO day 5)" — raw ids and ISO weekday numbers for teachers (page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-375 · `/attendance` — Scope has four dependent selects plus an explicit "Load roster" button; changing…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/attendance/page.tsx
- **Detail:** Scope has four dependent selects plus an explicit "Load roster" button; changing Institution reloads the page (router.push) and the class/period lists refill — three round-trips before a teacher can mark anything, every morning.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-376 · `/attendance/ops` — Regularisation form asks for "Attendance record id" as a free-text UUID field (a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/attendance/ops/page.tsx
- **Detail:** Regularisation form asks for "Attendance record id" as a free-text UUID field (attendance-ops-forms.tsx) — the user has no way to discover this id; the mockup resolves it from student + date.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-377 · `/attendance/ops` — Approve / Reject act immediately with no confirmation and no reason field for a…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/attendance/ops/page.tsx
- **Detail:** Approve / Reject act immediately with no confirmation and no reason field for a rejection; the audit trail promised in the subtitle records nothing from the approver.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-378 · `/attendance/reports` — Class and Student scope require typing a raw reference into "Class reference" /…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/attendance/reports/page.tsx
- **Detail:** Class and Student scope require typing a raw reference into "Class reference" / "Student reference" text inputs (placeholder "Required for class scope") — no picker, even though the page already loads institutions (attendance-report-filters.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · library (5)

### B-379 · `/library` — Three forms (NewLibraryItemForm, IsbnImportForm, LibraryClearanceForm) are stack…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/library/page.tsx
- **Detail:** Three forms (NewLibraryItemForm, IsbnImportForm, LibraryClearanceForm) are stacked above the catalog on every visit; the 1,000-title list has no search, sort, filter or pagination (page.tsx renders items.map into a ).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-380 · `/library/circulation` — Return and renew are keyed by "Loan id" (a UUID the desk cannot know) unless the…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/library/circulation/page.tsx
- **Detail:** Return and renew are keyed by "Loan id" (a UUID the desk cannot know) unless the barcode is scanned; after checkout the loan id is only surfaced through a state variable (lastLoanId) that disappears on reload (circulation-desk.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-381 · `/library/fines` — Fine rows print "5000 cents · assessed / loan 8b1d2c3e · 10 overdue days" — amou…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/library/fines/page.tsx
- **Detail:** Fine rows print "5000 cents · assessed / loan 8b1d2c3e · 10 overdue days" — amount in raw paise with the word "cents", raw status, and a truncated loan id instead of student and title (fines/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-382 · `/library/holds` — Hold rows are "queued · position 2 / item 8b1d2c3e · expires 2026-09-30" — the t…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/library/holds/page.tsx
- **Detail:** Hold rows are "queued · position 2 / item 8b1d2c3e · expires 2026-09-30" — the title is a truncated itemId and the patron is not shown at all (holds/page.tsx), so the queue cannot be worked.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-383 · `/library/overdues` — Each row is "Loan 8b1d2c3e / due 2026-09-22 · open · BC-000215" — no title, no b…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/library/overdues/page.tsx
- **Detail:** Each row is "Loan 8b1d2c3e / due 2026-09-22 · open · BC-000215" — no title, no borrower, no days overdue or fine amount; the librarian cannot tell who to chase (overdues/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · scholarships (5)

### B-384 · `/scholarships` — The "Edit" (Pencil) and "More" (MoreVertical) row buttons have no onClick or hre…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/scholarships/page.tsx
- **Detail:** The "Edit" (Pencil) and "More" (MoreVertical) row buttons have no onClick or href — they are inert (page.tsx ProgramsTable); only the Eye icon and program name navigate.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-385 · `/scholarships/applications/[id]` — Approve and Reject fire immediately on click with no confirmation (application-d…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/scholarships/applications/[id]/page.tsx
- **Detail:** Approve and Reject fire immediately on click with no confirmation (application-decision-form.tsx); approving queues a real payment and the page says decisions are final.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-386 · `/scholarships/disbursements` — "New batch" is a  with no onClick or href (disbursements/page.tsx) — the page's…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/scholarships/disbursements/page.tsx
- **Detail:** "New batch" is a  with no onClick or href (disbursements/page.tsx) — the page's only primary action does nothing.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-387 · `/scholarships/disbursements` — "Retry failed transfers" re-submits every failed payment in one click with no co…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/scholarships/disbursements/page.tsx
- **Detail:** "Retry failed transfers" re-submits every failed payment in one click with no confirmation, although the alert itself says "Confirm bank details before reprocessing" (retry-failed-transfers-button.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-388 · `/scholarships/programs/[id]/edit` — Status is a free-text  defaulting to program.status.toLowerCase() with placehold…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/scholarships/programs/[id]/edit/page.tsx
- **Detail:** Status is a free-text  defaulting to program.status.toLowerCase() with placeholder "open" (edit-program-form.tsx); the coordinator must type "open"/"closed"/"archived" exactly, and closing a window with 34 live applications has no confirmation.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · academic-periods (3)

### B-389 · `/academic-periods` — Delete uses window.confirm('…cannot be undone') with no soft-delete or archive s…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/academic-periods/page.tsx
- **Detail:** Delete uses window.confirm('…cannot be undone') with no soft-delete or archive suggestion, and the trash icon is enabled even on the active period; archiving is a status option in the dialog rather than a first-class action.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-390 · `/academic-periods/[id]/bell-schedules` — Institution is silently chosen as institutions[0] (listInstitutions pageSize 50)…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/academic-periods/[id]/bell-schedules/page.tsx
- **Detail:** Institution is silently chosen as institutions[0] (listInstitutions pageSize 50) and never shown or selectable, so a multi-campus tenant can only create schedules for whichever institution sorts first.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-391 · `/academic-periods/[id]/calendar` — Execute rollover — which promotes every enrolled student — is guarded only by wi…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/academic-periods/[id]/calendar/page.tsx
- **Detail:** Execute rollover — which promotes every enrolled student — is guarded only by window.confirm text that admits it 'cannot be undone from here'; there is no typed confirmation, no per-institution scoping shown in the confirm, and no audit link afterwards.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · public (3)

### B-392 · `/track` — (public)/layout.tsx mounts MarketingHeader whose nav links (/features, /pricing,…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(public)/track/page.tsx + application-tracking.tsx + (public)/layout.tsx (MarketingHeader)
- **Detail:** (public)/layout.tsx mounts MarketingHeader whose nav links (/features, /pricing, /about, /contact, /demo) and "Get Started" (/demo) have no route in this app — LegalDocumentChrome.tsx documents 45 dead links in that chrome; an applicant clicking "Contact" gets a 404.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-393 · `/legal/privacy` — Body prose is hard-coded English JSX describing "the ProctiraERP marketing site…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/legal/privacy/page.tsx → features/legal/PrivacyPolicy.tsx (chrome="minimal") + components/layout/LegalDocumentChrome.tsx
- **Detail:** Body prose is hard-coded English JSX describing "the ProctiraERP marketing site and the public demo tenant" — a parent at Sunrise Public School accepting terms at sign-up reads a document about a demo site; only the title and "Last updated" label go through t(). LAST_UPDATED is a hard-coded string ("June 1, 2024") and contact is privacy@proctira.org.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-394 · `/legal/terms` — Body prose is hard-coded English JSX describing "the ProctiraERP marketing site…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/legal/terms/page.tsx → features/legal/TermsOfService.tsx (chrome="minimal") + components/layout/LegalDocumentChrome.tsx
- **Detail:** Body prose is hard-coded English JSX describing "the ProctiraERP marketing site and the public demo tenant" — a parent at Sunrise Public School accepting terms at sign-up reads a document about a demo site; only the title and "Last updated" label go through t(). LAST_UPDATED is a hard-coded string ("June 1, 2024") and contact is legal@proctira.org.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · install (2)

### B-395 · `/` — Wizard progress lives only in React state (use-wizard.ts useState); a page refre…
- **Status:** OPEN
- **Evidence:** ux-review · apps/install-wizard/src/app/page.tsx + components/install-wizard.tsx + components/steps/*.tsx + lib/use-wizard.ts
- **Detail:** Wizard progress lives only in React state (use-wizard.ts useState); a page refresh after step 4 restarts at step 1 with empty forms although the backend session (api/install/session) already recorded the earlier steps.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-396 · `/` — On a successful test each step calls setTimeout(onComplete, 1500) and auto-advan…
- **Status:** OPEN
- **Evidence:** ux-review · apps/install-wizard/src/app/page.tsx + components/install-wizard.tsx + components/steps/*.tsx + lib/use-wizard.ts
- **Detail:** On a successful test each step calls setTimeout(onComplete, 1500) and auto-advances — the operator cannot read the result (latency, version) or change a value before being moved on; there is no way to revisit a completed step except Back one at a time.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · audit-logs (2)

### B-397 · `/audit-logs` — Filters and both table columns work on raw identifiers: "Entity id" and "User id…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/audit-logs/page.tsx
- **Detail:** Filters and both table columns work on raw identifiers: "Entity id" and "User id" text inputs, and entityId / userId are printed in mono under every row (EntryRow). A principal cannot type a UUID to find "changes to Aarav Mehta".
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B-398 · `/audit-logs/dsar` — The subject must be typed as a raw id in a mono input (INPUT_CLASS font-mono, pl…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/audit-logs/dsar/page.tsx
- **Detail:** The subject must be typed as a raw id in a mono input (INPUT_CLASS font-mono, placeholder "Student / staff / user id"); there is no person search, so the officer must first find the id elsewhere.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · dashboard (1)

### B-399 · `/` — KpiCard renders the string "Currently unavailable" in place of the number with n…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/page.tsx
- **Detail:** KpiCard renders the string "Currently unavailable" in place of the number with no retry or reason; a tile with 0 students and a tile whose API timed out look alike at a glance (page.tsx KpiCard, value === null).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · billing (1)

### B-400 · `/billing` — The page never says which plan this school is on, its renewal date or usage agai…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/billing/page.tsx
- **Detail:** The page never says which plan this school is on, its renewal date or usage against quota — subscriptions are "keyed by subscription id on the gateway" so the tenant-facing surface is only the catalogue (file header comment). A school owner opening "Billing" gets a price list and no bill.
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · notifications (1)

### B-401 · `/notifications` — Notifications cannot be opened or marked read: rows are static text with no link…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/notifications/page.tsx
- **Detail:** Notifications cannot be opened or marked read: rows are static text with no link to the source record and no read action, although readAt is displayed ("· unread").
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

### B · pipelines (1)

### B-402 · `/pipelines` — A pipeline can only be created (name + CSV/REST source); there is no way to run…
- **Status:** OPEN
- **Evidence:** ux-review · apps/web/src/app/(dashboard)/pipelines/page.tsx
- **Detail:** A pipeline can only be created (name + CSV/REST source); there is no way to run it, see last run / status, edit, disable or delete it — the list rows have no actions (pipelines/page.tsx).
- **How to close:** Fix at the layer that owns the defect (API for display fields, service for rules, shared component for dialogs/status). Add a test or lint rule that would have caught it. Screenshot 1280 + 390 for UI changes.
- **Done-when:** _(fill in: PR link · test names · command output · trace metrics before → after)_

