# Enterprise product / IA checklist

**Module / slice:** Institutions detail — Overview, Classes, Grades, Schedule, Schedule section  
**Branch / tip:** `cursor/institutions-detail-parity-0b3f` (tip recorded at commit time)  
**Date (UTC):** 2026-09-28  
**Owner / agent:** cloud agent

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`.

## 1. Capability statement

A principal on the staff shell opens one school and sees a live overview (enrollment, staff, attendance, rooms, activity, contact), the class sections taught there, the grades that school offers with real utilization, the master schedule with clash labels, and a section roster they can publish or withdraw from. Numbers and names come from the Sunrise tenant APIs. Prototype review chips do not ship.

## 2. Personas & jobs

| Persona                  | Job-to-be-done                                                                      | Success looks like                                              |
| ------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Principal (Priya Sharma) | See whether Mayur Vihar is staffed, full, and clash-free                            | Overview KPIs, class teachers, grade utilization, named clashes |
| Academic admin           | Assign a class teacher and room, publish or unpublish a section, withdraw a student | Confirm dialog on unpublish and withdraw; names, not UUIDs      |
| Parent / guardian        | Must not read another school's institution detail                                   | `institution:read` denied (gateway 403)                         |

## 3. Scope

| In scope                              | Non-goals                                                          |
| ------------------------------------- | ------------------------------------------------------------------ |
| Five detail routes listed in the task | Timetable generate, gradebook, curriculum, infrastructure redesign |
| Overview aggregate API                | PDF school-report service                                          |
| Class teacher + room on `classes`     | Rewriting attendance internals                                     |
| Sunrise seed rows these screens need  | Fake UI numbers when an API is down                                |

## 4. Peer parity

| Peer capability                                         | Our target this slice                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Blackbaud / PowerSchool school profile + section roster | Staff can read school facts and section membership with names             |
| Prototype `design/prototype/institutions/detail-*.html` | Same information architecture; live data may differ from the sample story |

## 5. Surface map

| Nav label     | Route                                   | API                                | Tables / events                                                                                        | Shell |
| ------------- | --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| Overview      | `/institutions/:id/overview`            | `GET /institutions/:id/overview`   | enrollments, staff_assignments, student_attendance, rooms, audit_log_entries, institutions.custom_data | staff |
| School report | `/institutions/:id/overview/report`     | same overview payload              | same                                                                                                   | staff |
| Classes       | `/institutions/:id/classes`             | `GET/PUT /classes`                 | classes, staff                                                                                         | staff |
| Grades        | `/institutions/:id/grades`              | grades list + overview enrollment  | grades, classes, enrollments                                                                           | staff |
| Schedule      | `/institutions/:id/schedule`            | timetable sections + conflicts     | sections, meetings, rooms                                                                              | staff |
| Section       | `/institutions/:id/schedule/:sectionId` | section, enroll, withdraw, publish | section_enrollments, section_meetings                                                                  | staff |

## 6. Roles & tenancy (high level)

| Role                                             | Can                     | Cannot                                  |
| ------------------------------------------------ | ----------------------- | --------------------------------------- |
| Principal (`CAMPUS_MANAGE` / `institution:read`) | Read Mayur Vihar detail | Read another tenant's institution (404) |
| Parent                                           | —                       | `institution:read` (403 on overview)    |

Tenant boundary notes: overview SQL filters `tenant_id`. Institution id outside the tenant returns null → HTTP 404.

## 7. Success metrics / DoD

- [x] Five routes render against the Sunrise seed with `E2E_BACKEND_READY=1`
- [x] No `SCREEN STATE` / UX review control in the app
- [x] Destructive unpublish and withdraw use `ConfirmActionDialog`
- [ ] Tip CI Aggregate and E2E backend-ready live gate — not green on this commit yet

## 8. Handoff

| Next skill | Audit path                                   |
| ---------- | -------------------------------------------- |
| Build      | `docs/audits/DEV_INSTITUTIONS_DETAIL.md`     |
| UX         | `docs/audits/UX_INSTITUTIONS_DETAIL.md`      |
| Security   | `docs/audits/SEC_INSTITUTIONS_DETAIL.md`     |
| Test       | `docs/audits/TEST_INSTITUTIONS_DETAIL.md`    |
| Release    | `docs/audits/RELEASE_INSTITUTIONS_DETAIL.md` |
