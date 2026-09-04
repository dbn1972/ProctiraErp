# Phase 12 — ProctiraERP Workflow schema sign-off

**Status:** Complete in repo; EC3 apply + boundary checks (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`workflow`** |
| Tables created | `workflow_definitions`, `workflow_instances`, `transition_audits`, `cases` |
| Boundaries | Bare `tenant_id`; bare cross-domain UUIDs (no Tenant FKs) |
| Tests | `packages/backend/workflow/src/schema-boundary.test.ts` |
| Validate | `tools/scripts/validate-phase12-workflow-ec3.sh` |

## EC3

- Schemas include `workflow`; forbidden cross-schema FKs from `workflow` = **0**
- Tables created (empty seed OK)
- Regression: students / staff / examinations still **200**

## Explicit non-goals
- Full Prisma repository wiring for this domain (in-memory remains until wired)
- Flutter mobile (after Phase 16)

## Next
Phase 13.
