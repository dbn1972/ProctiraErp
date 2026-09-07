# Product / IA — HR leave v1

**Module / slice:** Staff leave CRUD + approve/reject  
**Branch:** `cursor/hr-leave-v1-56c3`  
**Date (UTC):** 2026-09-07

## Capability

HR/principal can record staff leave requests and approve or reject pending ones. Payroll and leave balances are deferred.

## Scope

| In                                      | Out                |
| --------------------------------------- | ------------------ |
| SQL `013_hr_leave_schema.sql`           | Payroll / balances |
| `/staff/leaves` API + UI                | Full HRIS          |
| Unit: create → approve + tenant isolate | Live IdP           |

## DoD

- [x] Unit tests green
- [ ] Tip CI + merge
