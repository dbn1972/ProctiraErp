# Phase 8 — ProctiraERP Staff schema sign-off

**Status:** Complete in repo; EC3 apply + boundary checks (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`staff`** |
| Tables moved | `staff`, `staff_assignments` |
| Boundaries | Bare `tenant_id`; bare `staff_id` / `institution_id` / `subject_id` / `class_id` (no Tenant FKs) |
| Tests | `packages/backend/staff/src/schema-boundary.test.ts` |
| Validate | `tools/scripts/validate-phase8-staff-ec3.sh` |

## EC3

- Schemas include `staff`; forbidden cross-schema FKs from `staff` = **0**
- Tables moved (empty seed OK): `staff` / `staff_assignments`
- `GET /api/v1/staff` → **200**
- Regression: students / examinations still **200**; staff plugin registered on gateway

## Explicit non-goals (later)
- Phases 9–16 domain schemas, then Flutter

## Next
Phase 9 scholarship through Phase 16 registration, then Flutter mobile.
