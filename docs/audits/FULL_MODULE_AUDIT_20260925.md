# Full module audit — 2026-09-25

**Tip:** `0043e555` on `main` (`chore(security): ignore every .env variant, not three of them (#385)`)  
**Checkout:** `cursor/w1-data-15-fk-complete-56c3`  
**Source map:** `docs/audits/MODULE_API_DB_SCREEN_GAP_MAP.md`

This is the widest pass this cloud VM could execute. It is **not** a claim that every defect in Proctira is listed, and it is **not** a production-ready or Wave-closed score.

Dispositions used below: `FULLY_CLOSED` · `PARTIAL` · `OPEN` · `REGRESSED` · `EXTERNALLY_UNVERIFIED`.

---

## What was run

| Check | Result |
| ----- | ------ |
| Source inventories | 39 backend packages, 204 `page.tsx` screens, 225 `CREATE TABLE` statements, 86 Playwright specs |
| Live Postgres 16.15 | Installed on this VM. Cluster `16/main` started. Database `proctira`. Roles `proctira` and `proctira_app` created from `db/bootstrap/01_runtime_roles.sql` |
| `tools/scripts/apply-sql.sh` | `APPLY_STRICT_FKS=0` `APPLY_SEEDS=0`. **104 files recorded** in `schema_migrations`. **226** public tables. Stopped on `098_staff_identity_link.sql` |
| Gateway HTTP | Not run. Nothing was listening, and `node_modules` is not installed, so the API process was not booted |
| Unit tests | Not run (no `node_modules`) |
| Playwright / axe / screenshots | Not run. 67 of 86 e2e specs mention `E2E_BACKEND_READY` and skip the live path when that flag is unset |
| Multi-board seed (3×2×500) | Not run |
| Mobile device | Not run (`apps/mobile` has 65 Dart files on disk only) |

First apply attempt failed earlier, before any ledger row, because `001_core_onboarding_schema.sql` grants to role `proctira` and that role did not exist yet. Bootstrap is a separate script and is not implied by `apply-sql.sh` unless `BOOTSTRAP_DATABASE_URL` is set.

---

## Pillars (whole product)

| Pillar | Disposition | Why |
| ------ | ----------- | --- |
| Functionality (API ↔ screen ↔ table) | **PARTIAL** | Source map in the companion file. Live HTTP read/write per module was not executed |
| Data / SQL | **PARTIAL** | Fresh raw-SQL apply reaches 097 and dies on 098. Strict FK files and seeds were intentionally off. Volume cert (3 boards, 6 schools, 3000 students) was not run |
| Security / tenancy | **PARTIAL** | No live cross-tenant deny and no live RBAC deny in this session. Static residuals are listed under findings |
| E2E journeys | **EXTERNALLY_UNVERIFIED** | Specs exist; this VM did not execute them against a gateway |
| UX | **EXTERNALLY_UNVERIFIED** | No screenshots were viewed. Sixteen pages still mount `ScaffoldModeBanner` |
| Accessibility | **EXTERNALLY_UNVERIFIED** | `a11y-axe.spec.ts` skips authenticated routes unless `E2E_BACKEND_READY=1` |
| Mobile | **EXTERNALLY_UNVERIFIED** | No `flutter test`, no device, no golden comparison |
| Release / tip CI | **EXTERNALLY_UNVERIFIED** | This document does not read a GitHub Actions run on `0043e555` |

---

## Findings

### AUD-01 — Raw SQL apply cannot finish on a fresh database — **OPEN**

`apply-sql.sh` recorded 104 files through `097_admissions_public_context.sql`, then failed:

```text
098_staff_identity_link.sql phase 4
ERROR: relation "public.staff_assignments" does not exist
```

`staff_assignments` is created only by Prisma:

- `packages/shared/database/prisma/schema.prisma` model `StaffAssignment`
- `packages/shared/database/prisma/migrations/20260612_add_examination_assessment_staff_assignments/migration.sql`

