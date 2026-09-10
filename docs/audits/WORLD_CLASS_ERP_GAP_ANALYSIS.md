# ProctiraERP — World-class ERP gap analysis (module × page × function)

**Date:** 2026-09-09 · **Branch tip:** `cursor/enterprise-gap-close-56c3` @ `2c249a1` · **Auditor:** Fable 5.1 (4 parallel read-only explores + repo verification)
**Benchmarks:** PowerSchool SIS · Infinite Campus · Ellucian Banner · Workday Student · OpenEMIS · Fedena · Canvas/Moodle (LMS) · Blackbaud Tuition (finance)
**Companion registers:** `ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md` (master, Wave 9 = this analysis) · `docs/testing/PAGE_REGRESSION_MATRIX.md` (e2e coverage) · `SCREEN_BY_SCREEN_SCOREBOARD.md` (earlier campaign)

---

## 0. Two different scores — read this first

| Scale                                           | What it measures                                                                                | Where it stands                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Enterprise production-readiness** (Waves 0–8) | Controls & evidence: RBAC, RLS, audit, persistence in CI, a11y/dark/touch, e2e gates            | **~7.2 / 10** after Wave 8 (see master audit §1)                                 |
| **World-class functional parity** (this doc)    | Does each page do what PowerSchool / Banner / Workday users expect, end-to-end, with real data? | **5.4 / 10** at register time → **6.9 / 10** post-Wave 9 (§1.1 `Post-W9` column) |

The controls are largely in place; the **depth of business functionality** behind many screens is not. This document lists exactly which page lacks which function.

### Scoring rubric per page (0–10)

| Band | Meaning                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| 9–10 | Full benchmark feature set, real persistence, wired actions, e2e write smoke            |
| 7–8  | Core CRUD + workflow real; 1–2 benchmark features missing                               |
| 5–6  | List/read real; key mutations missing, inert controls, or UI↔API mismatch               |
| 3–4  | Scaffold / seed / demo data, or backend not mounted so page cannot work against gateway |
| 0–2  | Absent                                                                                  |

State legend: **Real** = gateway-backed with persistence · **Partial** = real read, missing/inert writes · **Mismatch** = UI calls a path the backend does not expose · **Seed** = gateway UI plugin with demo seed · **Scaffold** = honesty banner / stub · **Unmounted** = backend package exists but is not on the gateway.

---

## 1. Executive summary

### 1.1 Module scoreboard (functional parity)

