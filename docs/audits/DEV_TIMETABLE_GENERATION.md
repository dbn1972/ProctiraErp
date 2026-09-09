# Enterprise module development checklist

**Capability / module:** Timetable generation + substitution desk (G-917)  
**Branch / tip:** `cursor/w9-g917-timetable-attendance-56c3`  
**Owner / agent:** Wave 9 G-917  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Clash-free greedy+repair auto-scheduler; cover desk; parent/student read-only grid  
**Dev session:** n/a  
**Paired test audit:** vitest `generation.property.test.ts`; e2e `50-timetable-generation-write-smoke.spec.ts` (not run)

---

## 0. Product contract

| Item                   | Content                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| Capability statement   | See `PRODUCT_TIMETABLE_GENERATION.md`                                            |
| In scope (peer parity) | Generator, jobs, absence→substitute, parent/student grid                         |
| Explicit non-goals     | OR-Tools, overnight workers, student swap requests                               |
| Roles (RBAC)           | Existing `schedule.write` / `schedule.publish`; generation uses `schedule.write` |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: none (board-agnostic grid)                          |

Screen / API inventory:

| Nav / surface  | Route                                        | API                               | Tables                       | PII                |
| -------------- | -------------------------------------------- | --------------------------------- | ---------------------------- | ------------------ |
| Generate       | `/institutions/[id]/timetable/generate`      | `POST /timetable/generation-jobs` | `timetable_generation_jobs`  | staff/section ids  |
| Substitutions  | `/institutions/[id]/timetable/substitutions` | teacher-absences + substitutions  | `timetable_teacher_absences` | staff ids          |
| Parent/student | `/parent/timetable`, `/student/timetable`    | parent-portal timetable           | `section_meetings`           | section/room names |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                                                                                                                                                                                 |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/041_timetable_generation_schema.sql`                                                                                                                                                                             |
| Constraints / indexes / FKs   | ☑    | status check, unique absence per staff+date                                                                                                                                                                              |
| Multi-board seed fixtures     | ☐    | waived — generator is board-agnostic; uses in-memory fixtures in property tests                                                                                                                                          |
| Domain unit/property tests    | ☑    | `generation.property.test.ts` ≥50 runs                                                                                                                                                                                   |
| Invariants documented         | ☑    | hard: teacher/room/section unique per (day,period); availability; room capacity. Soft: spread subject across days; teacher max periods/day. Produced assignments always 0 hard clashes (unassigned leftover is allowed). |

---

## 2. API / services

| Check                              | Done | Evidence                                          |
| ---------------------------------- | ---- | ------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | existing timetable `tenantIdOf`                   |
| Validation + typed errors          | ☑    | TypeBox schemas                                   |
| RBAC enforced                      | ☑    | `schedule.write` on generate / absences / persist |
| Conflict / rule failures → 409/422 | ☑    | substitute clash still 409                        |
| Idempotent writes where needed     | ☑    | job id returned; re-GET is read                   |
| Cross-tenant deny test             | ☑    | e2e gated live chain (not executed)               |

---

## 3. UI (redesign)

| Screen              | Empty/loading/error     | Write works     | Board-aware | Evidence           |
| ------------------- | ----------------------- | --------------- | ----------- | ------------------ |
| Generate            | ☑ empty demands message | ☑ server action | n/a         | generate page      |
| Substitutions       | ☑ no meetings           | ☑               | n/a         | substitutions page |
| Parent/student grid | ☑ empty published       | read-only       | n/a         | weekly grid        |

---

## 4. Cross-module integration

| Dependency                       | Integrated | Evidence                                                        |
| -------------------------------- | ---------- | --------------------------------------------------------------- |
| Institutions / periods           | ☑          | job carries institutionId + academicPeriodId                    |
| Staff / students / enrollments   | ☑          | demands + enrollmentCount vs room.capacity                      |
| Attendance / assessments / exams | ☑          | published meetings already feed `/timetable/attendance-periods` |
| Exports / jobs                   | ☑          | `timetable_generation_jobs` status machine                      |

---

## 5. Observability & audit

In-process job timestamps (`started_at` / `finished_at`). Existing timetable audit log records meeting creates when persistMeetings is true.

---

## 6. Security

FORCE RLS on new tables. Generation does not leak other tenants' jobs (store filters `tenantId`).

---

## 7. Test hand-off

Property test + ungated Playwright heading smoke. Live write chain gated on `E2E_BACKEND_READY`. Tip CI not claimed.