It is not created by any file under `db/sql/`. The apply script’s own header says numbered SQL runs **after** `prisma migrate deploy`. A certification path that refuses Prisma therefore cannot apply 098, 099, 101, or 102.

Not applied after the failure: `098`, `099`, `101`, `102`. Skipped on purpose: seeds (`*b_*_seed.sql`) and strict FK files (`021a`, `021b`, `068`, `082`, `100`).

`public.students`, `public.enrollments`, `public.health_measurements`, and `public.privacy_legal_holds` do exist. `public.fee_invoices` does not (fee data is `fee_structures`, `fee_ledger_entries`, and related tables). `public.staff` exists; `public.staff_assignments` does not.

### AUD-02 — Privacy API and SQL have no operator screen — **OPEN**

`/privacy` is mounted. Tables `privacy_legal_holds` applied. `apps/web` has `/legal/privacy`, which is policy copy, not the lifecycle API. Same gap as the source map, now confirmed against a database that actually has the table.

### AUD-03 — Developer portal has API and SQL and no web screen — **OPEN**

`/developer` is mounted. SQL through `094_developer_portal_api_key_lookup.sql` applied. No `/developer` pages under `apps/web/src/app`.

### AUD-04 — Web calls prefixes the gateway does not serve as those names — **OPEN**

| Caller | Calls | What is actually mounted |
| ------ | ----- | ------------------------ |
| `apps/web/src/features/etl/pages/PipelineList.tsx`, `PipelineBuilder.tsx`, `ExecutionLog.tsx` | `/etl/pipelines`, `/etl/executions` | `/pipelines` (`backend/etl`) |
| `apps/web/src/lib/api/dashboards.ts` and dashboard pages | `/dashboards` | package parked in `mount-matrix.ts` |
| `apps/web/src/lib/api/students.ts` | `/custom-fields` | package parked |
| `apps/web/src/lib/api/audit.ts` | `/audit/entries` | audit API is `/audit-logs`; `/audit` is the platform-admin UI stub |
| `apps/web/src/lib/institutions/api.ts` | `/areas/tree` | not a key in `PATH_RESOURCE_MAP` (`rbac-registry.ts`) |

### AUD-05 — Staff pages missing for three academic APIs — **OPEN**

Curriculum, gradebook, and timetable have package routes, SQL, TypeScript clients, and Playwright inventory specs. They do not have an `app/` folder named `/curriculum`, `/gradebook`, or `/timetable`. The specs can still pass against other routes or skip without a backend.

### AUD-06 — Sixteen screens are still scaffolds — **OPEN**

These `page.tsx` files render `ScaffoldModeBanner`:

`/`, `/admin`, `/admin/notification-rules`, `/admin/permissions`, `/admin/roles`, `/admin/tenant`, `/admin/users`, `/data-warehouse`, `/data-warehouse/field-mapping`, `/data-warehouse/import`, `/data-warehouse/map`, `/reports`, `/reports/[id]/results`, `/reports/dashboard`, `/reports/new`, `/reports/schedules`.

A banner means the screen tells the operator the data may be a placeholder. That is honest UI. It is not a finished workflow.

### AUD-07 — PHI updates and deletes are not in the same transaction as audit — **OPEN**

In `packages/backend/health/src/pg-phi-store.ts`, `appendAuditInTxn` runs on create for measurements, allergies, conditions, vaccinations, insurance, and screening programs. The matching `update*` and `delete*` methods do not. Same pattern on counselling update, special-needs referral update, and accommodation-plan update (source map). Live HTTP was not used to prove the rollback behavior.

### AUD-08 — Domain routes still accept a raw tenant header — **PARTIAL**

`tenantOf` / `tenantIdOf` fall through to `x-tenant-id` when `request.user.tenantId` and `request.tenantId` are absent:

- `packages/backend/curriculum/src/routes.ts`
- `packages/backend/gradebook/src/routes.ts`
- `packages/backend/timetable/src/routes.ts`
- `packages/backend/student/src/certificates/routes.ts`

