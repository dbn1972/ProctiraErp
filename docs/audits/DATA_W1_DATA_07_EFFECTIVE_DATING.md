# W1-DATA-07 — Academic / fee effective dating + payroll durability

## Closed
- Academic active-period lookup filters by as-of date within `start_date`/`end_date`
- `academic_periods.valid_from` / `valid_to` synced from start/end (SQL trigger)
- `fee_structures.valid_from` / `valid_to` + `listFeeStructures(tenantId, { asOf })`
- `StaffHrService.exportPayroll` persists/loads via `StaffHrStore` (memory + Postgres artifacts)

## Residual
- Prisma `AcademicPeriod` model does not expose `valid_*` columns (trigger keeps them mirrored)
- Fee historical rows backfilled `valid_from = created_at::date`; product owners may refine windows
