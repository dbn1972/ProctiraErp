# Page score sheet — 2026-09-10

**Tip:** `3c93595` · Matrix: **193** pages / **0 uncovered** (spec reference ≠ live write proof)  
**Method:** Group scores by module; **key pages** scored explicitly. Sibling list/detail pages inherit ±0.3 unless called out.

Legend — Write: `Y` live mutating UI · `P` partial · `N` read-only · API: `PG` durable · `HY` hybrid · `MEM` memory · `SC` scaffold/stub

---

## A. Core SIS (stronger band)

| Module       | Route                            | Score | Write | API | A11y list | Sec note          | E2E            | Gap                |
| ------------ | -------------------------------- | ----: | ----- | --- | --------- | ----------------- | -------------- | ------------------ |
| Students     | `/students`                      |   8.8 | Y     | PG  | Y         | JWT tenant        | 15*, 44*       | Live IdP           |
| Students     | `/students/[id]` (+360 tabs)     |   8.6 | Y     | PG  | Y         | IDOR pack partial | 44\*           | Expand deny proofs |
| Institutions | `/institutions`                  |   8.7 | Y     | PG  | Y         | rbacPlugin        | 16\*           | —                  |
| Institutions | `/institutions/[id]/*` academics |   8.5 | Y     | PG  | Y         |                   | 27*, 38*, 43\* | —                  |
| Attendance   | `/attendance` + ops              |   8.5 | Y     | PG  | Y         |                   | 20*, 51*       | Devices vendor     |
| Fees         | `/fees` structures/invoices      |   8.5 | Y     | PG  | Y         | SEC_FEES          | 39\*           | Live PSP           |
| Fees         | `/fees` pay/receipts             |   7.8 | P     | PG  | Y         | Sandbox honesty   | 39\*           | G-202              |
| Timetable    | `/institutions/[id]/timetable*`  |   8.0 | Y     | PG  | Y         |                   | 22*, 50*       | iCal OOS           |
| Gradebook    | institution gradebook            |   8.2 | Y     | PG  | Y         | SEC_GRADEBOOK     | 23*, 42*       | Sealed PDF OOS     |
| Examinations | `/examinations*`                 |   8.1 | Y     | PG  | Y         |                   | 19*, 34*, 45\* | Seed-gated creates |
| Assessments  | `/assessments*`                  |   7.4 | P     | HY  | Y         | Report-cards MEM  | 21\*           | Durability         |

## B. Campus services

| Module        | Route                          | Score | Write | API | E2E       | Gap                     |
| ------------- | ------------------------------ | ----: | ----- | --- | --------- | ----------------------- |
| Health        | `/health` hub                  |   8.0 | N     | HY  | 17\*      | —                       |
| Health        | `/health/allergies` (+/new)    |   8.2 | Y     | PG  | 17\*      | —                       |
| Health        | `/health/vaccinations` (+/new) |   8.1 | Y     | PG  | 17\*      | List uses live vacc API |
| Health        | `/health/incidents` (+/new)    |   8.0 | Y     | PG  | 17\*      | —                       |
| Health        | `/health/phi-access`           |   7.9 | N     | PG  | 17\*      | Role gate ≠ empty       |
| Health        | `/health/special-needs`        |   6.5 | P     | MEM | 17\*      | **PRD-004**             |
| Health        | counselling / screenings       |   7.8 | Y     | PG  | 17b\*     | —                       |
| LMS           | `/lms` + depth                 |   8.0 | Y     | PG  | 26*, 47*  | LTI waived              |
| Transport     | `/transport/*`                 |   8.2 | Y     | PG  | 20*, 54*  | MapLibre OOS            |
| Transport     | live map / GPS                 |   8.0 | Y     | PG  |           | B3-007/008 fixed        |
| Hostel        | `/hostel/*`                    |   8.3 | Y     | PG  | 21*, 49*  | —                       |
| Library       | `/library/*`                   |   8.4 | Y     | PG  | 21*, 48*  | ISBN sandbox            |
| Communication | `/communication/*`             |   7.7 | Y     | PG  | 21c*, 53* | Live providers          |
| Admissions    | `/admissions/*`                |   7.7 | Y     | PG  | 41\*      | OCR waived              |

## C. People / HR / portals

| Module        | Route                | Score | Write | API    | E2E       | Gap           |
| ------------- | -------------------- | ----: | ----- | ------ | --------- | ------------- |
| Staff         | `/staff/*`           |   7.9 | Y     | HY     | 15b*, 52* | RBAC depth    |
| Parent        | `/parent/*`          |   7.6 | P     | PG     | 22*, 40*  | Sandbox pay   |
| Notifications | `/notifications*`    |   7.3 | P     | HY     | 20c\*     | Live FCM/SMS  |
| Auth          | `/login`, MFA, reset |   7.2 | Y     | MEM/HY | auth/\*   | G-107         |
| Workflows     | `/workflows*`        |   7.5 | Y     | PG     | 18*, 12*  | IdP approvals |

## D. Insights / DW / admin (weaker band)

| Module         | Route                                                   |   Score | Write  | API    | E2E         | Gap              |
| -------------- | ------------------------------------------------------- | ------: | ------ | ------ | ----------- | ---------------- |
| Reports        | `/reports` catalogue                                    |     7.2 | Y      | PG     | 46\*        | Offline scaffold |
| Reports        | board summary                                           |     7.5 | N      | PG     |             | G-809 403 unit   |
| Insights       | `/` overview widgets                                    |     6.8 | N      | HY     | 14\*        | Scaffold banner  |
| Data warehouse | `/data-warehouse`                                       |     6.2 | P      | SC     | 14\*        | **PRD-002**      |
| Data warehouse | field-mapping                                           |     5.8 | P      | SC     |             | Demo mapping     |
| Pipelines      | `/pipelines`                                            |     6.6 | Y      | PG     | matrix only | Dedicated smoke  |
| Admin          | `/admin/*`                                              |     6.0 | P      | SC     | 25*, 35*    | **PRD-003**      |
| Off-nav        | `/billing`, `/help`, `/audit-logs`, `/tenant-lifecycle` | 6.5–7.5 | varies | varies | 25\*        | Discoverability  |

## E. Inheritance rule for unlisted siblings

Unless listed above, pages in a module inherit the **module score ± 0.3**:

- `*/new` and write forms: −0.1 if validation thin
- read-only detail: +0.0
- scaffold-banner pages: floor **6.5**

Full route inventory: `docs/testing/PAGE_REGRESSION_MATRIX.md`.

## F. Page-score distribution (approx.)

| Band    | ≈ share | Meaning                                  |
| ------- | ------: | ---------------------------------------- |
| 8.5–9.0 |     25% | Core SIS list/write with PG + smoke      |
| 7.5–8.4 |     40% | Campus + LMS + HR with waivers           |
| 6.5–7.4 |     25% | Auth/notifications/workflows/partial     |
| ≤6.4    |     10% | DW/admin/scaffold / special-needs memory |

### Headless uplift (2026-09-10)

| Page                         | Prior | Now | Note                        |
| ---------------------------- | ----: | --: | --------------------------- |
| `/health/special-needs`      |   6.5 | 8.2 | PG hybrid confirmed         |
| `/data-warehouse*`           |  ~6.2 | 7.4 | Honesty / PARKED classified |
| `/admin/*`                   |  ~6.0 | 7.2 | Ops stub banner             |
| `/pipelines`                 |  ~6.8 | 8.0 | Write smoke added           |
| `/report-cards` (assessment) |  ~7.0 | 8.3 | PG factory documented       |
