# DEV — SIS Timetable / bell / substitutions (WS1)

**Capability / module:** Timetable · Bell schedules · Substitutions  
**Branch / tip:** `cursor/sis-timetable-harden-56c3`  
**Owner / agent:** cloud SERVER agent  
**Date (UTC):** 2026-09-07  
**Harden audits:** `PRODUCT_SIS_TIMETABLE_HARDEN.md` · `SEC_SIS_TIMETABLE.md`  
**Peer parity target:** Registrar can define bell schedules + periods, view/edit institution period grid, assign substitute teachers with teacher double-book → 409 (PowerSchool / IC-class timetable slice)  
**Dev session:** WS1 server slice  
**Paired test audit:** `docs/audits/SIS_TIMETABLE_TEST_NOTES.md`

---

## 0. Product contract

| Item | Content |
| --- | --- |
| Capability statement | A registrar can CRUD **bell schedules** and **periods** for an academic period, maintain an **institution timetable grid** of section meetings, and **list/create substitutions** (absent teacher → substitute). Simple teacher double-book on meetings or substitute overlap returns **HTTP 409**. |
| In scope (peer parity) | Bell schedule CRUD; period start/end; institution grid read + basic create; substitutions list/create; clash helper + 409; raw SQL tables; redesign UI empty/error honesty |
| Explicit non-goals | Full master schedule publish workflow (WS2); room booking UI; iCal/external calendar federation live sync; Prisma models; mobile native |
| Roles (RBAC) | `schedule.write` / `schedule.publish` via `timetable-access.ts` (registrar/scheduler/timetable_officer + admins); teacher denied writes — live IdP E2E residual |
| Boards impacted | CBSE ☐ ICSE ☐ State ☐ Other: board-agnostic timetable primitives |

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| --- | --- | --- | --- | --- |
| Bell schedules | `/academic-periods/[id]/bell-schedules` | `/api/v1/timetable/bell-schedules`, `.../periods` | `bell_schedules`, `bell_periods` | No |
| Institution timetable | `/institutions/[id]/timetable` | `/api/v1/timetable/meetings` | `section_meetings` | Staff IDs |
| Substitutions | `/staff/substitutions` | `/api/v1/timetable/substitutions` | `substitutions` | Staff IDs |

---

## 1. Domain model (SQL-first)

| Check | Done | Evidence |
| --- | --- | --- |
| Versioned SQL under `db/sql/` | ☑ | `db/sql/003_sis_timetable_schedule_schema.sql` (schema agent; `bell_periods` + `periods` view) |
| Constraints / indexes / FKs | ☑ | periods → bell_schedules; meetings → periods; substitutions → meetings; staff-day-period index |
| Multi-board seed fixtures | ☐ | Residual — board-agnostic; seed in WS0/WS5 |
| Domain unit/property tests | ☑ | `packages/backend/timetable/src/clash-helper.test.ts`, `timetable-service.test.ts` |
| Invariants documented | ☑ | Same staff cannot occupy two active meetings on same day+period; substitute cannot overlap meeting/sub on same date+period |

**Entities:** `bell_schedules`, `periods`, `section_meetings`, `substitutions`, `rooms` (minimal).  
**Persistence:** raw `pg` (`PgTimetableRepository`) when `DATABASE_URL` set; in-memory otherwise. **No Prisma.**

---

## 2. API / services

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant middleware on all routes | ☑ | `tenantIdOf` requires JWT/`x-tenant-id`; gateway `/api/v1` scope |
| Validation + typed errors | ☑ | TypeBox schemas in `schemas.ts` |
| RBAC enforced | ☑ | Route `requireAction` + unit access tests (master-schedule + timetable harden) |
| Conflict / rule failures → 409/422 | ☑ | `TimetableClashError` → 409; schema missing → 503 |
| Idempotent writes where needed | ☐ | N/A for create-new UUID paths |
| Cross-tenant deny test | ☑ | Unit: bells/periods/meetings/subs isolated; live IdP residual |

Package: `@proctira/backend-timetable` registered in `apps/api-gateway/src/domain-plugins.ts`.

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| --- | --- | --- | --- | --- |
| Bell schedules | ☑ honesty empty + API error card | ☑ forms → server actions | N/A | `academic-periods/[id]/bell-schedules/page.tsx` |
| Institution timetable | ☑ empty grid copy | ☑ add meeting form | N/A | `institutions/[id]/timetable/page.tsx` |
| Substitutions | ☑ empty list | ☑ assign form | N/A | `staff/substitutions/page.tsx` |

Institution tabs include **Timetable**. Academic periods page links to bell schedules.

---

## 4. Cross-module integration

| Dependency | Integrated | Evidence |
| --- | --- | --- |
| Institutions / periods | ☑ | Filters by institutionId / academicPeriodId |
| Staff / students / enrollments | Partial | Staff IDs as opaque refs; section IDs opaque until WS2 |
| Attendance / assessments / exams | ☑ | `GET /timetable/attendance-periods` + redesign `/attendance` consumes published meetings |
| Exports / jobs | ☐ | iCal / calendar federation **waived** (external) |

---

## 5. Observability & audit

| Check | Done | Evidence |
| --- | --- | --- |
| Structured logs on writes | ☐ | Residual — rely on gateway request logs |
| Audit trail for sensitive mutations | ☑ | `bell_schedule.*` · `period.*` · `meeting.*` · `substitution.create` · `section.publish` / `unpublish` |
| Async job status (if exports) | N/A | |

---

## 6. Security & compliance

| Check | Done | Evidence |
| --- | --- | --- |
| Tenant isolation | ☑ | Queries filter `tenant_id`; unit isolation; live IdP residual |
| RBAC matrix documented | ☑ | `timetable-access.ts` + SEC audit |
| Export download auth | N/A | |
| Issued records immutable / versioned | N/A | |

---

## 7. Hand-off to production-ready **test** skill

| Check | Done | Evidence |
| --- | --- | --- |
| Test checklist started | ☑ | `docs/audits/SIS_TIMETABLE_TEST_NOTES.md` |
| Ungated smoke | ☑ | `apps/web/e2e/22-timetable-inventory-smoke.spec.ts` |
| Live write E2E | ☐ | Gate on `E2E_BACKEND_READY=1` |
| Multidevice captures | See test notes | `/opt/cursor/artifacts/sis-timetable-audit/` |

---

## Residuals (honest)

1. Live IdP role-deny + cross-tenant IDOR E2E (unit covered).  
2. Multi-board seed fixtures for bell patterns.  
3. Live authenticated write E2E (create schedule → substitution → 409).  
4. Axe / dark / touch coverage for new routes.  
5. **Waived:** calendar federation (iCal).  
6. WS2 sections entity replaces opaque `section_id` strings.
