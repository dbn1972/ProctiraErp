---
name: proctira-school-erp
description: >-
  Build ProctiraERP school domains (institution, student, enrollment, attendance,
  assessment) under the multi-schema charter. Use when adding school features,
  schemas, APIs, or UI for ProctiraERP — not for unrelated repo chores.
---

# ProctiraERP school domain skill

## Load only what you need
1. Read `docs/specs/SCHOOL_ERP_INDEX.md` (index only).
2. Open the matching phase sign-off / runbook — do not reload all phases.
3. Change the owning package under `packages/backend/<domain>/` + its schema.

## Schema ownership
| Domain | Schema | Own tables (examples) |
|--------|--------|------------------------|
| Platform | `platform` | tenants, themes |
| Auth | `auth` | users, identities, sessions, tokens |
| Institution | `institution` | institutions, areas, boards, periods, grades, classes, subjects |
| Student | `student` | students, enrollments, enrollment_history, transfers |
| Attendance | `attendance` | student_attendance, staff_attendance, audit |
| Assessment | `assessment` | grading_schemes, assessment_items, outcomes, results |

## Patterns
- Resolve foreign domain rows with `findMany({ where: { id: { in: ids } } })` — never `include` across schemas.
- Keep intra-schema relations (e.g. Enrollment→Student).
- Migrations: `CREATE SCHEMA`, drop boundary FKs, `ALTER TABLE … SET SCHEMA`.
- Add/extend `schema-boundary.test.ts` in the owning package.
- EC3: apply SQL, `prisma generate`, restart gateway with `DATABASE_URL_HOST` / `REDIS_URL_HOST`.

## UI
- Match `redesign/web/*` for the screen; brand-first; no Keycloak chrome.
- Prefer existing AuthShell / app shell; do not invent a new design system.

## Done when
- Boundary tests green; no new cross-schema FK/`include`.
- Sign-off or validate script updated only if the phase contract changed.