| #   | Module                                        |       Screens | Score | Post-W9 | World-class bar                      | Headline gap                                                                                                                                                               |
| --- | --------------------------------------------- | ------------: | ----: | ------: | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Students & enrollment                         |             7 |   6.5 | **7.5** | PowerSchool student 360°             | No photo/ID card/siblings/consent; synthetic attendance heatmap on profile; no promotion/rollover                                                                          |
| 2   | Staff / HR                                    |             8 |   6.0 | **7.0** | Workday HCM-lite                     | No contracts, staff attendance page, bulk import, payroll export                                                                                                           |
| 3   | Institutions & infrastructure                 |            12 |   4.5 | **6.0** | Banner org / OpenEMIS                | **`/academic-periods`, `/grades`, `/classes`, `/subjects`, `/infrastructure` not mounted on gateway** — 4 pages cannot load data; infra in-memory only; UDISE export inert |
| 4   | Academic periods & calendar                   |             2 |   4.0 | **7.0** | Infinite Campus calendar             | Backend unmounted (see #3); no year→term, holidays, grading windows, rollover                                                                                              |
| 5   | Attendance                                    |             2 |   6.0 | **7.5** | Infinite Campus attendance           | No regularisation, early-departure, student leave, biometric ingest; CSV export disabled                                                                                   |
| 6   | Admissions / registration                     | 1 (+7 portal) |   5.5 | **7.5** | Ellucian Recruit / Fedena admissions | No enquiry CRM, merit list, seat matrix, offer→fee→enrol conversion                                                                                                        |
| 7   | Assessments                                   |             5 |   6.5 | **7.5** | PowerSchool gradebook                | Outcomes & report-card templates have API but **no UI**; XLSX import is client-parsed JSON                                                                                 |
| 8   | Gradebook / transcripts                       |             2 |   6.5 | **7.5** | Banner grades                        | Workflow transitions not driveable from UI; no class rank / CGPA / comments bank; audit in-memory                                                                          |
| 9   | Examinations                                  |             7 |   4.5 | **7.0** | Board-exam ops (CBSE/ICSE)           | **Candidates GET missing, documents routes mismatch, results shape mismatch**; no invigilators, double-entry, re-evaluation; seating not persisted                         |
| 10  | Timetable / master schedule                   |             4 |   6.5 | **7.5** | aSc / Infinite Campus scheduler      | No auto-generation; classes/grades pages have disabled Add/Edit; no parent/student view                                                                                    |
| 11  | LMS + Spiral PAL                              |             4 |   6.0 | **7.5** | Canvas / Moodle                      | MCQ only; no question bank, rubrics, file uploads, discussions, content library, class analytics                                                                           |
| 12  | Curriculum                                    |             0 |   1.5 | **6.0** | Curriculum mapping (Atlas)           | Absent (outcomes API only)                                                                                                                                                 |
| 13  | Fees / student finance                        |             4 |   4.5 | **7.0** | Blackbaud Tuition / Fedena fees      | Flat plans only: no class/category structures, concessions, instalments, refunds, reminders, reports, reconciliation, scholarship netting                                  |
| 14  | Scholarships                                  |             7 |   6.0 | **7.0** | Banner financial aid                 | **Approve/Reject buttons not wired**; eligibility UI free-text; no netting to fees                                                                                         |
| 15  | Hostel                                        |             5 |   6.5 | **7.5** | Fedena hostel                        | No mess, gate pass, hostel fees, hostel attendance                                                                                                                         |
| 16  | Library                                       |             3 |   5.0 | **7.0** | Koha-class                           | No ISBN import, reservations, barcode, OPAC; fines API without UI                                                                                                          |
| 17  | Transport                                     |             5 |   5.5 | **7.0** | Fedena transport + telematics        | No stops UI, GPS map, bus-attendance UI, alerts, fee link                                                                                                                  |
| 18  | Health & wellbeing                            |             6 |   5.5 | **6.5** | SNAP Health / PowerSchool health     | List pages are gateway **seed aggregates**; no nurse incidents; vaccination/allergy UI missing; PHI log not viewable                                                       |
| 19  | Communication                                 |             4 |   6.0 | **7.0** | Remind / SchoolMessenger             | No WhatsApp, circulars, delivery-log console; sandbox delivery (waived)                                                                                                    |
| 20  | Notifications                                 |  1 (+1 admin) |   5.0 | **6.0** | —                                    | Rules editor is a stub; preferences link points to a **non-existent route**                                                                                                |
| 21  | Parent portal                                 |             5 |   5.0 | **7.0** | PowerSchool parent                   | No attendance, grades, timetable, calendar, LMS                                                                                                                            |
| 22  | Dashboard home                                |             1 |   5.0 | **6.0** | Role dashboards                      | Single layout; not role-personalised                                                                                                                                       |
| 23  | Tenant admin (users/roles/permissions/tenant) |             6 |   3.5 | **6.5** | Workday security admin               | Invite/Edit/Create/Save not wired; `/admin/users` list has no gateway route in matrix                                                                                      |
| 24  | Platform (billing/audit/tenant-lifecycle)     |             3 |   5.5 | **6.5** | —                                    | Read-only catalogues; audit store in-memory (not WORM)                                                                                                                     |
| 25  | Reports / BI                                  |             3 |   4.5 | **6.5** | Ellucian Insights / Power BI         | Generate returns synthetic downloads; no scheduling, role dashboards, real exports                                                                                         |
| 26  | Data warehouse                                |             4 |   3.5 |     3.5 | OpenEMIS DW                          | Field-mapping forced scaffold; map placeholder; DW/ETL packages unmounted                                                                                                  |
| 27  | Workflows                                     |             5 |   6.5 | **7.0** | Workday BP framework                 | No delegation, SLA config, trail view; two engines (`/workflows` UI vs `/workflow-engine`)                                                                                 |
| 28  | Auth (login/MFA/signup/reset/oauth)           |             9 |   7.5 | **8.0** | Okta-grade                           | No SCIM; live IdP waived (G-107); identity stores partly in-memory                                                                                                         |
| 29  | Help                                          |             1 |   5.0 |     5.0 | —                                    | No ticketing / release notes                                                                                                                                               |
| 30  | Public tracking `/track`                      |             1 |   7.0 |     7.0 | —                                    | OK                                                                                                                                                                         |
| —   | Registration portal app                       |             7 |   6.5 |     6.5 | —                                    | No admissions payment journey                                                                                                                                              |
| —   | Public website app                            |            12 |   6.0 |     6.0 | —                                    | No CMS; status page partial                                                                                                                                                |
| —   | Admin console app                             |            13 |   5.0 |     5.0 | —                                    | Backed by ui-seed platform-admin plugin                                                                                                                                    |
| —   | Developer portal app                          |             4 |   4.5 |     4.5 | —                                    | Marketplace static; keys not live-minted                                                                                                                                   |
| —   | Install wizard app                            |             1 |   5.0 |     5.0 | —                                    | `install` package unmounted                                                                                                                                                |
| —   | Mobile (Flutter)                              |           ~20 |   6.0 |     6.0 | —                                    | Single app; no dedicated student mode; device farm waived                                                                                                                  |

**Weighted web-app score: 5.4 / 10.** Strongest: Auth, Gradebook, Timetable, Hostel, Workflows. Weakest: Curriculum, Tenant admin, Data warehouse, Academic periods, Institutions sub-domains, Fees depth, Examinations wiring.

**Post-Wave-9 re-score (2026-09-09, PR #41): 6.9 / 10** weighted over the same screen weights (the app now has 184 App Router pages; new pages inherit their module score). Bold cells changed. Basis: code-complete slices with tsc/vitest gates, catalog-verified RLS on `db/sql/027`–`045`, and live Playwright chains 27–54 executed locally under `E2E_BACKEND_READY=1`; **not** a production-usage score — external providers (IdP, PSP, WhatsApp/SMS, Open Library) remain sandbox/env-gated, and data warehouse / ETL / install stay unmounted (G-605/G-924 parked). Weakest after Wave 9: Data warehouse, Help, Curriculum depth, Notifications, Dashboard personalisation.

### 1.2 Top 12 findings (ordered by user impact)

1. **Institution sub-domains are not on the gateway** — `packages/backend/institution/src/{academic-period,education,infrastructure}` define `/academic-periods`, `/grades`, `/classes`, `/subjects`, `/institution-subjects`, `/infrastructure/*` but `institution-plugin.ts` registers only `registerInstitutionRoutes` + `registerAreaHierarchyRoutes`; `domain-plugins.ts` proxies only `/institutions`. Pages `/academic-periods`, `/institutions/[id]/{classes,grades,infrastructure}`, `/attendance` (class roster), `/assessments/items` (period picker) degrade to empty lists. Infrastructure store is in-memory only. _(S0)_
2. **Examinations UI ↔ API mismatch** — `/examinations/[id]/candidates` calls `GET …/candidates` (backend has only `POST`); `/documents` page calls `GET …/documents` (backend is `/documents/generate` + `/documents/jobs`); results page expects row shape, backend returns publication payload; Register / Upload / Generate buttons unwired. _(S0)_
3. **Fees is a flat-plan ledger, not student finance** — no fee structures per class/category, concessions, instalment schedules, refunds, dues reminders, reports, reconciliation, scholarship netting. Staff `/fees/*` pages use parent-portal fee APIs rather than `@proctira/backend-fees`. _(S0)_
4. **Parents cannot see academics** — parent portal has fees/messages/consents only; no attendance, grades, report cards, timetable, LMS, calendar. Student portal absent. _(S0)_
5. **No academic calendar model** — flat periods; no year→term, holidays, grading windows, rollover/promotion. _(S1)_
6. **Admissions stops at status + waitlist + interview** — no enquiry CRM, merit list, seat matrix, entrance test, offer→fee→enrol conversion, quotas. _(S1)_
7. **Grade workflow not driveable from UI**; no class rank, CGPA, comments bank, publish-to-parent, durable grade-change audit. _(S1)_
8. **Exam operations** lack invigilator allocation, persisted seating (Prisma seating repo is empty), double marks entry / moderation, re-evaluation. _(S1)_
9. **Tenant admin is scaffold** — `/admin/users|roles|permissions|tenant` render lists but Invite / Edit / Create role / Save branding are not wired; `/admin/notification-rules` is a stub; inbox links to non-existent `/app/settings/notifications`. _(S1)_
10. **Reports/BI** — `POST /reports/generate` returns synthetic `downloadUrl`; no scheduling, no role dashboards (`dashboards` parked), DW field-mapping forced scaffold. _(S1)_
11. **Health list pages are demo seed aggregates** (`health-ui-seed.ts`) even though domain CRUD is real; no nurse incident/visit entity; vaccination/allergy pages absent; PHI access log has no viewer. _(S1)_
12. **Inert controls across 11 pages** — UDISE export, CSV export, calendar export, classes/grades Add/Edit/Export, assessments "More" menu, scholarship export, scholarship Approve/Reject, exam Register/Upload/Generate, library fine assessment. A world-class ERP never ships a disabled primary action without a reason. _(S2, cross-cutting)_

---

## 2. Module-by-module, page-by-page analysis

Format per module: page table → capability matrix vs benchmark → gaps (→ Wave 9 ID).

### 2.1 Students & enrollment (7 pages) — 6.5

| Page                      | State   | Score | Gap vs PowerSchool / Banner                                                                                                                                                       |
| ------------------------- | ------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/students`               | Real    |   7.5 | No saved views, column chooser, bulk actions (promote / message / export selected)                                                                                                |
| `/students/new`           | Real    |   7.0 | Photo dropzone disabled; no sibling lookup, consent flags, house                                                                                                                  |
| `/students/[id]`          | Partial |   5.5 | Attendance heatmap is deterministic synthetic from `customData` (`buildHeatmap`); assessments from `customData`; no health / discipline / behaviour / fees / LMS tabs; no ID card |
| `/students/[id]/edit`     | Real    |   7.0 | Same as new                                                                                                                                                                       |
| `/students/[id]/transfer` | Partial |   6.0 | Checklist + approval chain hardcoded; not linked to `/workflows`                                                                                                                  |
| `/students/import`        | Real    |   7.5 | Excel only (no CSV); no field-mapping step; no scheduled/SFTP import                                                                                                              |
| `/students/records`       | Real    |   7.0 | Uses gradebook APIs; no report-card viewer per student                                                                                                                            |

Backend `student`: Prisma + Redis cache; enrollment raw-pg; import queue **in-memory** (jobs lost on restart).

| Capability                                                              | Status                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 360° profile (demo/guardians/docs/health/discipline/behaviour/fees/LMS) | PARTIAL — guardians + docs + custom fields only      |
| Enrolment history / transfer                                            | YES                                                  |
| Promotion / graduation / rollover                                       | PARTIAL — `GRADUATED` status only; no bulk promotion |
| Alumni                                                                  | PARTIAL — list tab only                              |
| Bulk import + validation report                                         | YES (Excel, dry-run)                                 |
| ID card                                                                 | NO                                                   |
| Photo                                                                   | NO (UI disabled)                                     |
| Consent / privacy flags                                                 | NO                                                   |
| Sibling linking                                                         | NO                                                   |
| House / section                                                         | PARTIAL (customData)                                 |

→ **G-914** (student 360 completion), **G-905** (promotion/rollover), **G-925** (inert controls).

### 2.2 Staff / HR (8 pages) — 6.0

| Page                             | State   | Score | Gap vs Workday HCM                                                   |
| -------------------------------- | ------- | ----: | -------------------------------------------------------------------- |
| `/staff`                         | Real    |   7.0 | No bulk import / export                                              |
| `/staff/new`, `/staff/[id]/edit` | Real    |   7.0 | No contract, qualification registry, documents                       |
| `/staff/[id]`                    | Real    |   6.5 | Leave balances read from `customData`; no attendance tab; no payroll |
| `/staff/[id]/assignments/new`    | Partial |   6.0 | Section coverage card is static copy                                 |
| `/staff/[id]/appraisals/new`     | Real    |   7.0 | —                                                                    |
| `/staff/leaves`                  | Real    |   6.5 | No balance accrual engine, calendar view, delegation                 |
| `/staff/substitutions`           | Real    |   6.5 | No auto-suggest by free period                                       |

Backend `staff`: Prisma (staff/assignments) + pg (leave/appraisal/training); `POST /attendance/staff` exists but has no page.

| Capability                                                     | Status                   |
| -------------------------------------------------------------- | ------------------------ |
| HR profile, assignments/workload, leave, appraisal, substitute | YES                      |
| Qualifications                                                 | PARTIAL (training certs) |
| Staff attendance page                                          | NO (API only)            |
| Payroll link / contracts / bulk import                         | NO                       |

→ **G-918**.

### 2.3 Institutions & infrastructure (12 pages) — 4.5

| Page                                                                 | State                    | Score | Gap                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------ | ----: | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/institutions`                                                      | Real                     |   6.5 | Export UDISE button has no handler                                                                                                      |
| `/institutions/new`, `/[id]/edit`                                    | Real                     |   7.0 | No board/affiliation, accreditation, branding                                                                                           |
| `/institutions/[id]` → `/overview`                                   | Partial                  |   5.0 | KPIs / enrollment-by-grade / activity from `customData`, not live aggregates                                                            |
| `/institutions/[id]/classes`                                         | **Unmounted**            |   3.0 | `/classes` not on gateway; Add / Edit / Export disabled                                                                                 |
| `/institutions/[id]/grades`                                          | **Unmounted**            |   3.0 | `/grades` not on gateway; Add / Edit disabled                                                                                           |
| `/institutions/[id]/infrastructure`                                  | **Unmounted + Mismatch** |   2.5 | UI calls `/institutions/:id/infrastructure/hierarchy`; package defines `/infrastructure/hierarchy/:institutionId`; store in-memory only |
| `/institutions/[id]/schedule`, `/schedule/[sectionId]`, `/timetable` | Real                     |   7.0 | (timetable package)                                                                                                                     |
| `/institutions/[id]/gradebook`                                       | Real                     |   7.0 | (gradebook package)                                                                                                                     |

| Capability                       | Status                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Board → school hierarchy         | PARTIAL — area tree + JWT `institutions[]`; no board entity with governance data |
| Infrastructure                   | PARTIAL — in-memory, unmounted                                                   |
| Classes / sections / subjects    | NO on gateway (code exists)                                                      |
| Capacity, geo                    | YES                                                                              |
| Holiday calendar, bell schedules | PARTIAL (bell via timetable)                                                     |
| Branding / accreditation         | NO                                                                               |

→ **G-901** (mount + pg + path alignment), **G-925**.

### 2.4 Academic periods & calendar (2 pages) — 4.0

| Page                                    | State         | Score | Gap                                                                      |
| --------------------------------------- | ------------- | ----: | ------------------------------------------------------------------------ |
| `/academic-periods`                     | **Unmounted** |   3.0 | UI real but `/academic-periods` not on gateway; Export calendar disabled |
| `/academic-periods/[id]/bell-schedules` | Real          |   7.0 | (timetable)                                                              |

Missing entirely: year→term hierarchy, holidays/events, grading windows, rollover wizard (copy sections/assignments/fee plans to next year). → **G-901**, **G-905**.

### 2.5 Attendance (2 pages) — 6.0

| Page                  | State | Score | Gap                                                                                                   |
| --------------------- | ----- | ----: | ----------------------------------------------------------------------------------------------------- |
| `/attendance`         | Real  |   7.0 | Depends on `/classes` (unmounted) for roster picker; no seating-order / photo roster; no offline mode |
| `/attendance/reports` | Real  |   5.5 | Export CSV disabled; no trend charts, per-student drilldown, chronic-absence list                     |

| Capability                                       | Status                     |
| ------------------------------------------------ | -------------------------- | --- |
| Daily + period-wise, bulk, %, threshold alert    | YES                        |
| Late                                             | YES · Early departure      | NO  |
| Regularisation workflow / student leave requests | NO                         |
| Parent notification on absence                   | PARTIAL (Kafka event only) |
| Biometric / RFID ingest                          | NO                         |

→ **G-919**.

### 2.6 Admissions / registration (1 dashboard page + registration portal) — 5.5

| Page                                                        | State | Score | Gap                                                             |
| ----------------------------------------------------------- | ----- | ----: | --------------------------------------------------------------- |
| `/admissions`                                               | Real  |   6.0 | Status + waitlist + interview only                              |
| Registration portal `/`, `/schools`, `/apply/*`, `/track/*` | Real  |   6.5 | No payment step, no document OCR (waived), no applicant account |

| Capability                                         | Status |
| -------------------------------------------------- | ------ |
| Online forms, document upload, waitlist, interview | YES    |
| Enquiry CRM (lead → follow-up tasks)               | NO     |
| Merit list / ranking, entrance test                | NO     |
| Seat matrix per class/category/quota               | NO     |
| Offer letter → fee → auto-enrol                    | NO     |
| Sibling / alumni / RTE quota                       | NO     |

→ **G-906**.

### 2.7 Assessments (5 pages) — 6.5

| Page                                                             | State  | Score | Gap                                                                      |
| ---------------------------------------------------------------- | ------ | ----: | ------------------------------------------------------------------------ | -------- | -------------------- |
| `/assessments`                                                   | Real   |   7.0 | "More" menu inert                                                        |
| `/assessments/schemes/new`, `/[id]/edit`                         | Real   |   7.5 | —                                                                        |
| `/assessments/items`                                             | Real   |   7.0 | Period picker depends on unmounted `/academic-periods`                   |
| `/assessments/results`                                           | Real   |   6.5 | "Excel import" = client-parsed JSON rows; no true XLSX upload / template |
| _(missing)_ `/assessments/outcomes`, `/assessments/report-cards` | Absent |     0 | Backend has `/outcomes`, `/report-cards/templates                        | comments | generate` with no UI |

| Capability                                                               | Status              |
| ------------------------------------------------------------------------ | ------------------- |
| Schemes, weighted items, assignment-level grades, PDF report cards (API) | YES                 |
| Outcomes / standards-based grading UI                                    | NO                  |
| Rubrics, class rank, missing/late flags                                  | NO                  |
| Comments bank                                                            | PARTIAL (free text) |

→ **G-907**, **G-923**.

### 2.8 Gradebook / transcripts (2 pages) — 6.5

| Page                           | State | Score | Gap                                                                                                                 |
| ------------------------------ | ----- | ----: | ------------------------------------------------------------------------------------------------------------------- |
| `/institutions/[id]/gradebook` | Real  |   6.5 | Workflow column display-only (backend has `POST /entries/:id/transition`); no bulk entry grid, no publish-to-parent |
| `/students/records`            | Real  |   7.0 | —                                                                                                                   |

Backend `gradebook`: raw-pg; DRAFT→SUBMITTED→APPROVED→LOCKED; GPA engine; transcripts PDF; board packs; **audit log in-memory**.

→ **G-907**.

### 2.9 Examinations (7 pages) — 4.5

| Page                            | State        | Score | Gap                                                                                          |
| ------------------------------- | ------------ | ----: | -------------------------------------------------------------------------------------------- |
| `/examinations`                 | Real         |   7.0 | —                                                                                            |
| `/examinations/new`             | Real         |   7.0 | —                                                                                            |
| `/examinations/[id]`            | Real         |   6.0 | Candidate count may be absent from API shape                                                 |
| `/examinations/[id]/candidates` | **Mismatch** |   3.0 | `GET …/candidates` does not exist; Register unwired                                          |
| `/examinations/[id]/results`    | **Mismatch** |   3.5 | Expects rows; API returns publication payload; Upload / Download CSV unwired                 |
| `/examinations/[id]/documents`  | **Mismatch** |   3.0 | Calls `GET …/documents`; API is `/documents/generate` + `/documents/jobs*`; Generate unwired |
| `/examinations/board-exports`   | Real         |   7.0 | (gradebook board exports)                                                                    |

| Capability                                                              | Status                         |
| ----------------------------------------------------------------------- | ------------------------------ |
| Scheduling, centres, eligibility rules, publish, analysis, board export | YES                            |
| Seating plan persisted                                                  | NO (Prisma seating repo empty) |
| Invigilator allocation                                                  | NO                             |
| Hall tickets / certificates UI                                          | NO (API only)                  |
| Double marks entry / moderation / re-evaluation                         | NO                             |

→ **G-902**, **G-908**.

### 2.10 Timetable / master schedule (4 pages) — 6.5

| Page                                      | State | Score | Gap                                               |
| ----------------------------------------- | ----- | ----: | ------------------------------------------------- |
| `/institutions/[id]/timetable`            | Real  |   7.0 | No drag-drop, no teacher/room views, no print/ICS |
| `/institutions/[id]/schedule`             | Real  |   7.0 | No auto-generate                                  |
| `/institutions/[id]/schedule/[sectionId]` | Real  |   7.0 | —                                                 |
| `/academic-periods/[id]/bell-schedules`   | Real  |   7.0 | —                                                 |

Backend `timetable`: raw-pg; clash engine 409; substitutions; publish. **No solver.** → **G-917**.

### 2.11 LMS + Spiral PAL (4 pages) — 6.0

| Page                    | State | Score | Gap                                                                       |
| ----------------------- | ----- | ----: | ------------------------------------------------------------------------- |
| `/lms`                  | Real  |   6.5 | No class-wide analytics, no calendar view                                 |
| `/lms/assignments/new`  | Real  |   6.0 | MCQ only; attachments are URL strings; no rubric; no question bank picker |
| `/lms/assignments/[id]` | Real  |   6.5 | No rubric grading, no file preview, no discussion                         |
| `/lms/pal`              | Real  |   6.0 | Per-student lookup only; no cohort mastery heatmap                        |

| Capability                                                                                  | Status       |
| ------------------------------------------------------------------------------------------- | ------------ |
| Assignments / homework / quizzes, auto-grade, Spiral PAL                                    | YES          |
| Question bank, item types (MSQ/numeric/match/essay)                                         | NO / PARTIAL |
| Rubrics, file uploads (object storage), discussions, content library, SCORM/LTI, plagiarism | NO           |
| Parent / student LMS view, offline                                                          | NO           |

→ **G-915**, **G-904**.

### 2.12 Curriculum — 1.5

No syllabus, lesson plans, outcomes UI, or coverage tracking. Only `POST/GET/DELETE /outcomes` in `assessment` and LMS skills taxonomy. → **G-923**.

### 2.13 Fees / student finance (4 pages) — 4.5

| Page             | State                     | Score | Gap                                                                                       |
| ---------------- | ------------------------- | ----: | ----------------------------------------------------------------------------------------- |
| `/fees`          | Real (parent-portal APIs) |   5.0 | Hub only; no dues dashboard, collection KPIs                                              |
| `/fees/plans`    | Real                      |   4.5 | Flat name/code/amount/frequency; no class/category/term mapping, concessions, instalments |
| `/fees/invoices` | Real                      |   5.0 | No bulk generation per class, no reminders, no PDF                                        |
| `/fees/receipts` | Real                      |   5.0 | No refund, no reconciliation                                                              |

Backend `fees`: pg or in-memory; double-entry AR/cash + trial balance (G-718); **sandbox PSP** (waived G-202). Staff pages call `/parent-portal/fees/*`, not `/fees/*` — two fee stores in play.

| Capability                                                                                                                        | Status               |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Invoices, receipts, parent self-pay (sandbox), ledger                                                                             | YES / PARTIAL        |
| Fee structures per class/category, concessions, instalments, refunds, reminders, fee reports, reconciliation, scholarship netting | NO                   |
| Multi-currency                                                                                                                    | PARTIAL (field only) |

→ **G-903**, **G-911**.

### 2.14 Scholarships (7 pages) — 6.0

| Page                                                                      | State        | Score | Gap                                                   |
| ------------------------------------------------------------------------- | ------------ | ----: | ----------------------------------------------------- | ------- |
| `/scholarships`, `/programs/new`, `/programs/[id]`, `/programs/[id]/edit` | Real         |   7.0 | Eligibility UI is free-text; API supports rich rules  |
| `/scholarships/applications`                                              | Real         |   6.0 | Export button UI-only                                 |
| `/scholarships/applications/[id]`                                         | **Scaffold** |   3.5 | Approve / Reject buttons not wired to `POST …/approve | reject` |
| `/scholarships/disbursements`                                             | Partial      |   6.0 | "New batch" CTA incomplete                            |

→ **G-911**, **G-925**.

### 2.15 Hostel (5 pages) — 6.5

All five pages real (`/hostel`, `/structure`, `/assignments`, `/leaves`, `/visitors`). Missing: mess, gate pass, hostel fee link, hostel attendance, occupancy analytics. → **G-921**.

### 2.16 Library (3 pages) — 5.0

| Page                   | State   | Score | Gap                                                            |
| ---------------------- | ------- | ----: | -------------------------------------------------------------- |
| `/library`             | Real    |   6.0 | No ISBN lookup, barcode, cover images, subjects/classification |
| `/library/circulation` | Real    |   6.5 | No patron search, barcode scan                                 |
| `/library/overdues`    | Partial |   4.5 | No "assess fine" action (API exists)                           |

Missing: reservations/holds, OPAC for students/parents, e-resources. → **G-916**.

### 2.17 Transport (5 pages) — 5.5

Routes / vehicles / assignments pages real; `/transport` hub is nav-only. Missing: stops UI, live GPS map, bus-attendance UI (stub API exists), alerts, fee link. → **G-920**.

### 2.18 Health & wellbeing (6 pages) — 5.5

| Page                                                                            | State              | Score | Gap                                                                                            |
| ------------------------------------------------------------------------------- | ------------------ | ----: | ---------------------------------------------------------------------------------------------- |
| `/health`, `/health/[studentId]`, `/health/screenings`, `/health/special-needs` | **Seed aggregate** |   4.5 | Served by `health-ui-plugin` + `health-ui-seed.ts`; domain CRUD under `/health/*` not surfaced |
| `/health/counselling`                                                           | Hybrid             |   6.0 | Seed + live merge                                                                              |
| `/health/counselling/new`                                                       | Real               |   7.0 | —                                                                                              |

Missing: nurse incidents/visits, vaccination & allergy pages, medication administration, PHI access-log viewer, health consent. → **G-912**.

### 2.19 Communication (4 pages) — 6.0

Campaigns list/new/send and dual-confirm emergency are real (sandbox delivery, waived G-207). Missing: WhatsApp channel, circulars, delivery-log ops console, audience segment builder. → **G-922**.

### 2.20 Notifications (1 + 1 admin) — 5.0

`/notifications` inbox real; preferences link → `/app/settings/notifications` **does not exist**; `/admin/notification-rules` is a stub although `/notifications/rules` CRUD exists. → **G-910**.

### 2.21 Parent portal (5 pages) — 5.0

`/parent`, `/parent/fees`, `/parent/messages`, `/parent/messages/[threadId]`, `/parent/consents` real. Missing: attendance, grades / report cards, timetable, LMS/homework, calendar, notices. No student portal. → **G-904**.

### 2.22 Dashboard home (1) — 5.0

KPIs + quick actions + approvals; single layout for all roles. → **G-909**.

### 2.23 Tenant admin (6 pages) — 3.5

| Page                        | State    | Score | Gap                                                                                                 |
| --------------------------- | -------- | ----: | --------------------------------------------------------------------------------------------------- |
| `/admin`                    | Scaffold |   4.0 | Nav hub with forced ScaffoldModeBanner                                                              |
| `/admin/users`              | Scaffold |   3.5 | `GET /admin/users` not in mount matrix; Invite / Edit unwired (auth has `POST /admin/users/invite`) |
| `/admin/roles`              | Scaffold |   3.5 | Create / Edit unwired                                                                               |
| `/admin/permissions`        | Scaffold |   3.5 | Read-only matrix                                                                                    |
| `/admin/tenant`             | Scaffold |   3.5 | Save not wired to a live action                                                                     |
| `/admin/notification-rules` | Stub     |   2.5 | "editor lands in next slice"                                                                        |

→ **G-910**.

### 2.24 Platform (billing / audit-logs / tenant-lifecycle) — 5.5

Read-only catalogues over mounted but **in-memory** plugins; audit is not append-only/hash-chained; no DSAR admin UI. → **G-913**.

### 2.25 Reports / BI (3 pages) — 4.5

Template catalogue + board summary real; `/reports/new` generate produces synthetic `downloadUrl` / `fileSizeKb`; `/reports/[id]/results` downloads are fake; scheduling only in unmounted `report` package. → **G-909**.

### 2.26 Data warehouse (4 pages) — 3.5

Indicators list real; import jobs stub queue; `/field-mapping` forced scaffold; `/map` placeholder (no Leaflet/MapLibre). `data-warehouse` + `etl` unmounted. → **G-924**.

### 2.27 Workflows (5 pages) — 6.5

Definitions / instances / approvals real via `workflow-ui` (pg). Missing: delegation, SLA configuration, form builder, audit trail view; dual engines. → **G-924** (consolidation).

### 2.28 Auth (9 pages) — 7.5

Login, MFA, MFA setup (×2 routes — duplicate `auth/mfa-setup` vs `(auth)/mfa-setup`), signup, forgot/reset, logout, oauth callback all real. Missing: SCIM, password-policy console, live IdP evidence (waived). → **G-924**.

### 2.29 Help (1) — 5.0

Static guides; no ticketing / release notes / contextual help. → **G-924**.

### 2.30 Portal apps & mobile

| App                 | Score | Gap                                                     |
| ------------------- | ----: | ------------------------------------------------------- |
| Registration portal |   6.5 | No payment step; no applicant login                     |
| Public website      |   6.0 | No CMS; `/status` partial                               |
| Admin console       |   5.0 | ui-seed backend; themes stub                            |
| Developer portal    |   4.5 | Static marketplace; API keys not minted live            |
| Install wizard      |   5.0 | `install` package unmounted                             |
| Mobile (Flutter)    |   6.0 | Single app; no student mode; device farm waived (G-407) |

---

## 3. Cross-module themes

| Theme                                        | Evidence                                                                                                                            | Wave 9                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Code exists but is not composed**          | institution sub-routes, `report`, `data-warehouse`, `etl`, `install`, `policy`, parked `custom-field`/`theme`/`dashboards`/`survey` | G-901, G-909, G-924        |
| **UI ↔ API contract drift**                  | examinations (3 pages), infrastructure path, notifications prefs link, admin users                                                  | G-902, G-901, G-910        |
| **Inert primary actions**                    | 11 pages with disabled/unwired buttons                                                                                              | G-925                      |
| **Seed/demo data behind real-looking pages** | health-ui seed, platform-admin ui-seed, student heatmap synthetic, institution overview from customData                             | G-912, G-914, G-924        |
| **In-memory stores on mounted paths**        | audit, billing, tenant, auth identity, student import queue, gradebook audit, infrastructure                                        | G-913, G-901               |
| **Two implementations of one concern**       | fees (`/fees` vs `/parent-portal/fees`), workflows (`/workflows` vs `/workflow-engine`), MFA setup routes                           | G-903, G-924               |
| **Missing "second half" of every lifecycle** | admissions→enrol, grades→publish→parent, fees→dues→reminder→refund, exam→seating→invigilate→moderate→re-eval                        | G-906, G-907, G-903, G-908 |

---

## 4. Wave 9 gap register (registered in master audit §2)

| ID        | Sev | Module                          | Gap                                                                                                                                                           | Fix (scope)                                                                                                                                                                                                                                                                                                                  | Acceptance                                                                                                                     |
| --------- | --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **G-901** | S0  | Institutions / Academic periods | `/academic-periods`, `/grades`, `/classes`, `/subjects`, `/institution-subjects`, `/infrastructure/*` not mounted; infrastructure in-memory; UI path mismatch | Register academic-period / education / infrastructure route modules in `institutionPlugin` (or a new `academics` registrar), add prefixes to `domain-plugins.ts` + `mount-matrix.ts` + RBAC path map; pg infrastructure repo on `db/sql`; align `/institutions/:id/infrastructure/hierarchy`; enable classes/grades Add/Edit | Mount-matrix test lists prefixes; `pg-*` smoke; e2e write smoke: create period → grade → class → mark attendance on that class |
| **G-902** | S0  | Examinations                    | Candidates GET missing; documents/results route + shape mismatch; Register / Upload / Generate unwired                                                        | Add `GET /examinations/:id/candidates`, `GET …/results/rows`; UI calls `/documents/generate` + polls `/documents/jobs`; wire buttons via server actions                                                                                                                                                                      | e2e: register candidate → publish results → generate admit cards → download                                                    |
| **G-903** | S0  | Fees                            | Flat plans only; two fee stores                                                                                                                               | Fee structures (class × category × term), concessions, instalment schedules, refunds, dues reminders (notification rule), fee reports, reconciliation import; staff pages use `/fees/*`; parent-portal fee routes delegate to `backend-fees`                                                                                 | Property test: sum(instalments)=structure; e2e: structure → bulk invoice class → concession → pay → refund → report            |
| **G-904** | S0  | Parent / student portals        | No academic visibility                                                                                                                                        | Parent pages: attendance, grades/report cards, timetable, homework (LMS), calendar, notices; student portal `(student)` with same + PAL plan                                                                                                                                                                                 | Self-binding tests (parent sees only linked children); e2e per page; a11y/dark/touch lists                                     |
| **G-905** | S1  | Academic calendar               | No year→term, holidays, grading windows, rollover/promotion                                                                                                   | `academic_years` + `terms` + `holidays` + grading windows; rollover wizard (sections, assignments, fee structures); bulk student promotion                                                                                                                                                                                   | e2e: rollover year → promote class → verify enrollments                                                                        |
| **G-906** | S1  | Admissions                      | Pipeline ends at waitlist/interview                                                                                                                           | Enquiry CRM (leads, follow-up tasks), merit list ranking, seat matrix per class/quota, offer letter, fee-on-offer, auto-enrol on acceptance                                                                                                                                                                                  | e2e: enquiry → apply → merit → offer → pay (sandbox) → enrolled student                                                        |
| **G-907** | S1  | Gradebook / Assessments         | Workflow not in UI; no rank / CGPA / comments bank / publish; outcomes & report-card UI absent; audit in-memory                                               | Transition controls + bulk grid on gradebook page; class rank + CGPA engine; comments bank; publish → parent; `/assessments/outcomes` + `/assessments/report-cards` pages; pg grade-change audit                                                                                                                             | Deny test teacher cannot APPROVE; e2e submit → approve → lock → parent sees grade                                              |
| **G-908** | S1  | Examinations ops                | No invigilators, persisted seating, double entry, re-evaluation                                                                                               | Invigilator allocation with clash check; pg seating repo; double marks entry with variance flag; re-evaluation request workflow                                                                                                                                                                                              | Property test: no invigilator double-booked; e2e re-eval                                                                       |
| **G-909** | S1  | Reports / BI / Dashboard        | Synthetic downloads; no scheduling; single dashboard                                                                                                          | Real CSV/XLSX/PDF generation to object storage with signed URL; schedules (mount `report` or extend insights-ui); role dashboards board / principal / teacher / parent (unpark `dashboards` behind RBAC)                                                                                                                     | Download hash matches; scheduled run appears; role-switch e2e                                                                  |
| **G-910** | S1  | Tenant admin / Notifications    | Users/roles/permissions/tenant not wired; rules editor stub; prefs route missing                                                                              | Wire to auth admin routes (list/invite/edit users, create/edit roles, permission toggles), tenant branding save, `/admin/notification-rules` CRUD UI, `/notifications/preferences` page                                                                                                                                      | Admin deny matrix; e2e invite → accept → role assign; prefs round-trip                                                         |
| **G-911** | S1  | Scholarships                    | Approve/Reject unwired; eligibility UI free-text; no netting                                                                                                  | Server actions for approve/reject; structured eligibility form; disbursement → fee credit note (dep G-903)                                                                                                                                                                                                                   | e2e approve → disburse → invoice shows credit                                                                                  |
| **G-912** | S1  | Health                          | Seed aggregates; missing incidents / vaccination / allergy / PHI viewer                                                                                       | Replace `health-ui-seed` with domain queries; nurse incident & medication entities + pages; vaccination/allergy pages; PHI access-log viewer (role-gated)                                                                                                                                                                    | Zero seed rows in prod path; PHI log e2e                                                                                       |
| **G-913** | S1  | Audit / Compliance              | Audit store in-memory; no DSAR UI; retention not runtime                                                                                                      | pg append-only audit with hash chain + verify endpoint; DSAR export UI (student/staff); retention policy jobs (mount `policy`)                                                                                                                                                                                               | Tamper test fails verify; DSAR e2e                                                                                             |
| **G-914** | S1  | Students                        | Photo, ID card, siblings, consent flags, discipline, real heatmap                                                                                             | Object-storage photo upload; ID-card PDF; sibling links; consent flags; discipline/behaviour log; attendance heatmap from `/attendance/percentage`                                                                                                                                                                           | e2e profile shows real attendance; ID-card download                                                                            |
| **G-915** | S1  | LMS                             | MCQ-only; no bank / rubrics / uploads / discussions / content                                                                                                 | Question bank + MSQ/numeric/match/essay; rubric grading; file uploads (storage); discussions; lesson/content library; class analytics                                                                                                                                                                                        | e2e: bank → quiz → essay rubric grade → analytics                                                                              |
| **G-916** | S2  | Library                         | No ISBN import, holds, barcode, OPAC; fines UI                                                                                                                | ISBN lookup adapter; reservations; barcode fields/scan; OPAC pages for students/parents; assess-fine button                                                                                                                                                                                                                  | e2e hold → checkout → overdue → fine → fee invoice                                                                             |
| **G-917** | S2  | Timetable                       | No auto-generation; no parent/student view                                                                                                                    | Constraint solver (greedy + repair) behind job; institution substitution page; parent/student timetable page (dep G-904)                                                                                                                                                                                                     | Property test: generated timetable has 0 clashes                                                                               |
| **G-918** | S2  | Staff / HR                      | No contracts, staff attendance page, bulk import, payroll export                                                                                              | Contracts + qualifications registry; `/staff/attendance`; Excel import; payroll CSV export                                                                                                                                                                                                                                   | e2e import → contract → attendance → export                                                                                    |
| **G-919** | S2  | Attendance                      | No regularisation, early departure, student leave, biometric ingest; CSV export                                                                               | Regularisation workflow (dep workflows); EARLY_DEPARTURE; student leave requests; `/attendance/ingest` for devices; enable export                                                                                                                                                                                            | e2e regularise; ingest contract test                                                                                           |
| **G-920** | S2  | Transport                       | No stops UI, GPS map, bus attendance UI, alerts, fee link                                                                                                     | Stops management; live map (MapLibre) from GPS stub; bus attendance page; alert rules; transport fee structure (dep G-903)                                                                                                                                                                                                   | e2e stop → assign → GPS ping visible                                                                                           |
| **G-921** | S2  | Hostel                          | No mess, gate pass, fees, attendance                                                                                                                          | Mess plans; gate pass; hostel fee structure (dep G-903); hostel attendance                                                                                                                                                                                                                                                   | e2e gate pass approve                                                                                                          |
| **G-922** | S2  | Communication                   | No WhatsApp, circulars, delivery console                                                                                                                      | WhatsApp adapter (sandbox; live waived); circular type with acknowledgement; delivery-log console                                                                                                                                                                                                                            | e2e circular → ack                                                                                                             |
| **G-923** | S2  | Curriculum                      | Absent                                                                                                                                                        | Syllabus / lesson plans; outcomes UI; coverage tracking linked to timetable meetings and LMS skills                                                                                                                                                                                                                          | e2e lesson plan → coverage %                                                                                                   |
| **G-924** | S2  | Platform long-tail              | SCIM; parked custom-field/theme; DW/ETL/install/policy unmounted; dual workflow engines; duplicate MFA-setup routes; help tickets                             | Decide mount-or-retire per package (matrix); SCIM users/groups; custom fields UI; consolidate `/workflows` onto engine; remove duplicate route; tickets link                                                                                                                                                                 | Matrix has no "unmounted-undecided" rows                                                                                       |
| **G-925** | S2  | Cross-cutting UX                | 11 pages ship disabled/inert primary actions                                                                                                                  | Wire or remove each; lint rule: `disabled` primary button requires `title`/reason; e2e asserts no inert primary CTA                                                                                                                                                                                                          | Unit gate: zero `<Button disabled>` without reason in `(dashboard)`                                                            |

**Execution order:** G-901 → G-902 → G-903 → G-904 (S0, parallel where paths differ) → G-905/906/907/908 → G-909/910/911/912/913/914/915 → S2 long-tail.

---

## 5. Method & sources

- Four read-only explores over `apps/web/src/app/**`, `apps/{public-website,registration-portal,admin-console,developer-portal,install-wizard,mobile}`, `packages/backend/*`, `apps/api-gateway/src/*` (2026-09-09).
- Verification: `apps/api-gateway/src/domain-plugins.ts` (institution registrar proxies `/institutions` only); `packages/backend/institution/src/institution-plugin.ts` (registers institution + area routes only); `apps/web/src/lib/institutions/api.ts` (calls `/academic-periods`, `/grades`, `/classes`, `/institutions/:id/infrastructure/hierarchy`); `packages/backend/examination/src/routes.ts` (candidates POST only); `apps/web/src/app/(dashboard)/scholarships/applications/[id]/page.tsx` (no approve action import).
- Page count: 123 `page.tsx` under `apps/web/src/app` (107 dashboard, 9 auth, 5 parent, 1 public, 1 test).
