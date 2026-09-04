# Phase 7 — ProctiraERP Examination schema sign-off

**Status:** Complete in repo; EC3 apply + boundary checks pending evidence below.

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`examination`** |
| Tables moved | `examinations`, `examination_candidate_registrations`, `examination_candidates`, `examination_publications`, `examination_result_analyses`, `examination_academic_records`, `examination_document_jobs` |
| Boundaries | Bare `tenant_id`; bare `student_id` / `academic_period_id` / `center_id` / `area_id` / `subject_id` (no Tenant/Student FKs) |
| Tests | `packages/backend/examination/src/schema-boundary.test.ts` |
| Validate | `tools/scripts/validate-phase7-examination-ec3.sh` |

## EC3

- Schemas include `examination`; forbidden cross-schema FKs from `examination` = **0**
- Tables moved (empty seed OK)
- `GET /api/v1/examinations` → **200**
- Regression: students / grading-schemes still **200**

## Explicit non-goals (later)
- Staff schema
- Flutter mobile (last)

## Next
Staff schema (residual `public`), then Flutter last.
