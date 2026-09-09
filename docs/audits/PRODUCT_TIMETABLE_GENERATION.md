# Enterprise product / IA checklist

**Module / slice:** Timetable auto-generation, substitution desk, parent/student grid (G-917)  
**Branch / tip:** `cursor/w9-g917-timetable-attendance-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Wave 9 G-917

Copy → `docs/audits/PRODUCT_<MODULE>.md`. Complete **before** build.

---

## 1. Capability statement

A registrar or timetable officer can run a constraint-based generator (greedy assignment plus a repair loop) over class sections × subjects × teachers × rooms × period slots, persist the run as a job (`queued` / `running` / `done` / `failed` with stats and clash count), and optionally write the clash-free meetings into the existing section-meeting grid. When a teacher is marked absent for a date, staff see the affected periods and assign a substitute with the same teacher/room clash check already used for substitutions. Parents and students see a read-only weekly grid of published meetings for the linked child / self.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| Registrar / timetable officer | Produce a feasible weekly grid without teacher/room/section double-books | Job finishes `done` with `clash_count = 0`; meetings appear on the institution timetable |
| Cover supervisor | Cover an absent teacher for one date | Affected periods listed; substitute assignment rejected on clash (409) |
| Parent / student | See this week's published classes | Weekly grid of section, period, room — no edit controls |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| Greedy + repair generator; hard + soft constraints | CP-SAT / OR-Tools solver; overnight batch workers |
| Persisted generation jobs (sync in-process) | Distributed queue workers (not required while a queue abstraction is non-trivial) |
| Teacher absence → affected periods → substitute | Multi-week rolling absences, payroll integration |
| Parent/student read-only weekly grid (existing portal routes) | Student self-service swap requests |
| Property test ≥50 iterations, 0 hard clashes on produced assignments | Live Postgres E2E of generation (env-gated smoke only) |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| PowerSchool / IC auto-scheduler | Greedy + repair with hard-clash invariant; not a full commercial solver |
| Cover / substitution desk | Absence date → affected slots → clash-checked substitute |
| Parent portal schedule | Read-only weekly grid of published meetings |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell (staff / parent / public) |
| --------- | ----- | --- | --------------- | ------------------------------- |
| Timetable | `/institutions/[id]/timetable` | `GET /timetable/meetings` | `section_meetings` | Staff |
| Generate | `/institutions/[id]/timetable/generate` | `POST/GET /timetable/generation-jobs` | `timetable_generation_jobs` | Staff |
| Substitutions | `/institutions/[id]/timetable/substitutions` | `POST /timetable/teacher-absences`, `GET …/affected`, `POST /timetable/substitutions` | `timetable_teacher_absences`, `substitutions` | Staff |
| Parent timetable | `/parent/timetable` | `GET /parent-portal/children/:id/timetable` | `section_enrollments` + `section_meetings` | Parent |
| Student timetable | `/student/timetable` | `GET /parent-portal/me/timetable` | same | Student |

## 6. Roles & tenancy (high level)

| Role | Can | Cannot |
| ---- | --- | ------ |
| registrar, scheduler, timetable_officer, admin, principal | Run generator, persist meetings, mark absences, assign substitutes | Cross-tenant jobs |
| teacher | Read own meetings (existing) | Run generator / assign substitutes |
| parent / student | Read published grid for linked child / self | Write meetings or jobs |

Tenant boundary notes: every new table carries `tenant_id` with FORCE RLS on `app.tenant_id` (same contract as 036).

## 7. Success metrics / DoD

- [x] Generator never emits a hard clash (teacher / room / section double-book, availability, room capacity)
- [x] Job row records status + clash count + assignment stats
- [x] Substitution path lists affected periods for an absent teacher+date
- [x] Parent/student weekly grid renders published slots
- [x] Property test ≥50 randomised iterations

## 8. Handoff

| Next skill | Audit path |
| ---------- | ---------- |
| Build | `docs/audits/DEV_TIMETABLE_GENERATION.md` |
| UX | deferred (no designer capture this slice) |
| Security | RLS describe blocks in `raw-sql-rls.test.ts` |
| Test | vitest property + ungated Playwright smoke (not executed here) |
| Release | not claimed |
