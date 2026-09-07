# DEV — SIS Master schedule / sections / room conflicts (WS2)

**Capability / module:** Master schedule · Sections · Rostering · Conflict engine · Publish  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `88a293f3fe2a607d3c8cd52b6392e06183381ae7`  
**Owner / agent:** cloud SERVER agent  
**Date (UTC):** 2026-09-06  
**Peer parity target:** Registrar builds course sections with room + teacher, enrolls students, detects room∩time / teacher∩time clashes (409), and publishes draft → published so attendance can list meeting periods (PowerSchool / IC-class master schedule slice)  
**Dev session:** WS2 server slice  
**Paired test audit:** `docs/audits/SIS_MASTER_SCHEDULE_TEST_NOTES.md`

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | A registrar can CRUD **sections** (course offerings), assign **default rooms**, **enroll/withdraw** students, place **meetings** with room/teacher (409 on clash), and **publish** draft → published (locks edits). Attendance surfaces **published section meetings** as period slots for the selected institution/weekday. |
| In scope (peer parity) | Sections CRUD; roster enroll/withdraw + capacity; rooms list/create API; meeting room∩time + teacher∩time clash → 409; publish/unpublish; attendance-periods API + attendance UI listing; cert seed; ungated Playwright inventory smoke                                                                                      |
| Explicit non-goals     | Full student-picker UX (UUID enroll for now); live IdP RBAC deny E2E; student overload enforced on enroll across sections (domain helper exists; API gate residual); gradebook; board exports                                                                                                                                |
| Roles (RBAC)           | Registrar / Scheduler: write + publish; Teacher: read — enforced on write/publish routes                                                                                                                                                                                                                                     |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: board-agnostic schedule primitives (seeded on CBSE-DEL-01)                                                                                                                                                                                                                                      |

Screen / API inventory:

| Nav / surface        | Route                                     | API                                                   | Tables                       | PII            |
| -------------------- | ----------------------------------------- | ----------------------------------------------------- | ---------------------------- | -------------- |
| Master schedule      | `/institutions/[id]/schedule`             | `/api/v1/timetable/sections`, `/rooms`, `.../publish` | `sections`, `rooms`          | Staff IDs      |
| Section roster       | `/institutions/[id]/schedule/[sectionId]` | `.../enrollments`, publish                            | `section_enrollments`        | Student IDs    |
| Timetable (existing) | `/institutions/[id]/timetable`            | `/timetable/meetings`                                 | `section_meetings`           | Staff/room IDs |
| Attendance periods   | `/attendance?institutionId=`              | `/timetable/attendance-periods`                       | published `section_meetings` | No             |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                                                                                                         |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/003_sis_timetable_schedule_schema.sql` (rooms, sections, enrollments, meetings, publish enum)                                            |
| Constraints / indexes / FKs   | ☑    | Unique section code per period; meeting unique (section, period, day); room/teacher day indexes                                                  |
| Multi-board seed fixtures     | ☑    | `db/seeds/004_sis_master_schedule_demo.sql` on `proctira-multiboard-cert` / CBSE-DEL-01                                                          |
| Domain unit/property tests    | ☑    | `clash-detection.test.ts`, `clash-helper.test.ts`, `timetable-service.test.ts` (20 tests)                                                        |
| Invariants documented         | ☑    | Same room or teacher cannot occupy two active meetings on same day+period; published sections lock meeting/section edits; capacity blocks enroll |

**State machine:** `DRAFT` → `PUBLISHED` (publish) → `DRAFT` (unpublish). `ARCHIVED` cannot publish.

---

## 2. API / services

| Check                              | Done    | Evidence                                                                      |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------- |
| Tenant middleware on all routes    | ☑       | `tenantIdOf` on all `/timetable/*` routes                                     |
| Validation + typed errors          | ☑       | TypeBox schemas + `AppError` / `TimetableClashError`                          |
| RBAC enforced                      | ☑       | `timetable-access.ts` + route requireAction                                   |
| Conflict / rule failures → 409/422 | ☑       | Room/teacher clash → 409; capacity/lock → ValidationError 400                 |
| Idempotent writes where needed     | Partial | Re-enroll of ENROLLED returns existing; publish of PUBLISHED returns existing |
| Cross-tenant deny test             | ☑       | `timetable-service.test.ts` isolation                                         |

Package: `@proctira/backend-timetable` (expanded WS2).

---

## 3. UI (redesign)

| Screen                     | Empty/loading/error | Write works                 | Board-aware | Evidence                              |
| -------------------------- | ------------------- | --------------------------- | ----------- | ------------------------------------- |
| Master schedule            | ☑                   | ☑ create + publish controls | N/A         | `institutions/[id]/schedule/page.tsx` |
| Section roster             | ☑                   | ☑ enroll/withdraw/publish   | N/A         | `schedule/[sectionId]/page.tsx`       |
| Attendance published slots | ☑ honesty empty     | Read-only list              | N/A         | `attendance/page.tsx`                 |

Institution tabs include **Schedule**.

---

## 4. Cross-module integration

| Dependency                     | Integrated | Evidence                                                   |
| ------------------------------ | ---------- | ---------------------------------------------------------- |
| Institutions / periods         | ☑          | Filters by institutionId / academicPeriodId                |
| Staff / students / enrollments | ☑          | Opaque UUID refs + section_enrollments                     |
| Attendance                     | ☑          | `GET /timetable/attendance-periods` + attendance page card |
| Exports / jobs                 | ☐          | N/A this slice                                             |

---

## 5. Observability & audit

| Check                            | Done | Evidence                                      |
| -------------------------------- | ---- | --------------------------------------------- |
| Structured logs on writes        | ☐    | Residual — gateway request logs               |
| Audit trail for schedule publish | ☑    | `TimetableService` audit on publish/unpublish |
| Async job status                 | N/A  |                                               |

---

## 6. Security & compliance

| Check                    | Done    | Evidence                                 |
| ------------------------ | ------- | ---------------------------------------- |
| Tenant isolation         | Partial | All queries filter `tenant_id`           |
| RBAC matrix documented   | ☑       | §0 Roles; live deny residual             |
| Export download auth     | N/A     |                                          |
| Issued records immutable | N/A     | Publish lock is soft (unpublish allowed) |

---

## 7. Hand-off to production-ready **test** skill

| Check                                  | Done    | Evidence                                                    |
| -------------------------------------- | ------- | ----------------------------------------------------------- |
| Test checklist / notes                 | ☑       | `docs/audits/SIS_MASTER_SCHEDULE_TEST_NOTES.md`             |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐       | Residual — ungated smoke only this pass                     |
| Desktop + tablet + mobile captures     | Partial | Artifacts under `/opt/cursor/artifacts/sis-schedule-audit/` |
| Tip CI green                           | ☐       | After push                                                  |
| Scoreboard updated honestly            | ☐       | Residual                                                    |

---

## Exit — capability 10/10

| Gate                       | Pass                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| Peer parity for this slice | Partial — product surface live; RBAC deny + gated write E2E residual |
| Live SQL + seeds           | ☑                                                                    |
| Live API writes            | ☑ unit + seed; gateway live write residual if process down           |
| UI inventory complete      | ☑                                                                    |
| Rules tests green          | ☑ 20/20 `@proctira/backend-timetable`                                |
| Board artifacts            | N/A                                                                  |
| Security evidence          | Partial                                                              |
| Test skill checklist       | Partial (ungated smoke)                                              |
| Tip CI                     | Pending push                                                         |

**Honest residual:** live RBAC publish deny (teacher cannot publish); gated Playwright write journey; structured audit log on publish; student multi-section overload API gate.
