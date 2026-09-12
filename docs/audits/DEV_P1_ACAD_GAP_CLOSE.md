# DEV — P1-ACAD gap close (academic calendar · curriculum · institution structure)

**Capability / module:** Academics — calendar, curriculum delivery, institution structure  
**Branch / tip:** `cursor/acad-calendar-curriculum-depth-56c3`  
**Owner / agent:** Cloud agent (P1-ACAD honesty close)  
**Date (UTC):** 2026-09-12  
**Peer parity target:** PowerSchool / Infinite Campus–class year→term calendar + holidays + rollover; syllabus units / lesson plans / coverage; multi-campus institution hierarchy  
**Task register:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P1-ACAD** (status updated by plan owners — this audit does **not** edit TASKS)  
**Prior evidence:** `docs/audits/ACADEMICS_INSTITUTIONS.md`, `docs/audits/WAVE9_GAP_CLOSURE_TEST_EVIDENCE.md`, Fable G-905 / G-923 DONE (PR #41)

---

## 0. Capability statement

Registrars and academic admins can model **academic years and terms**, attach **holidays / breaks / grading & exam windows**, **preview and execute year-end rollover** (clone sections, promote enrollments), and **export an authenticated `.ics` feed**. Teachers and admins can manage **syllabus units, lesson plans, outcomes, and coverage %** on an institution. Institution operators can maintain **campus structure** (identity, grades, classes, infrastructure hierarchy). This slice does **not** claim peer-complete LMS sequencing, board marksheet packs, or live IdP deny E2E.

---

## 1. What already ships on tip (residual-first)

| Surface                        | Route / API                                                                   | Evidence                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Academic periods list + CRUD   | `/academic-periods` · `/api/v1/academic-periods`                              | G-905 UI + e2e `38-academic-calendar-write-smoke.spec.ts`                                |
| Per-period calendar + rollover | `/academic-periods/[id]/calendar` · `…/calendar`, `…/rollover`                | `packages/backend/institution/src/academic-calendar/*`; e2e 38 gated rollover            |
| ICS export                     | `/api/academic-calendar/export[?periodId=]` · `renderAcademicCalendarIcs`     | `apps/web/src/lib/institutions/ics.ts` + `exports.test.ts`                               |
| Curriculum delivery            | `/institutions/[id]/curriculum` · `/curriculum/*`                             | `@proctira/backend-curriculum` (G-923); e2e `43-curriculum-coverage-write-smoke.spec.ts` |
| Institution structure          | `/institutions/**` (overview, grades, classes, infrastructure)                | `ACADEMICS_INSTITUTIONS.md`; schema + RLS on institution domain                          |
| SQL / RLS                      | `db/sql/030_academic_calendar_schema.sql`, `db/sql/033_curriculum_schema.sql` | Tenant isolation unit coverage in `tools/tenant-isolation-tests`                         |

**Verdict:** Core P1-ACAD product surfaces are already on tip. Closing this register item is **honesty + one thin critical-path fix**, not a greenfield build.

---

## 2. Thin critical-path improvement this slice (ICS honesty)

| Change                                                                                        | Why                                                                                      |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Stop swallowing `listCalendarEvents` failures with `.catch(() => [])` in the ICS export route | Partial `.ics` without holidays/windows is dishonest; fail with `UPSTREAM_ERROR` instead |
| Unit: periods-only VCALENDAR still `METHOD:PUBLISH` and valid                                 | `apps/web/src/lib/institutions/exports.test.ts`                                          |
| Ungated smoke: Export calendar (.ics) CTA on `/academic-periods`                              | `apps/web/e2e/38-academic-calendar-write-smoke.spec.ts`                                  |

Rollover preview→execute smoke already exists (gated) in e2e 38; no duplicate rollover work.

---

## 3. Dated NON-GOALs (2026-09-12)

| Residual                                                              | Status                      | Notes                                                                 |
| --------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| Live IdP RBAC deny E2E on calendar / curriculum mutations             | **NON-GOAL** this slice     | Tenant deny covered in unit/e2e with fake JWT; live Keycloak residual |
| Subscription URL / CalDAV sync / public unauthenticated ICS           | **NON-GOAL**                | Session-auth download only                                            |
| Auto-promotion rules engine / multi-year cohort planning UI           | **NON-GOAL**                | Rollover clone + enrollment promote only                              |
| Curriculum ↔ LMS module sequencing / QTI-SCORM                        | **NON-GOAL** (P2-LMS)       | Coverage % + lesson plans only                                        |
| Board marksheet / transcript sealed PDF                               | **NON-GOAL** (other slices) | Out of ACAD calendar/curriculum scope                                 |
| Claiming product **10/10** or tip-CI “shipped” solely from this audit | **Forbidden**               | Release-ops gate on merge commit                                      |

---

## 4. Nav → route → API → data (locked)

| Nav                    | Route                                    | API                                             | Tables / SQL                        |
| ---------------------- | ---------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| Academic periods       | `/academic-periods`                      | `GET/POST /academic-periods`                    | `academic_periods`                  |
| Period calendar        | `/academic-periods/[id]/calendar`        | `GET/POST/DELETE …/calendar`, `POST …/rollover` | `academic_calendar_events` (`030`)  |
| Export .ics            | `/api/academic-calendar/export`          | Next BFF → list periods + events                | same                                |
| Institution curriculum | `/institutions/[id]/curriculum`          | `/curriculum/units`, lesson-plans, coverage     | `033_curriculum_schema.sql`         |
| Institution structure  | `/institutions/[id]/{overview,grades,…}` | institution plugin                              | institution / infrastructure tables |

**Roles (high level):** admin / registrar write periods & calendar & rollover; teacher+admin curriculum coverage; institution.read/write for structure. Tenant scoping via gateway + RLS.

---

## 5. Honesty / DoD for this close

| Check                                                            | Done |
| ---------------------------------------------------------------- | ---- |
| Capability statement written                                     | ☑    |
| Tip inventory of shipped ACAD surfaces cited                     | ☑    |
| Dated NON-GOALs explicit                                         | ☑    |
| Thin ICS honesty fix (no silent event drop) + unit + ungated CTA | ☑    |
| TASKS plan file **not** edited by this agent                     | ☑    |
| Scope stayed in institution / curriculum / web academic-periods  | ☑    |
| Product 10/10 / production-ready / tip-CI ship claimed           | ☐ no |

Plan owners may mark **P1-ACAD** DONE in the register when this audit merges; this document does not mutate `TASKS_ENTERPRISE_P0_P1_P2_GAPS.md`.
