# Assessments — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-academic-ops-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` after Prisma migrate and `APPLY_STRICT_FKS=1` domain SQL. No assessment schemes, items, outcomes, or report-card jobs are seeded.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`. Headless Chromium, desktop 1440 and mobile 390.

This is a route walk. It is not a production-ready or 10/10 claim. No scheme was saved. No results were imported.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     6 |
| FAIL    |     0 |
| BLOCKED |     1 |
| SKIPPED |     0 |

## Route table

| Route                            | Primary action           | Result      | What the screen showed                                                                                                                            |
| -------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/assessments`                   | List schemes             | **PASS**    | Heading “Assessment schemes”. Honest empty: “No grading schemes yet” and “Create grading scheme”. No UUID in the empty copy.                      |
| `/assessments/schemes/new`       | Open the new scheme form | **PASS**    | Name, type (Numeric / Letter / Competency), min/max, and threshold rows render. Form was not submitted.                                           |
| `/assessments/schemes/[id]/edit` | Open a listed scheme     | **BLOCKED** | No scheme is seeded. A missing id renders “Page not found”, so edit, save, and delete were not exercised.                                         |
| `/assessments/items`             | List items               | **PASS**    | Honest gate: “No grading schemes are defined. Create a grading scheme first.” Item grid is not shown.                                             |
| `/assessments/outcomes`          | List outcomes            | **PASS**    | Subject select shows `MATH — Mathematics` (name, not a UUID). Honest empty: “No outcomes for this subject yet.”                                   |
| `/assessments/results`           | List / open entry        | **PASS**    | Subject and academic period selects render. Honest empty until a subject and period with items are chosen. Grid not shown because no items exist. |
| `/assessments/report-cards`      | List report cards        | **PASS**    | Classes **10-A**, **8-A**, and **9-B** with 0 entries and 0 published. “No report-card jobs queued.”                                              |

## UX fixes in this walk

- Removed the inert “More actions” icon on scheme rows (it had no menu).
- Scheme row icon actions are 44px (`h-11 w-11`) and the table scrolls horizontally inside the card.
- Outcomes copy no longer tells staff to “link these IDs”.
- Result-grid student and score controls are named with the student label, not the row id.

## Residual

- Creating a scheme would unlock items, results entry, and scheme edit. That write was left optional and was not submitted.
- Report-card publish stays on the institution gradebook and was not opened.
