# Screen test ledger

Functional screen review of the web app on tip `b6965555` (`seed(db): Sunrise Public School screen-review demo tenant (#416)`). Inventory is every `page.tsx` under `apps/web/src/app` at that tip.

This ledger does **not** say the product is complete, production-ready, or 10/10. A row is `PASS` only after a real exercise of its primary action against Sunrise seeded data or an honestly empty state. No row is `PASS` in this revision.

| Result    | Meaning                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `PASS`    | Primary action was exercised on this tip against seeded rows or an honest empty state. Evidence names what was seen. |
| `FAIL`    | Primary action was exercised and did not do what the screen claims.                                                  |
| `BLOCKED` | Not exercised. A named dependency or an explicit skip prevents the action.                                           |
| `NOT_RUN` | Not exercised yet.                                                                                                   |

Module status `IN_PROGRESS` means a worker owns that tree. It is not a row result. Those rows stay `NOT_RUN` until that worker records evidence.

## Demo tenant and auth

| Item      | Value                                         |
| --------- | --------------------------------------------- |
| Tenant id | `00000000-0000-4000-8000-00000000a501`        |
| Slug      | `sunrise-public-school`                       |
| School    | Sunrise Public School, code `SPS-PUN-01`      |
| Seed      | `db/seeds/006_sunrise_public_school_demo.sql` |
| Data note | `docs/audits/DATA_SUNRISE_DEMO_TENANT.md`     |

The seed does not create a password. Bind the session the same way E2E binds tenant `00000000-0000-4000-8000-000000000001`, and put the Sunrise tenant id on the token and on `X-Tenant-ID`.

- Staff and module screens: `setupGatewayTenantSession` in `apps/web/e2e/fixtures/fake-session.ts` (`E2E_HS256_SESSION=1`), with `tenantId` set to the Sunrise id. Default E2E roles are `SUPER_ADMIN` and `HEALTH_OFFICER`.
- Parent portal: `parentPortalJwtHeaders` in `apps/web/e2e/fixtures/parent-portal-auth.ts`, `sub` `parent-mehta` (Aarav Mehta) or `parent-sharma` (Diya Sharma), role `Parent`, Sunrise tenant id.
- Student portal (`/student`): the seed has student records and no student login `sub`. An empty portal is an honest empty only when the session is a real student bind, not a staff session.

Seeded people and money the first three workers should recognise:

- Students: Aarav Mehta `…a5b1` (9-B), Diya Sharma `…a5b2` (9-B), Vivaan Patel `…a5b3` (8-A), Ananya Reddy `…a5b4` (10-A), Rohan Mehta `…a5b5` (8-A).
- Staff: Sunil Rao `…a591` (principal), Priya Sharma `…a592` (class teacher, 9-B), Neha Verma `…a593` (accounts).
- Fees: plans Term 1 tuition, Term 1 transport, Board exam fee. Invoices `SPS-2026-0001` (open, Aarav), `SPS-2026-0002` (paid, Diya), `SPS-2026-0003` (open, Ananya). Receipt `SPS-RCT-2026-0001`.
- Consents: photo/media pending for Aarav (`parent-mehta`); field trip approved for Diya (`parent-sharma`).
- Institution `…a551`, academic period AY 2026-27 `…a531`.

Reads must stay on the Sunrise tenant. A row that only shows E2E tenant `…0001` data is not a Sunrise `PASS`.

## Workers

