# Data / SQL — cross-board transfer workflow

**Date:** 2026-09-28

## Schema

`db/sql/105_cross_board_transfer_workflow.sql`

- `transfer_records.workflow_status` with check constraint
- Completed rows must keep `destination_enrollment_id`
- `transfer_approval_events` append-only, composite FK `(transfer_id, tenant_id)`
- `grade_equivalency_rules` unique per tenant, board pair, grade, source subject
- `tenant_id` → `tenants(id)` on both new tables (validated; FORCE RLS lifted for the scan)
- RLS ENABLE + FORCE, policy `tenant_id::text = app_tenant_id()`
- Indexes on existing `transfer_records` are `CREATE INDEX CONCURRENTLY`. CHECK constraints are `NOT VALID`, then `VALIDATE CONSTRAINT` with `FORCE ROW LEVEL SECURITY` lifted and restored in the same statement. Indexes on the new tables are ordinary because those tables are created in this file.
- Privileges: `transfer_approval_events` append_only, `grade_equivalency_rules` dml in `db/runtime-table-privileges.json`

## Seeds

- `db/seeds/007_cross_board_transfer_workflow.sql` — Sunrise `…a501` CBSE plus ICSE and Maharashtra state schools, submitted and approved transfers, equivalency rows
- `tools/e2e/seed-e2e-tenants.sql` — E2E tenant A CBSE→ICSE fixtures used by the live Playwright spec

## Rollback

Forward-fix only. Dropping the new columns would break in-flight rows. A later migration can add columns; do not delete approval events.

## Apply

`tools/scripts/apply-sql.sh` (not Prisma). Seeds are separate `psql -f` steps.
