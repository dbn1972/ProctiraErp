# Academic periods — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-academic-ops-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** AY 2026-27 `00000000-0000-4000-8000-00000000a531` (`AY26-27`, 1 Apr 2026 – 31 Mar 2027, status active). No calendar events and no bell schedules.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`. Headless Chromium, desktop 1440 and mobile 390. No horizontal overflow on the primary content.

This is a route walk. It is not a production-ready or 10/10 claim. The active period was not deleted. No term was saved.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     3 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                                                                   | Primary action                  | Result   | What the screen showed                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/academic-periods`                                                     | List periods and see AY 2026-27 | **PASS** | Banner “AY 2026-27 is the active period” and row **AY 2026-27** / `AY26-27`, 1 Apr 2026 – 31 Mar 2027, 261 working days, status text **Active**. Delete is disabled while the period is active, so the delete confirm was not opened. |
| `/academic-periods/00000000-0000-4000-8000-00000000a531/calendar`       | Open the calendar               | **PASS** | Heading **AY 2026-27**. Institution option **Sunrise Public School**. Honest empty: “No terms yet” and no calendar events. Add-event form is present. No event was saved.                                                             |
| `/academic-periods/00000000-0000-4000-8000-00000000a531/bell-schedules` | Open bell schedules             | **PASS** | Copy names the period **AY 2026-27**. Honest empty: “No bell schedules for this academic period yet.” Create form is present. Nothing was created.                                                                                    |

## UX fixes in this walk

- When the period id is missing from the list, the bell-schedules subtitle uses `resolveEntityLabel` (“Academic period” plus a short marker) instead of the full UUID.

## Residual

- Delete confirm (`academic-period-delete-confirm`) exists in the manager and was not clicked because the only seeded period is active and the control is disabled.
- Adding a term or a bell schedule was left unsubmitted.
