# Phase 4 — ProctiraERP Student schema sign-off

**Status:** Complete in repo; EC3 schema + API validation passed (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`student`** |
| Tables moved | `students`, `enrollments`, `enrollment_history`, `student_transfers` (+ `enrollment_status` enum) |
| Boundaries | Bare `tenant_id` (no FK to `platform.tenants`); institution/grade/class/period IDs remain bare UUIDs (Phase 3); Enrollment→Student relation kept **inside** `student` |
| Tests | `packages/backend/student/src/schema-boundary.test.ts` |

## EC3

- `student.students` = 1; `student.enrollments` = 1
- Forbidden FKs `student` → `public|platform|institution|attendance|auth` = **0**
- `GET /api/v1/students` → **200** (Aarav Sharma)
- `GET /api/v1/enrollments` → **200**

## Non-goals (done in Phase 5)

- Attendance schema move
- Removing attendance `include: { student }` join
