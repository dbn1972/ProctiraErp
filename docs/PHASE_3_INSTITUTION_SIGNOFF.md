# Phase 3 — ProctiraERP Institution schema sign-off

**Status:** Complete in repo; EC3 schema + API validation passed (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`institution`** added beside `platform` / `auth` / `public` |
| Tables moved | `institutions`, `geographic_areas`, `boards`, `academic_periods`, `grades`, `classes`, `subjects`, `institution_subjects` (+ `board_type` enum) |
| Boundaries | Bare `tenant_id` on institution tables (no FK to `platform.tenants`); `public.enrollments` keeps bare `institution_id` / `grade_id` / `class_id` / `academic_period_id` |
| Intra-domain | Institution↔Board/Area and Class↔Institution/Grade/Period FKs retained inside `institution` |
| Tests | `packages/backend/institution/src/schema-boundary.test.ts` (4); auth multi-schema expectation updated |
| Validate | `tools/scripts/validate-phase3-institution-ec3.sh` |

## EC3 (cloudsphere-ec3)

Applied `20260904_institution_schema`. Results:

- Schemas present: `platform`, `auth`, `institution`, `public`
- `institution.institutions` = 1; `institution.boards` = 3; `public.enrollments` still readable (= 1)
- Forbidden FKs `institution` → `public|platform` = **0**; `public` → `institution` = **0**
- Regenerated Prisma client on host; restarted API gateway with host DB/Redis URLs
- `POST /api/v1/auth/password` (India admin) → OK
- `GET /api/v1/institutions` → **200** with Kendriya Vidyalaya Proctira

## Follow-ons (completed)

- Phase 4 student schema — see `docs/PHASE_4_STUDENT_SIGNOFF.md`
- Phase 5 attendance schema + roster join removal — see `docs/PHASE_5_ATTENDANCE_SIGNOFF.md`

Still deferred: Institution Staff tab / full redesign HTML rebrand.
