# Phase 6 — ProctiraERP Assessment schema sign-off

**Status:** Complete in repo; EC3 apply + boundary checks (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`assessment`** |
| Tables moved | `grading_schemes`, `assessment_items`, `assessment_outcomes`, `assessment_results` |
| Boundaries | Bare `tenant_id`; bare `subject_id` / `student_id` / `academic_period_id` / `grading_scheme_id` (no Tenant/Student/Subject FKs) |
| Tests | `packages/backend/assessment/src/schema-boundary.test.ts` |
| Validate | `tools/scripts/validate-phase6-assessment-ec3.sh` |

## Explicit non-goals (later)
- Examination schema (Phase 7)
- Staff schema
- Flutter mobile (last)

## Next
Phase 7: **examination** schema (same boundary pattern).
