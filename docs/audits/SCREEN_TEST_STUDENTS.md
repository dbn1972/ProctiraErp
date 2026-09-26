# Students screen test — Sunrise Public School

**Slice:** `apps/web` students routes and `_components` only  
**Tenant:** `00000000-0000-4000-8000-00000000a501` Sunrise Public School  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` (see `docs/audits/DATA_SUNRISE_DEMO_TENANT.md`)  
**Parent commit:** `b6965555`  
**Date (UTC):** 2026-09-26  
**Environment:** Local Postgres 16 (`proctira` superuser), API gateway `:3000`, Next.js `:3001`. Session is an HS256 dev JWT (`tenantId` = Sunrise, role `SUPER_ADMIN`). No password login exists on this seed.

This is a screen walk, not a production-ready or 10/10 claim. Attendance was not opened. Parent and fees trees were not edited.

Seeded people and classes used as the oracle:

| Student      | Class | Admission    |
| ------------ | ----- | ------------ |
| Aarav Mehta  | 9-B   | SPS/2026/001 |
| Diya Sharma  | 9-B   | SPS/2026/002 |
| Vivaan Patel | 8-A   | SPS/2026/003 |
| Ananya Reddy | 10-A  | SPS/2026/004 |
| Rohan Mehta  | 8-A   | SPS/2026/005 |

`custom_data` stores `admissionNo` only. Class and school come from the enrollment (`class_id`, `grade_id`, `institution_id`).

## Route table

| Route                     | Primary action                      | Result      | What the screen showed                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/students` signed out    | Open the list                       | **PASS**    | `200`, landed on `/login?returnTo=%2Fstudents`                                                                                                                                                                                                    |
| `/students`               | Read the list                       | **PASS**    | Rohan Mehta · Grade 8 · 8-A; Aarav Mehta · Grade 9 · 9-B; Vivaan Patel · Grade 8 · 8-A; Ananya Reddy · Grade 10 · 10-A; Diya Sharma · Grade 9 · 9-B. School cell is Sunrise Public School. Name, class/section, and school cells contain no UUID. |
| `/students/[id]` (Aarav)  | Open the profile                    | **PASS**    | Heading Aarav Mehta. Class line Grade 9 · 9-B.                                                                                                                                                                                                    |
| `/students/[id]/edit`     | Save with no field edits            | **PASS**    | Subtitle `Adm. SPS/2026/001 · Grade 9 · 9-B · Sunrise Public School`. Save returns to `/students/00000000-0000-4000-8000-00000000a5b1`.                                                                                                           |
| `/students/new`           | Save empty                          | **PASS**    | "First name is required".                                                                                                                                                                                                                         |
| `/students/new`           | Create a student                    | **PASS**    | Created "Screen Probe" (`62a11fbf-997b-4fad-849b-975f36473f07`). An earlier probe (`844b0a02-df2d-47ed-a8b5-c432d4c060e2`) has no enrollment. These rows exist only in this database, not in the seed file.                                       |
| `/students/[id]/enroll`   | Enroll the second probe             | **PASS**    | Grade 8, AY 2026-27, class 8-A. `enrollments.status = ENROLLED`, `classes.name = 8-A`. The list then shows that probe as Grade 8 · 8-A at Sunrise Public School. The unenrolled probe stays "—".                                                  |
| `/students/import`        | Download template                   | **PASS**    | `GET /students/import/template` → `200`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.                                                                                                                                     |
| `/students/import`        | Start import                        | **FAIL**    | Attaching `students-import-template.xlsx` enables Start import. `POST /students/import` returns status text `ExcelJS.Workbook is not a constructor`. Student count stayed at the five seed rows plus the two probes.                              |
| `/students/records`       | Open the student picker             | **PASS**    | Options are person names (Aarav Mehta, Diya Sharma, Vivaan Patel, Rohan Mehta, Ananya Reddy, and the two probes). No UUID option labels. Empty table: "No transcripts yet".                                                                       |
| `/students/records`       | Issue official transcript for Aarav | **BLOCKED** | Alert: dedicated transcript signing key required (`TRANSCRIPT_SIGNING_SECRET` and `TRANSCRIPT_SIGNING_KMS_KEY_REF`). `transcript_issuances` count is 0. The students page submitted the named student; issuance is blocked outside this tree.     |
| `/students/[id]/transfer` | Read source enrollment              | **PASS**    | Subtitle and source control: Sunrise Public School · Grade 9 · 9-B. The option text is not an enrollment UUID.                                                                                                                                    |
| `/students/[id]/transfer` | Submit with no destination          | **PASS**    | Validation: destination institution, grade, academic period, class/section, and reason are required. URL stayed on the transfer page. No transfer was posted.                                                                                     |

## Fixes in this change

Sunrise enrollments were invisible on the list because the page read grade and school only from `custom_data`. The list, profile, edit subtitle, and transfer source now resolve the active enrollment through class, grade, and institution names (`student-placement-label.ts`). An unresolved id renders as "—", not a UUID.

`GET /institutions/:id/grades` and `GET /institutions/:id/academic-periods` 404 for this tenant. Enroll and transfer actions fall back to tenant-wide `GET /grades` and `GET /academic-periods` (Grade 8/9/10, AY 2026-27).

`/api/students/import/template` 404s, and the gateway treats `/students/import/template` as a job id. The download now hits `/students/import/template`, which builds the header row from the parser's expected columns.

The records issue form selects a student by name. Transcript signing still fails closed without the signing env vars.

The grade filter stays "All grades". `GET /students` does not filter by grade, so a populated dropdown would filter nothing.

## Residuals

| Item               | Disposition               | Notes                                                                                                                                                                               |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import parse       | **OPEN**                  | `packages/backend/student/src/import/excel-parser.ts` does `new (await import('exceljs')).Workbook()`. That constructor error is outside this write surface, so it was not changed. |
| Transcript issue   | **EXTERNALLY_UNVERIFIED** | Needs `TRANSCRIPT_SIGNING_SECRET` and `TRANSCRIPT_SIGNING_KMS_KEY_REF`. Not a students-page label bug.                                                                              |
| Shell breadcrumb   | **OPEN**                  | `apps/web/src/components/layout/breadcrumbs.tsx` shortens a student id to `00000000…`. Page headings and table cells use the name. Layout is outside this write surface.            |
| Grade filter       | **OPEN**                  | Dropdown is only "All grades" until the list API accepts `gradeId`.                                                                                                                 |
| Transfer checklist | **PARTIAL**               | Copy says the checklist and approval chain are samples, not live status for this student.                                                                                           |
| Completed transfer | not exercised             | Validation-only. Aarav was not moved off 9-B.                                                                                                                                       |
| Screen Probe rows  | local only                | Two extra students in this Postgres. Re-running the seed does not remove them.                                                                                                      |

Unit coverage for the label helper: `apps/web/src/app/(dashboard)/students/_components/student-placement-label.test.ts`.

## Release

App-only web change. No migration, no seed edit, no feature flag. Do not merge until CI Aggregate is green on this commit. Rollback is reverting the commit. This document does not claim the students module is production-ready.