The gateway’s service router overwrites `x-tenant-id` with the verified tenant for proxied calls (`apps/api-gateway/src/plugins/service-router.ts`). That does not by itself prove these in-process handlers reject a header-only caller. No live request was sent.

### AUD-09 — E2E does not cover a live backend unless a flag is set — **OPEN**

67 of 86 files under `apps/web/e2e` mention `E2E_BACKEND_READY`. Authenticated axe scans are inside that gate (`apps/web/e2e/a11y-axe.spec.ts`). Inventory smokes can still open unauthenticated routes and land on `/login`. That is not a write-path proof.

### AUD-10 — Parked packages still contain route handlers — **OPEN**

Unmounted, with handlers still in the package: `custom-field`, `dashboards`, `data-warehouse`, `survey`, `theme`, `policy`, `plugin`, `install`, `admin-dashboard`. `admin-dashboard` has zero `*.test.ts` files. `backend/data-warehouse` is not the API behind `/data-warehouse` (that is the insights UI plugin).

### AUD-11 — Providers and workflow engine are headless — **PARTIAL**

`backend/providers` exports a sandbox facade and no Fastify routes. Live SMS, email, push, and card adapters are not in the package. `/workflow-engine` has 14 handlers and SQL `025` (applied in this run). Screens call `/workflows`, not `/workflow-engine`.

### AUD-12 — Billing matrix text is stale; the screen is still thin — **PARTIAL**

`packages/backend/billing/src/create-billing-repository.ts` uses Postgres when `DATABASE_URL` is set. `docs/audits/GATEWAY_MOUNT_MATRIX.md` still says billing persistence is in-memory. The web app has one `/billing` page against 17 handlers.

---

## Module disposition (this session)

No module is `FULLY_CLOSED`. A module is **PARTIAL** when the gateway mounts it, SQL for it landed in this apply, and the web app has a page or client. It is **OPEN** when one of those three is missing or the screen is only a scaffold. Live behavior of every row is still **EXTERNALLY_UNVERIFIED**.

| Module | This session | Blocker |
| ------ | ------------ | ------- |
| student, institution, staff, attendance, examination, assessment, lms, scholarship, health, notification, transport, communication, hostel, library, parent/student portal, fees, registration, auth, audit | **PARTIAL** | No live HTTP. Health writes: AUD-07. Staff assignments table missing: AUD-01 |
| curriculum, gradebook, timetable | **OPEN** | No matching `app/` folder (AUD-05). Header fallback (AUD-08) |
| report, data-warehouse UI, admin | **OPEN** | Scaffold banners (AUD-06) |
| etl | **OPEN** | UI calls `/etl`, gateway mounts `/pipelines` (AUD-04) |
| privacy, developer-portal | **OPEN** | No product screen (AUD-02, AUD-03) |
| billing, workflow, providers, tenant/SCIM | **PARTIAL** | Thin or headless UI (AUD-11, AUD-12) |
| custom-field, dashboards, survey, policy, theme, plugin, install, admin-dashboard, data-warehouse package | **OPEN** | Not mounted (AUD-10) |
| mobile | **EXTERNALLY_UNVERIFIED** | Not executed |

---

## Still required before anyone calls this a finished audit

1. Boot the gateway with `DATABASE_URL` pointing at a database that has both Prisma migrations and `db/sql`.
2. One authenticated read and one write per mounted module, plus one cross-tenant deny and one wrong-role deny on health, fees, and students.
3. Re-run `098` after `staff_assignments` exists, then apply `099`, `101`, `102`, and the strict FK set (`APPLY_STRICT_FKS=1`) on a database that can satisfy them.
4. Run the multi-board seed and check 3 boards, 6 schools, 3000 students.
5. Run Playwright with `E2E_BACKEND_READY=1`, including axe, and look at the scaffold screens instead of trusting the banner component name.
