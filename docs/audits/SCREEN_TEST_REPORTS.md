# Reports — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-reports-comms-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** students 5, open fee invoices 2. No saved report schedules or runs. Catalogue templates come from the reports gateway, not from the Sunrise SQL seed.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`. Headless Chromium. No report was generated.

This is a route walk. It is not a production-ready or 10/10 claim.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     6 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                   | Primary action            | Result   | What the screen showed                                                                                                                                                                                   |
| ----------------------- | ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reports`              | List reports              | **PASS** | Catalogue by name: Students roster, Enrolment by grade, Attendance summary, Fee dues, Exam results, plus further module cards. Formats PDF / XLSX / CSV. No scaffold banner (gateway source).            |
| `/reports/new`          | Open the new report form  | **PASS** | Template select lists the same named reports. “templates source gateway”. Generate was not clicked.                                                                                                      |
| `/reports/dashboard`    | Open the role dashboard   | **PASS** | Principal dashboard: School enrolment **5**, Open fee dues **2**, Students **5**. Attendance shows an em dash (no attendance register was opened). Role links: board, principal, teacher, staff, parent. |
| `/reports/dashboards`   | List dashboards           | **PASS** | Alias redirects to `/reports/dashboard` and shows the same principal cards.                                                                                                                              |
| `/reports/schedules`    | List schedules            | **PASS** | Create form lists named reports. Honest empty: “No schedules yet” and “No runs yet.” Nothing was created. “Run due now” was not clicked.                                                                 |
| `/reports/[id]/results` | Open one report’s results | **PASS** | A missing id shows “This report template was not found” and “Template not found”, without printing the id. No seeded run to download.                                                                    |

## UX fixes in this walk

- Missing-template copy no longer prints the raw id.
- Run “By” uses `resolveEntityLabel` so a UUID author is not the whole cell.
- Past-runs table scrolls horizontally inside the card.

## Residual

- Generating a PDF/XLSX/CSV was not submitted.
- Attendance percent on the dashboard is blank because attendance routes were not opened.
