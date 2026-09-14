# DATA — W1-DATA-07 effective dating + payroll durability

**Module / slice:** Academic periods, fee structures, staff payroll export  
**Branch / tip:** `cursor/aud-w1-data-07-effective-dating-56c3`  
**Date (UTC):** 2026-09-14  

## Finding

Academic periods and fee structures lacked effective dating; payroll export idempotency lived only in an in-process `Map` and did not use the durable `staff_payroll_runs` path.

## Closed

- SQL `070_academic_fee_effective_dating.sql`: `valid_from`/`valid_to` on `academic_periods` (mirrored from `start_date`/`end_date` via trigger) and `fee_structures`; payroll export artifact columns on `staff_payroll_runs`. Sections gated on table existence for safe domain `ensureSchema`.
- Attendance `getActivePeriodForInstitution` filters active periods by as-of date within start/end.
- Academic period `list(?asOf=)` and `validateActivePeriod(..., asOf)` respect the effective window.
- Fees `listFeeStructures(tenantId, { asOf })` + create accepts optional `validFrom`/`validTo`.
- `StaffHrService.exportPayroll` loads/saves via `StaffHrStore` (in-memory + Postgres); `createStaffHrStore` still selects Postgres when `DATABASE_URL` is set and fails closed in production per persistence policy.
- Focused unit tests: fee as-of filter, academic effective-dating helper, payroll store round-trip + cross-service durability, HR store selection without `DATABASE_URL`.

## Residual

- **CLOSED by W1-DATA-07 COMPLETE** — see `docs/audits/DATA_W1_DATA_07_COMPLETE.md`
  (`076_w1_data_07_append_only_versions.sql`: append-only versions + payroll reverse/replace).
- Fee historical rows backfilled `valid_from = created_at::date`; product owners may refine windows later.
- Live Postgres proof of payroll artifact columns is not claimed here (unit/store tests only).

## Sign-off

Foundation closed; COMPLETE criteria tracked in `DATA_W1_DATA_07_COMPLETE.md`.