| Owner           | Module status | Cloud agent                                                                                       | Owns                                                                                                               |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `parent-portal` | `IN_PROGRESS` | [Parent portal screen test](https://cursor.com/agents/bc-097d8cd7-29c6-4807-8148-b9eb7a6c1250)    | `/parent` except `/parent/attendance`                                                                              |
| `fees`          | `IN_PROGRESS` | [Sunrise fees screen test](https://cursor.com/agents/bc-f6c02dce-5e95-4c68-9419-29fe10e53f0b)     | `/fees` only. `/parent/fees` stays with the parent worker. Hostel and transport fee screens stay in those modules. |
| `students`      | `IN_PROGRESS` | [Sunrise students screen test](https://cursor.com/agents/bc-81689470-b8ec-44c9-bb1e-995c43390846) | `/students` only. The student portal `/student` is a separate module and is `NOT_RUN`.                             |
| `unassigned`    | `NOT_RUN`     | —                                                                                                 | Every other module below.                                                                                          |
| `skipped`       | `BLOCKED`     | —                                                                                                 | Attendance routes. Do not open them.                                                                               |

Orchestrator: [Screen test ledger](https://cursor.com/agents/bc-6150ef39-a41c-4df4-86fa-d4b92e928d9d). Ledger branch `cursor/screen-test-ledger`. Application code is out of scope for this file.

## Do not touch

Leave these pull requests, their branches, and their worktrees alone. Do not merge them. Do not rebase onto them. Do not edit files they are changing.

| PR   | Branch                                      | Why it is frozen                                                                                                     |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| #388 | `cursor/w1-data-15-fk-complete-56c3`        | Open. Current diff is `docs/audits/FULL_MODULE_AUDIT_20260925.md` and `docs/audits/MODULE_API_DB_SCREEN_GAP_MAP.md`. |
| #386 | `ux/attendance-review`                      | Open attendance UX review. Attendance UI, API client, and locale files.                                              |
| #382 | `test/V12-qa-matrix-coverage`               | Open.                                                                                                                |
| #381 | `fix/V15-error-state-audit`                 | Open.                                                                                                                |
| #377 | `fix/tenant-config-locale-seed-conformance` | Open.                                                                                                                |
| #375 | `ci/baseline-track-flake-probe`             | Open. Author marked it do-not-merge.                                                                                 |
| #374 | `fix/jwt-base64url-decode`                  | Open.                                                                                                                |

## Rollup

Counted from the tables below. `PASS` count is 49. Sources: #426 campus (`6ca09c58`, 24), #421 student portal (`5b54b6f3`, 8), #422 scholarships and LMS (`2de080dd`, 13), #427 admissions (`0b1a64cc`, 4). `BLOCKED` rows from those reports stay `BLOCKED`.

| Module           | Status        |  Routes | `NOT_RUN` | `BLOCKED` | Owner            |
| ---------------- | ------------- | ------: | --------: | --------: | ---------------- |
| Parent           | `IN_PROGRESS` |      15 |        15 |         0 | `parent-portal`  |
| Fees             | `IN_PROGRESS` |       9 |         9 |         0 | `fees`           |
| Students         | `IN_PROGRESS` |       9 |         9 |         0 | `students`       |
| Attendance       | `BLOCKED`     |       8 |         0 |         8 | `skipped`        |
| Staff            | `NOT_RUN`     |      11 |        11 |         0 | `unassigned`     |
| Health           | `NOT_RUN`     |      13 |        13 |         0 | `unassigned`     |
| Institutions     | `NOT_RUN`     |      15 |        15 |         0 | `unassigned`     |
| Home             | `NOT_RUN`     |       1 |         1 |         0 | `unassigned`     |
| Academic periods | `NOT_RUN`     |       3 |         3 |         0 | `unassigned`     |
| Admissions       | `PARTIAL`     |       5 |         0 |         1 | `admissions`     |
| Assessments      | `NOT_RUN`     |       7 |         7 |         0 | `unassigned`     |
| Examinations     | `NOT_RUN`     |       8 |         8 |         0 | `unassigned`     |
| Scholarships     | `PARTIAL`     |       7 |         0 |         3 | `scholarships`   |
| LMS              | `PARTIAL`     |      10 |         0 |         1 | `lms`            |
| Reports          | `NOT_RUN`     |       6 |         6 |         0 | `unassigned`     |
| Communication    | `NOT_RUN`     |       8 |         8 |         0 | `unassigned`     |
| Notifications    | `NOT_RUN`     |       2 |         2 |         0 | `unassigned`     |
| Library          | `PASS`        |       7 |         0 |         0 | `campus`         |
| Hostel           | `PASS`        |       8 |         0 |         0 | `campus`         |
| Transport        | `PASS`        |       9 |         0 |         0 | `campus`         |
| Workflows        | `NOT_RUN`     |       5 |         5 |         0 | `unassigned`     |
| Data warehouse   | `NOT_RUN`     |       4 |         4 |         0 | `unassigned`     |
| Admin            | `NOT_RUN`     |       6 |         6 |         0 | `unassigned`     |
| Student portal   | `PASS`        |       8 |         0 |         0 | `student-portal` |
| Auth             | `NOT_RUN`     |      10 |        10 |         0 | `unassigned`     |
| Public and legal | `NOT_RUN`     |       3 |         3 |         0 | `unassigned`     |
| Platform         | `NOT_RUN`     |       7 |         7 |         0 | `unassigned`     |
| **Total**        |               | **204** |   **142** |    **13** |                  |

`/staff/attendance`, `/hostel/attendance`, `/transport/attendance`, `/parent/attendance`, and `/student/attendance` are in Attendance, not in the module that shares the rest of the path.

## Parent — `IN_PROGRESS`

Actor for every row: parent `parent-mehta` (child Aarav Mehta) unless the action says `parent-sharma`. Session tenant is Sunrise. `/parent/attendance` is under Attendance and is not this worker's route.

| Route                         | Actor          | Primary action                                                                                                                               | Result    | Evidence      | Owner worker    |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- | --------------- |
| `/parent`                     | `parent-mehta` | Open the welcome home and list linked children. Expect Aarav Mehta.                                                                          | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/grades`              | `parent-mehta` | List grades for Aarav. Honest empty if the seed has no grade rows.                                                                           | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/timetable`           | `parent-mehta` | Open Aarav's timetable. Honest empty if no timetable is seeded.                                                                              | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/homework`            | `parent-mehta` | List homework for Aarav. Honest empty if none is seeded.                                                                                     | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/lms`                 | `parent-mehta` | Open parent LMS for Aarav. Honest empty if no coursework is seeded.                                                                          | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/report-cards`        | `parent-mehta` | List report cards for Aarav. Honest empty if none are seeded.                                                                                | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/pal`                 | `parent-mehta` | Open the PAL plan. Honest empty if none is seeded.                                                                                           | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/library`             | `parent-mehta` | List library loans or holds for Aarav. Honest empty if none are seeded.                                                                      | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/calendar`            | `parent-mehta` | Open the family calendar for AY 2026-27. Honest empty if no events are seeded.                                                               | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/notices`             | `parent-mehta` | List school notices. Honest empty if none are seeded.                                                                                        | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/messages`            | `parent-mehta` | List message threads. Honest empty if none are seeded.                                                                                       | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/messages/[threadId]` | `parent-mehta` | Open one thread from the list, or record an honest empty when the list has no thread.                                                        | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/consents`            | `parent-mehta` | List consents and see the pending photo/media consent for Aarav. Repeat as `parent-sharma` and see the approved field-trip consent for Diya. | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/fees`                | `parent-mehta` | List invoices and see open `SPS-2026-0001` (Term 1 tuition) for Aarav. As `parent-sharma`, see paid `SPS-2026-0002`.                         | `NOT_RUN` | not exercised | `parent-portal` |
| `/parent/offers`              | `parent-mehta` | List admission offers. Honest empty if none are seeded.                                                                                      | `NOT_RUN` | not exercised | `parent-portal` |

## Fees — `IN_PROGRESS`

Actor: staff session on the Sunrise tenant (accounts context; seed actor Neha Verma). Scope is `/fees` only.

| Route                       | Actor                 | Primary action                                                                                             | Result    | Evidence      | Owner worker |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/fees`                     | staff admin (Sunrise) | Open the fees hub and see plan, invoice, and receipt counts for the three seeded plans and three invoices. | `NOT_RUN` | not exercised | `fees`       |
| `/fees/plans`               | staff admin (Sunrise) | List fee plans and see Term 1 tuition, Term 1 transport, and Board exam fee.                               | `NOT_RUN` | not exercised | `fees`       |
| `/fees/structures`          | staff admin (Sunrise) | List structures and see Grade 9-B term tuition and School transport.                                       | `NOT_RUN` | not exercised | `fees`       |
| `/fees/invoices`            | staff admin (Sunrise) | List invoices and see `SPS-2026-0001` open, `SPS-2026-0002` paid, and `SPS-2026-0003` open.                | `NOT_RUN` | not exercised | `fees`       |
| `/fees/receipts`            | staff admin (Sunrise) | List receipts and see `SPS-RCT-2026-0001` for the Diya Sharma transport payment.                           | `NOT_RUN` | not exercised | `fees`       |
| `/fees/reconciliation`      | staff admin (Sunrise) | Open reconciliation against the seeded balanced journals (open tuition, paid transport, open exam fee).    | `NOT_RUN` | not exercised | `fees`       |
| `/fees/dunning`             | staff admin (Sunrise) | Open dunning for the two open invoices. Honest empty if dunning rows are not seeded.                       | `NOT_RUN` | not exercised | `fees`       |
| `/fees/reports`             | staff admin (Sunrise) | Run or open the fee report for the seeded invoices.                                                        | `NOT_RUN` | not exercised | `fees`       |
| `/fees/scholarship-netting` | staff admin (Sunrise) | Open scholarship netting. Honest empty if no scholarship award is seeded.                                  | `NOT_RUN` | not exercised | `fees`       |

## Students — `IN_PROGRESS`

Actor: staff session on the Sunrise tenant with `student.read`. Scope is `/students` only.

| Route                     | Actor                 | Primary action                                                                                                                   | Result    | Evidence      | Owner worker |
| ------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/students`               | staff admin (Sunrise) | List students and see Aarav Mehta, Diya Sharma, Vivaan Patel, Ananya Reddy, and Rohan Mehta.                                     | `NOT_RUN` | not exercised | `students`   |
| `/students/new`           | staff admin (Sunrise) | Open the add-student form. Submitting a new student is optional; loading the form against Sunrise lookups is the primary action. | `NOT_RUN` | not exercised | `students`   |
| `/students/import`        | staff admin (Sunrise) | Open bulk import and confirm the screen accepts a dry review or shows its empty upload state.                                    | `NOT_RUN` | not exercised | `students`   |
| `/students/enroll`        | staff admin (Sunrise) | Open enrollment and see Sunrise classes 8-A, 9-B, and 10-A as destinations.                                                      | `NOT_RUN` | not exercised | `students`   |
| `/students/records`       | staff admin (Sunrise) | Open student records. Honest empty if no gradebook rows are seeded.                                                              | `NOT_RUN` | not exercised | `students`   |
| `/students/[id]`          | staff admin (Sunrise) | Open Aarav Mehta `00000000-0000-4000-8000-00000000a5b1` and see enrollment in 9-B.                                               | `NOT_RUN` | not exercised | `students`   |
| `/students/[id]/edit`     | staff admin (Sunrise) | Open edit for Aarav Mehta and see the seeded name and admission number `SPS/2026/001`. Saving is optional.                       | `NOT_RUN` | not exercised | `students`   |
| `/students/[id]/enroll`   | staff admin (Sunrise) | Open the enroll action for one seeded student (Vivaan Patel is already in 8-A).                                                  | `NOT_RUN` | not exercised | `students`   |
| `/students/[id]/transfer` | staff admin (Sunrise) | Open transfer for one seeded student and see current school Sunrise Public School. Completing a transfer is optional.            | `NOT_RUN` | not exercised | `students`   |

## Attendance — `BLOCKED`

Skipped. Pull request #386 (`ux/attendance-review`) is changing the attendance screens, client, and locale files. This review does not open these routes and does not edit those files. #388, #382, #381, #377, #375, and #374 stay untouched as well.

| Route                   | Actor                 | Primary action                     | Result    | Evidence                                                       | Owner worker |
| ----------------------- | --------------------- | ---------------------------------- | --------- | -------------------------------------------------------------- | ------------ |
| `/attendance`           | staff admin (Sunrise) | Mark or review section attendance. | `BLOCKED` | skipped; #386 attendance review is open                        | `skipped`    |
| `/attendance/ops`       | staff admin (Sunrise) | Open attendance operations.        | `BLOCKED` | skipped; #386 attendance review is open                        | `skipped`    |
| `/attendance/reports`   | staff admin (Sunrise) | Open attendance reports.           | `BLOCKED` | skipped; #386 attendance review is open                        | `skipped`    |
| `/parent/attendance`    | `parent-mehta`        | View a child's attendance.         | `BLOCKED` | skipped; attendance routes are out of scope while #386 is open | `skipped`    |
| `/student/attendance`   | student portal        | View own attendance.               | `BLOCKED` | skipped; attendance routes are out of scope while #386 is open | `skipped`    |
| `/staff/attendance`     | staff admin (Sunrise) | Review staff attendance.           | `BLOCKED` | skipped; attendance routes are out of scope while #386 is open | `skipped`    |
| `/hostel/attendance`    | staff admin (Sunrise) | Review hostel attendance.          | `BLOCKED` | skipped; attendance routes are out of scope while #386 is open | `skipped`    |
| `/transport/attendance` | staff admin (Sunrise) | Review transport attendance.       | `BLOCKED` | skipped; attendance routes are out of scope while #386 is open | `skipped`    |

## Staff — `NOT_RUN`

Actor: staff admin on the Sunrise tenant. Seeded staff are Sunil Rao, Priya Sharma, and Neha Verma. `/staff/attendance` is under Attendance.

| Route                         | Actor                 | Primary action                                                                                 | Result    | Evidence      | Owner worker |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/staff`                      | staff admin (Sunrise) | List staff and see Sunil Rao, Priya Sharma, and Neha Verma.                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/new`                  | staff admin (Sunrise) | Open the new-staff form.                                                                       | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/import`               | staff admin (Sunrise) | Open staff import and use its empty upload state.                                              | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/[id]`                 | staff admin (Sunrise) | Open Priya Sharma `00000000-0000-4000-8000-00000000a592` and see the class-teacher assignment. | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/[id]/edit`            | staff admin (Sunrise) | Open edit for Sunil Rao and see principal profile fields. Saving is optional.                  | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/[id]/assignments/new` | staff admin (Sunrise) | Open a new assignment for Neha Verma against Sunrise Public School. Saving is optional.        | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/[id]/appraisals/new`  | staff admin (Sunrise) | Open a new appraisal. Honest empty if no appraisal cycle is seeded.                            | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/contracts`            | staff admin (Sunrise) | List contracts. Honest empty if none are seeded.                                               | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/leaves`               | staff admin (Sunrise) | List leave requests. Honest empty if none are seeded.                                          | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/payroll`              | staff admin (Sunrise) | Open payroll. Honest empty if no pay run is seeded.                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/staff/substitutions`        | staff admin (Sunrise) | List substitutions. Honest empty if none are seeded.                                           | `NOT_RUN` | not exercised | `unassigned` |

## Health — `NOT_RUN`

Actor: staff admin on the Sunrise tenant with health access (E2E bind includes `HEALTH_OFFICER`). The seed has no clinical rows, so an empty list after a successful tenant-scoped read is an honest empty. Do not invent PHI.

| Route                      | Actor                    | Primary action                                                                       | Result    | Evidence      | Owner worker |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------ | --------- | ------------- | ------------ |
| `/health`                  | health officer (Sunrise) | Open the health home for Sunrise students.                                           | `NOT_RUN` | not exercised | `unassigned` |
| `/health/[studentId]`      | health officer (Sunrise) | Open the health chart for Aarav Mehta. Honest empty chart if no clinical rows exist. | `NOT_RUN` | not exercised | `unassigned` |
| `/health/allergies`        | health officer (Sunrise) | List allergies. Honest empty.                                                        | `NOT_RUN` | not exercised | `unassigned` |
| `/health/allergies/new`    | health officer (Sunrise) | Open the new-allergy form for a Sunrise student. Saving is optional.                 | `NOT_RUN` | not exercised | `unassigned` |
| `/health/vaccinations`     | health officer (Sunrise) | List vaccinations. Honest empty.                                                     | `NOT_RUN` | not exercised | `unassigned` |
| `/health/vaccinations/new` | health officer (Sunrise) | Open the new-vaccination form. Saving is optional.                                   | `NOT_RUN` | not exercised | `unassigned` |
| `/health/incidents`        | health officer (Sunrise) | List nurse incidents. Honest empty.                                                  | `NOT_RUN` | not exercised | `unassigned` |
| `/health/incidents/new`    | health officer (Sunrise) | Open the nurse-visit form. Saving is optional.                                       | `NOT_RUN` | not exercised | `unassigned` |
| `/health/screenings`       | health officer (Sunrise) | List screenings. Honest empty.                                                       | `NOT_RUN` | not exercised | `unassigned` |
| `/health/counselling`      | health officer (Sunrise) | List counselling notes. Honest empty.                                                | `NOT_RUN` | not exercised | `unassigned` |
| `/health/counselling/new`  | health officer (Sunrise) | Open the new counselling note form. Saving is optional.                              | `NOT_RUN` | not exercised | `unassigned` |
| `/health/special-needs`    | health officer (Sunrise) | List special-needs records. Honest empty.                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/health/phi-access`       | health officer (Sunrise) | Open the PHI access log. Honest empty if no access rows exist.                       | `NOT_RUN` | not exercised | `unassigned` |

## Institutions — `NOT_RUN`

Actor: staff admin on the Sunrise tenant with `institution.read`. School id `00000000-0000-4000-8000-00000000a551`. Section 9-B is `00000000-0000-4000-8000-00000000a572`.

| Route                                        | Actor                 | Primary action                                                                          | Result    | Evidence      | Owner worker |
| -------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/institutions`                              | staff admin (Sunrise) | List schools and see Sunrise Public School, code `SPS-PUN-01`.                          | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/new`                          | staff admin (Sunrise) | Open register-institution. Saving a second school is optional.                          | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]`                         | staff admin (Sunrise) | Open Sunrise Public School `…a551`.                                                     | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/overview`                | staff admin (Sunrise) | Open the Sunrise overview.                                                              | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/edit`                    | staff admin (Sunrise) | Open edit and see name Sunrise Public School and code `SPS-PUN-01`. Saving is optional. | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/classes`                 | staff admin (Sunrise) | List classes 8-A, 9-B, and 10-A.                                                        | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/grades`                  | staff admin (Sunrise) | List grades Grade 8, Grade 9, and Grade 10.                                             | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/curriculum`              | staff admin (Sunrise) | Open curriculum and see Mathematics if the screen lists subjects.                       | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/infrastructure`          | staff admin (Sunrise) | Open infrastructure. Honest empty if no rooms are seeded.                               | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/gradebook`               | staff admin (Sunrise) | Open the gradebook. Honest empty if no marks are seeded.                                | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/schedule`                | staff admin (Sunrise) | Open the master schedule for published sections 8-A, 9-B, and 10-A.                     | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/schedule/[sectionId]`    | staff admin (Sunrise) | Open section 9-B `…a572` and see Aarav Mehta and Diya Sharma enrolled.                  | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/timetable`               | staff admin (Sunrise) | Open the timetable. Honest empty if no periods are placed.                              | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/timetable/generate`      | staff admin (Sunrise) | Open timetable generation. Running a generate that writes data is optional.             | `NOT_RUN` | not exercised | `unassigned` |
| `/institutions/[id]/timetable/substitutions` | staff admin (Sunrise) | List timetable substitutions. Honest empty if none are seeded.                          | `NOT_RUN` | not exercised | `unassigned` |

## Home — `NOT_RUN`

| Route | Actor                 | Primary action                                                                                    | Result    | Evidence      | Owner worker |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/`   | staff admin (Sunrise) | Open the staff home and read tenant counts (school, students, staff, academic period AY 2026-27). | `NOT_RUN` | not exercised | `unassigned` |

## Academic periods — `NOT_RUN`

| Route                                   | Actor                 | Primary action                                                                                                 | Result    | Evidence      | Owner worker |
| --------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/academic-periods`                     | staff admin (Sunrise) | List periods and see AY 2026-27 (`AY26-27`).                                                                   | `NOT_RUN` | not exercised | `unassigned` |
| `/academic-periods/[id]/calendar`       | staff admin (Sunrise) | Open the calendar for AY 2026-27 `00000000-0000-4000-8000-00000000a531`. Honest empty if no events are seeded. | `NOT_RUN` | not exercised | `unassigned` |
| `/academic-periods/[id]/bell-schedules` | staff admin (Sunrise) | Open bell schedules for AY 2026-27. Honest empty if none are seeded.                                           | `NOT_RUN` | not exercised | `unassigned` |

## Admissions — `PARTIAL`

Copied from #427. The seed has no enquiry or application rows. Offer, accept, decline, pay, and enrol were not run.

| Route                     | Actor                 | Primary action                                                                            | Result    | Evidence                                                                                    | Owner worker |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- | ------------ |
| `/admissions`             | staff admin (Sunrise) | Open the admissions inbox. Honest empty.                                                  | `PASS`    | #427: empty applications, waitlist, and slots. Update and book controls disabled.           | `admissions` |
| `/admissions/enquiries`   | staff admin (Sunrise) | List enquiries. Honest empty.                                                             | `PASS`    | #427: empty enquiry list. Institution option is Sunrise Public School.                      | `admissions` |
| `/admissions/seat-matrix` | staff admin (Sunrise) | Open the seat matrix for Sunrise classes.                                                 | `PASS`    | #427: seat-matrix form hydrated. No matrix rows.                                            | `admissions` |
| `/admissions/merit`       | staff admin (Sunrise) | Open the merit list. Honest empty.                                                        | `PASS`    | #427: merit form hydrated. No merit list generated.                                         | `admissions` |
| `/admissions/[id]`        | staff admin (Sunrise) | Open one application from the inbox, or record an honest empty when the inbox has no row. | `BLOCKED` | #427: a missing id shows not-found. No seeded application, so offer and enrol were not run. | `admissions` |

## Assessments — `NOT_RUN`

| Route                            | Actor                 | Primary action                                                                          | Result    | Evidence      | Owner worker |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/assessments`                   | staff admin (Sunrise) | List assessments. Honest empty if none are seeded.                                      | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/schemes/new`       | staff admin (Sunrise) | Open the new assessment scheme form. Saving is optional.                                | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/schemes/[id]/edit` | staff admin (Sunrise) | Open scheme edit from a listed scheme, or record an honest empty when no scheme exists. | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/items`             | staff admin (Sunrise) | List assessment items. Honest empty.                                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/outcomes`          | staff admin (Sunrise) | List outcomes. Honest empty.                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/results`           | staff admin (Sunrise) | List results. Honest empty.                                                             | `NOT_RUN` | not exercised | `unassigned` |
| `/assessments/report-cards`      | staff admin (Sunrise) | List report cards. Honest empty.                                                        | `NOT_RUN` | not exercised | `unassigned` |

## Examinations — `NOT_RUN`

| Route                           | Actor                 | Primary action                                                            | Result    | Evidence      | Owner worker |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/examinations`                 | staff admin (Sunrise) | List examinations. Honest empty if none are seeded.                       | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/new`             | staff admin (Sunrise) | Open the new examination form. Saving is optional.                        | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/board-exports`   | staff admin (Sunrise) | Open board exports for CBSE. Honest empty if no export exists.            | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/[id]`            | staff admin (Sunrise) | Open one examination, or record an honest empty when the list has no row. | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/[id]/candidates` | staff admin (Sunrise) | List candidates for that examination.                                     | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/[id]/documents`  | staff admin (Sunrise) | List exam documents. Honest empty.                                        | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/[id]/ops`        | staff admin (Sunrise) | Open exam-day operations. Honest empty.                                   | `NOT_RUN` | not exercised | `unassigned` |
| `/examinations/[id]/results`    | staff admin (Sunrise) | List exam results. Honest empty.                                          | `NOT_RUN` | not exercised | `unassigned` |

## Scholarships — `PARTIAL`

Copied from #422. Retired `/app/scholarships/*` routes are not in this 204-route inventory. Approve, reject, and retry were not run.

| Route                              | Actor                 | Primary action                                                      | Result    | Evidence                                                                   | Owner worker   |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- | -------------- |
| `/scholarships`                    | staff admin (Sunrise) | List scholarship programs. Honest empty if none are seeded.         | `PASS`    | #422: empty catalog.                                                       | `scholarships` |
| `/scholarships/programs/new`       | staff admin (Sunrise) | Open the new program form. Saving is optional.                      | `PASS`    | #422: form rendered. No submit.                                            | `scholarships` |
| `/scholarships/programs/[id]`      | staff admin (Sunrise) | Open one program, or record an honest empty when none exist.        | `BLOCKED` | #422: no programs seeded (not found).                                      | `scholarships` |
| `/scholarships/programs/[id]/edit` | staff admin (Sunrise) | Open program edit from a listed program, or record an honest empty. | `BLOCKED` | #422: no programs seeded (not found).                                      | `scholarships` |
| `/scholarships/applications`       | staff admin (Sunrise) | List applications. Honest empty.                                    | `PASS`    | #422: empty queue.                                                         | `scholarships` |
| `/scholarships/applications/[id]`  | staff admin (Sunrise) | Open one application, or record an honest empty.                    | `BLOCKED` | #422: no applications seeded (not found). Approve and reject were not run. | `scholarships` |
| `/scholarships/disbursements`      | staff admin (Sunrise) | List disbursements. Honest empty.                                   | `PASS`    | #422: empty ledger. No failed batch, so retry was not shown.               | `scholarships` |

## LMS — `PARTIAL`

Copied from #422. Retired `/app/lms/*` routes are not in this inventory.

| Route                   | Actor                 | Primary action                                        | Result    | Evidence                                                           | Owner worker |
| ----------------------- | --------------------- | ----------------------------------------------------- | --------- | ------------------------------------------------------------------ | ------------ |
| `/lms`                  | staff admin (Sunrise) | Open coursework. Honest empty if no course is seeded. | `PASS`    | #422: coursework hub. Empty assignments.                           | `lms`        |
| `/lms/assignments/new`  | staff admin (Sunrise) | Open the new assignment form. Saving is optional.     | `PASS`    | #422: builder rendered. Empty save blocked in the client. No save. | `lms`        |
| `/lms/assignments/[id]` | staff admin (Sunrise) | Open one assignment, or record an honest empty.       | `BLOCKED` | #422: no assignments seeded (not found).                           | `lms`        |
| `/lms/bank`             | staff admin (Sunrise) | Open the question bank. Honest empty.                 | `PASS`    | #422: question bank opened.                                        | `lms`        |
| `/lms/rubrics`          | staff admin (Sunrise) | List rubrics. Honest empty.                           | `PASS`    | #422: rubrics opened.                                              | `lms`        |
| `/lms/discussions`      | staff admin (Sunrise) | List discussions. Honest empty.                       | `PASS`    | #422: discussions opened.                                          | `lms`        |
| `/lms/lessons`          | staff admin (Sunrise) | List lessons. Honest empty.                           | `PASS`    | #422: lessons opened.                                              | `lms`        |
| `/lms/content`          | staff admin (Sunrise) | List content. Honest empty.                           | `PASS`    | #422: content opened.                                              | `lms`        |
| `/lms/analytics`        | staff admin (Sunrise) | Open class analytics. Honest empty.                   | `PASS`    | #422: class analytics opened.                                      | `lms`        |
| `/lms/pal`              | staff admin (Sunrise) | Open Spiral PAL. Honest empty.                        | `PASS`    | #422: invalid learner id shows client validation. No API write.    | `lms`        |

## Reports — `NOT_RUN`

| Route                   | Actor                 | Primary action                                          | Result    | Evidence      | Owner worker |
| ----------------------- | --------------------- | ------------------------------------------------------- | --------- | ------------- | ------------ |
| `/reports`              | staff admin (Sunrise) | List reports. Honest empty if none are seeded.          | `NOT_RUN` | not exercised | `unassigned` |
| `/reports/new`          | staff admin (Sunrise) | Open the new report form. Saving is optional.           | `NOT_RUN` | not exercised | `unassigned` |
| `/reports/dashboard`    | staff admin (Sunrise) | Open the role dashboard for the Sunrise tenant.         | `NOT_RUN` | not exercised | `unassigned` |
| `/reports/dashboards`   | staff admin (Sunrise) | List dashboards. Honest empty.                          | `NOT_RUN` | not exercised | `unassigned` |
| `/reports/schedules`    | staff admin (Sunrise) | List report schedules. Honest empty.                    | `NOT_RUN` | not exercised | `unassigned` |
| `/reports/[id]/results` | staff admin (Sunrise) | Open results for one report, or record an honest empty. | `NOT_RUN` | not exercised | `unassigned` |

## Communication — `NOT_RUN`

| Route                           | Actor                 | Primary action                                                                                           | Result    | Evidence      | Owner worker |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/communication`                | staff admin (Sunrise) | Open the communication home. Honest empty if no circular is seeded.                                      | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/circulars`      | staff admin (Sunrise) | List circulars. Honest empty.                                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/circulars/new`  | staff admin (Sunrise) | Open the new circular form. Saving is optional.                                                          | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/circulars/[id]` | staff admin (Sunrise) | Open one circular, or record an honest empty.                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/campaigns`      | staff admin (Sunrise) | List campaigns. Honest empty.                                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/campaigns/new`  | staff admin (Sunrise) | Open the new campaign form. Saving is optional.                                                          | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/delivery`       | staff admin (Sunrise) | Open delivery status. Honest empty.                                                                      | `NOT_RUN` | not exercised | `unassigned` |
| `/communication/emergency`      | staff admin (Sunrise) | Open emergency broadcast. Sending a live alert is not the primary action; opening the compose screen is. | `NOT_RUN` | not exercised | `unassigned` |

## Notifications — `NOT_RUN`

| Route                        | Actor                 | Primary action                                                       | Result    | Evidence      | Owner worker |
| ---------------------------- | --------------------- | -------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/notifications`             | staff admin (Sunrise) | List notifications. Honest empty.                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/notifications/preferences` | staff admin (Sunrise) | Open notification preferences and read the current channel settings. | `NOT_RUN` | not exercised | `unassigned` |

## Library — `PASS`

Staff routes only, copied from #426. `/parent/library` and `/student/library` stay in their own modules.

| Route                  | Actor                 | Primary action                                                     | Result | Evidence                                                         | Owner worker |
| ---------------------- | --------------------- | ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------- | ------------ |
| `/library`             | staff admin (Sunrise) | Open the library home. Honest empty if no catalogue row is seeded. | `PASS` | #426: empty holdings, “No holdings yet.”                         | `campus`     |
| `/library/opac`        | staff admin (Sunrise) | Search the catalogue. Honest empty.                                | `PASS` | #426: search form, empty results.                                | `campus`     |
| `/library/[id]`        | staff admin (Sunrise) | Open one title, or record an honest empty.                         | `PASS` | #426: opened “Screen test volume”, accession `LIB-2424F7C3-001`. | `campus`     |
| `/library/circulation` | staff admin (Sunrise) | Open circulation. Honest empty.                                    | `PASS` | #426: empty loans/returns.                                       | `campus`     |
| `/library/holds`       | staff admin (Sunrise) | List holds. Honest empty.                                          | `PASS` | #426: empty holds.                                               | `campus`     |
| `/library/overdues`    | staff admin (Sunrise) | List overdues. Honest empty.                                       | `PASS` | #426: empty overdues.                                            | `campus`     |
| `/library/fines`       | staff admin (Sunrise) | List fines. Honest empty.                                          | `PASS` | #426: empty fines.                                               | `campus`     |

## Hostel — `PASS`

`/hostel/attendance` stays `BLOCKED` under Attendance. Copied from #426. Seed has no hostel rows; empty lists were the honest result.

| Route                 | Actor                 | Primary action                                             | Result | Evidence                                                              | Owner worker |
| --------------------- | --------------------- | ---------------------------------------------------------- | ------ | --------------------------------------------------------------------- | ------------ |
| `/hostel`             | staff admin (Sunrise) | Open the hostel home. Honest empty if no hostel is seeded. | `PASS` | #426: “No hostels yet.” Empty submit says name and code are required. | `campus`     |
| `/hostel/structure`   | staff admin (Sunrise) | List houses, blocks, or rooms. Honest empty.               | `PASS` | #426: empty structure.                                                | `campus`     |
| `/hostel/assignments` | staff admin (Sunrise) | List bed assignments. Honest empty.                        | `PASS` | #426: no beds; student search shows Sunrise names, not UUIDs.         | `campus`     |
| `/hostel/leaves`      | staff admin (Sunrise) | List hostel leaves. Honest empty.                          | `PASS` | #426: empty leave list; student options are national-id and name.     | `campus`     |
| `/hostel/gate-passes` | staff admin (Sunrise) | List gate passes. Honest empty.                            | `PASS` | #426: empty gate-pass list.                                           | `campus`     |
| `/hostel/visitors`    | staff admin (Sunrise) | List visitors. Honest empty.                               | `PASS` | #426: empty visitor list.                                             | `campus`     |
| `/hostel/mess`        | staff admin (Sunrise) | Open mess. Honest empty.                                   | `PASS` | #426: empty mess plans.                                               | `campus`     |
| `/hostel/fees`        | staff admin (Sunrise) | Open hostel fees. Honest empty.                            | `PASS` | #426: empty hostel fee structures.                                    | `campus`     |

## Transport — `PASS`

`/transport/attendance` stays `BLOCKED` under Attendance. Copied from #426. Remove-stop confirm was cancelled.

| Route                          | Actor                 | Primary action                                                                                                                                      | Result | Evidence                                                                     | Owner worker |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | ------------ |
| `/transport`                   | staff admin (Sunrise) | Open the transport home. Honest empty if no route is seeded.                                                                                        | `PASS` | #426: hub cards. Attendance link not followed.                               | `campus`     |
| `/transport/routes`            | staff admin (Sunrise) | List routes. Honest empty.                                                                                                                          | `PASS` | #426: list shows “Sunrise screen route” by name.                             | `campus`     |
| `/transport/routes/new`        | staff admin (Sunrise) | Open the new route form. Saving is optional.                                                                                                        | `PASS` | #426: name-only submit says “Name is required.” Full create added one route. | `campus`     |
| `/transport/routes/[id]/stops` | staff admin (Sunrise) | Open stops for one route, or record an honest empty.                                                                                                | `PASS` | #426: added Stop A. Remove confirm cancelled; stop kept.                     | `campus`     |
| `/transport/vehicles`          | staff admin (Sunrise) | List vehicles. Honest empty.                                                                                                                        | `PASS` | #426: empty vehicles.                                                        | `campus`     |
| `/transport/assignments`       | staff admin (Sunrise) | List student route assignments. Honest empty.                                                                                                       | `PASS` | #426: student picker uses Sunrise names.                                     | `campus`     |
| `/transport/live`              | staff admin (Sunrise) | Open live tracking. Honest empty if no vehicle is reporting.                                                                                        | `PASS` | #426: empty map shell.                                                       | `campus`     |
| `/transport/alerts`            | staff admin (Sunrise) | List transport alerts. Honest empty.                                                                                                                | `PASS` | #426: empty alerts.                                                          | `campus`     |
| `/transport/fees`              | staff admin (Sunrise) | Open transport fees. The seed has a school transport fee structure; show it if this screen reads fee structures, otherwise record the honest empty. | `PASS` | #426: empty transport fee structures on this screen.                         | `campus`     |

## Workflows — `NOT_RUN`

| Route                         | Actor                 | Primary action                                                   | Result    | Evidence      | Owner worker |
| ----------------------------- | --------------------- | ---------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/workflows`                  | staff admin (Sunrise) | Open the workflow home. Honest empty if no definition is seeded. | `NOT_RUN` | not exercised | `unassigned` |
| `/workflows/definitions/new`  | staff admin (Sunrise) | Open the new definition form. Saving is optional.                | `NOT_RUN` | not exercised | `unassigned` |
| `/workflows/definitions/[id]` | staff admin (Sunrise) | Open one definition, or record an honest empty.                  | `NOT_RUN` | not exercised | `unassigned` |
| `/workflows/instances`        | staff admin (Sunrise) | List instances. Honest empty.                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/workflows/approvals`        | staff admin (Sunrise) | List pending approvals. Honest empty.                            | `NOT_RUN` | not exercised | `unassigned` |

## Data warehouse — `NOT_RUN`

| Route                           | Actor                 | Primary action                                                | Result    | Evidence      | Owner worker |
| ------------------------------- | --------------------- | ------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/data-warehouse`               | staff admin (Sunrise) | Open the warehouse home. Honest empty if no import is seeded. | `NOT_RUN` | not exercised | `unassigned` |
| `/data-warehouse/import`        | staff admin (Sunrise) | Open import. Honest empty upload state.                       | `NOT_RUN` | not exercised | `unassigned` |
| `/data-warehouse/map`           | staff admin (Sunrise) | Open the map view. Honest empty.                              | `NOT_RUN` | not exercised | `unassigned` |
| `/data-warehouse/field-mapping` | staff admin (Sunrise) | Open field mapping. Honest empty.                             | `NOT_RUN` | not exercised | `unassigned` |

## Admin — `NOT_RUN`

Actor: staff session whose role matches admin, principal, or super-admin, on the Sunrise tenant. The seed does not create Keycloak users.

| Route                       | Actor                 | Primary action                                                         | Result    | Evidence      | Owner worker |
| --------------------------- | --------------------- | ---------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/admin`                    | staff admin (Sunrise) | Open the admin console.                                                | `NOT_RUN` | not exercised | `unassigned` |
| `/admin/users`              | staff admin (Sunrise) | List users. Honest empty if no directory users are seeded for Sunrise. | `NOT_RUN` | not exercised | `unassigned` |
| `/admin/roles`              | staff admin (Sunrise) | List roles.                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/admin/permissions`        | staff admin (Sunrise) | List permissions.                                                      | `NOT_RUN` | not exercised | `unassigned` |
| `/admin/tenant`             | staff admin (Sunrise) | Open tenant settings and see slug `sunrise-public-school`.             | `NOT_RUN` | not exercised | `unassigned` |
| `/admin/notification-rules` | staff admin (Sunrise) | List notification rules. Honest empty.                                 | `NOT_RUN` | not exercised | `unassigned` |

## Student portal — `PASS`

Copied from #421. `/student/attendance` stays `BLOCKED` under Attendance. The walk used JWT `sub` `00000000-0000-4000-8000-00000000a502` (Aarav). The report says that student row was inserted only in the agent database; it is not in the committed Sunrise seed.

| Route                | Actor                                              | Primary action                                      | Result | Evidence                                               | Owner worker     |
| -------------------- | -------------------------------------------------- | --------------------------------------------------- | ------ | ------------------------------------------------------ | ---------------- |
| `/student`           | student `…a502` (local row, not in committed seed) | Open Today for a linked student.                    | `PASS` | #421: hub cards and nav.                               | `student-portal` |
| `/student/grades`    | student `…a502` (local row, not in committed seed) | List own grades. Honest empty if none are seeded.   | `PASS` | #421: “No published grades yet.”                       | `student-portal` |
| `/student/timetable` | student `…a502` (local row, not in committed seed) | Open own timetable. Honest empty if none is seeded. | `PASS` | #421: “No published class meetings yet.”               | `student-portal` |
| `/student/homework`  | student `…a502` (local row, not in committed seed) | List own homework. Honest empty.                    | `PASS` | #421: “No published homework yet.”                     | `student-portal` |
| `/student/library`   | student `…a502` (local row, not in committed seed) | Open own library. Honest empty.                     | `PASS` | #421: OPAC search shell. Empty loans and holds.        | `student-portal` |
| `/student/calendar`  | student `…a502` (local row, not in committed seed) | Open own calendar. Honest empty.                    | `PASS` | #421: “No holidays or events have been published yet.” | `student-portal` |
| `/student/notices`   | student `…a502` (local row, not in committed seed) | List notices. Honest empty.                         | `PASS` | #421: “There are no school notices right now.”         | `student-portal` |
| `/student/pal`       | student `…a502` (local row, not in committed seed) | Open own PAL plan. Honest empty.                    | `PASS` | #421: “No practice plan yet.”                          | `student-portal` |

## Auth — `NOT_RUN`

These screens do not read Sunrise domain rows. The seed still has no password, so a password login cannot be a `PASS` unless a reviewer binds a real identity outside the seed.

| Route              | Actor                 | Primary action                                                                             | Result    | Evidence      | Owner worker |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------ | --------- | ------------- | ------------ |
| `/login`           | anonymous             | Open sign-in. Password login is not seeded; do not mark `PASS` from the form render alone. | `NOT_RUN` | not exercised | `unassigned` |
| `/logout`          | any signed-in session | Sign out and land on the signed-out screen.                                                | `NOT_RUN` | not exercised | `unassigned` |
| `/signup`          | anonymous             | Open registration.                                                                         | `NOT_RUN` | not exercised | `unassigned` |
| `/forgot-password` | anonymous             | Open forgot-password. Sending mail is optional.                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/reset-password`  | anonymous             | Open reset-password with no token and record the screen's empty or invalid-token state.    | `NOT_RUN` | not exercised | `unassigned` |
| `/mfa`             | challenged user       | Open the MFA challenge.                                                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/mfa/setup`       | signed-in user        | Open MFA setup.                                                                            | `NOT_RUN` | not exercised | `unassigned` |
| `/mfa-setup`       | signed-in user        | Open the alternate MFA setup route.                                                        | `NOT_RUN` | not exercised | `unassigned` |
| `/auth/mfa-setup`  | signed-in user        | Open `/auth/mfa-setup`.                                                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/oauth/callback`  | anonymous             | Open the OAuth callback with no code and record the screen's error or idle state.          | `NOT_RUN` | not exercised | `unassigned` |

## Public and legal — `NOT_RUN`

| Route            | Actor     | Primary action                                                                                    | Result    | Evidence      | Owner worker |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/track`         | anonymous | Track a public reference. Honest empty or not-found for an unknown reference is a valid exercise. | `NOT_RUN` | not exercised | `unassigned` |
| `/legal/privacy` | anonymous | Read the privacy notice.                                                                          | `NOT_RUN` | not exercised | `unassigned` |
| `/legal/terms`   | anonymous | Read the terms.                                                                                   | `NOT_RUN` | not exercised | `unassigned` |

## Platform — `NOT_RUN`

| Route                     | Actor                 | Primary action                                                                                             | Result    | Evidence      | Owner worker |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | ------------- | ------------ |
| `/billing`                | staff admin (Sunrise) | Open platform billing. This is not school fee invoices.                                                    | `NOT_RUN` | not exercised | `unassigned` |
| `/help`                   | staff admin (Sunrise) | Open help.                                                                                                 | `NOT_RUN` | not exercised | `unassigned` |
| `/pipelines`              | staff admin (Sunrise) | Open pipelines. Honest empty.                                                                              | `NOT_RUN` | not exercised | `unassigned` |
| `/tenant-lifecycle`       | staff admin (Sunrise) | Open tenant lifecycle for `sunrise-public-school`.                                                         | `NOT_RUN` | not exercised | `unassigned` |
| `/audit-logs`             | staff admin (Sunrise) | List audit logs. Honest empty if none are seeded.                                                          | `NOT_RUN` | not exercised | `unassigned` |
| `/audit-logs/dsar`        | staff admin (Sunrise) | Open DSAR export. Running an export is optional; opening the request screen is the primary action.         | `NOT_RUN` | not exercised | `unassigned` |
| `/__tests/error-boundary` | staff admin (Sunrise) | Internal error-boundary fixture, not a product screen. Exercise only if a worker is already on this route. | `NOT_RUN` | not exercised | `unassigned` |

## How a worker updates a row

Change only rows in the owned tree, plus the rollup counts. Leave other modules and the frozen pull requests alone.

A `PASS` evidence cell names the actor `sub`, the Sunrise tenant id, the seeded record or the honest empty state, and what the screen showed. A screenshot path or command log belongs in that cell. `NOT_RUN` stays until that exercise exists.
