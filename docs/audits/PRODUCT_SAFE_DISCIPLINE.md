# Enterprise product / IA — P1-SAFE (discipline residual)

**Module / slice:** Student discipline / behaviour log (G-914) — P1-SAFE residual close  
**Branch / tip:** `cursor/safeguarding-discipline-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent

---

## 1. Capability statement

Staff on a student 360 profile can **list, record, and remove** behaviour / discipline incidents (type, severity, description, action taken, date, optional parent visibility) via tenant-scoped APIs on `student_discipline_incidents`. This closes **P1-SAFE** for the discipline surface already shipped as G-914.

## 2. Personas & jobs

| Persona            | Job-to-be-done                        | Success looks like                                    |
| ------------------ | ------------------------------------- | ----------------------------------------------------- |
| Registrar / admin  | Record and correct discipline history | Add / list / remove incidents on `/students/[id]`     |
| Teacher / pastoral | See recent behaviour on the 360 panel | Discipline log card with severity + parent visibility |
| Parent (linked)    | See only flagged incidents (existing) | `visibleToParent` gate — no new parent case-mgmt UI   |

## 3. Scope

| In scope                                                      | Non-goals                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Staff discipline CRUD on student 360 (list / create / delete) | **Safeguarding / child-protection case management** (referrals, DSL queue, multi-agency case files, chronologies) |
| SQL `035` + RLS + student package routes + web 360 panel      | Standalone Behaviour / PBIS module, detention scheduling, merit points                                            |
| Optional small UX polish (row detail + remove control)        | In-place PATCH edit UI (correct via delete + re-add)                                                              |
| Residual PRODUCT / DEV honesty for P1-SAFE                    | Editing `docs/plans/TASKS_*` (register updated by program owner)                                                  |

## 4. Peer parity

| Peer capability                        | Our target this slice                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| PowerSchool / IC student behaviour log | Per-student incident list with staff write + tenant RLS    |
| Dedicated safeguarding case systems    | **Out of scope** — dated NON-GOAL until a funded SAFE epic |

## 5. Surface map

| Nav label   | Route / surface             | API                                           | Tables / events                | Shell |
| ----------- | --------------------------- | --------------------------------------------- | ------------------------------ | ----- |
| Student 360 | `/students/[id]` (overview) | `GET/POST /students/:id/discipline`           | `student_discipline_incidents` | staff |
|             |                             | `DELETE /students/:id/discipline/:incidentId` | same + RLS                     | staff |

## 6. Roles & tenancy (high level)

| Role        | Can                                      | Cannot                                   |
| ----------- | ---------------------------------------- | ---------------------------------------- |
| Staff (JWT) | CRUD discipline for students in tenant   | Cross-tenant student / incident IDs      |
| Parent      | Read only when `visibleToParent` (prior) | Staff write / remove; safeguarding cases |

Tenant boundary: JWT `tenantId` + RLS on `035`; cross-tenant reads return 404 (existing 360 tests).

## 7. Success metrics / DoD

- [x] Discipline list / create / delete exist in student package (G-914)
- [x] Staff 360 panel records incidents (`e2e/44`)
- [x] PRODUCT + DEV residual audits for P1-SAFE
- [x] Optional remove control + description polish on 360 card
- [ ] Tip CI green on this branch (release gate)

## 8. Handoff

| Next skill | Audit path                                  |
| ---------- | ------------------------------------------- |
| Build      | `docs/audits/DEV_SAFE_DISCIPLINE.md`        |
| Test       | Existing `students-360` unit + `e2e/44`     |
| Release    | tip CI → PR; program owner may mark P1-SAFE |
