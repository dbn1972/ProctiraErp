# Development checklist — P1-SAFE discipline residual

**Capability / module:** Student discipline / behaviour (G-914) — P1-SAFE close  
**Branch / tip:** `cursor/safeguarding-discipline-56c3`  
**Owner / agent:** Cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Staff per-student behaviour log (not full safeguarding suite)  
**Paired product audit:** `docs/audits/PRODUCT_SAFE_DISCIPLINE.md`

---

## 0. Product contract

| Item                 | Content                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| Capability statement | Staff list / create / delete discipline incidents on student 360       |
| In scope             | Residual audit + optional 360 UX (remove + description) in student/web |
| Explicit non-goals   | Safeguarding case management; TASKS edits; new SQL; standalone module  |
| Roles (RBAC)         | Staff JWT tenant scope (existing student routes)                       |
| Boards impacted      | N/A (behaviour log is board-agnostic)                                  |

Screen / API inventory:

| Nav / surface | Route            | API                                             | Tables                         | PII             |
| ------------- | ---------------- | ----------------------------------------------- | ------------------------------ | --------------- |
| Discipline    | `/students/[id]` | `GET/POST …/discipline`, `DELETE …/:incidentId` | `student_discipline_incidents` | behaviour notes |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                     |
| ----------------------------- | ---- | -------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/035_students_360_schema.sql` (prior) |
| Constraints / indexes / FKs   | ☑    | severity CHECK; tenant+student index; RLS    |
| Multi-board seed fixtures     | N/A  | No board variance                            |
| Domain unit/property tests    | ☑    | `students-360.test.ts` discipline round-trip |
| Invariants documented         | ☑    | Parent visibility flag; reporter on create   |

---

## 2. API / services

| Check                              | Done | Evidence                                                   |
| ---------------------------------- | ---- | ---------------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | `packages/backend/student/src/students-360/routes.ts`      |
| Validation + typed errors          | ☑    | `CreateDisciplineSchema` / NotFound on delete              |
| RBAC enforced                      | ☑    | Existing student route auth (gateway JWT)                  |
| Conflict / rule failures → 409/422 | N/A  | No clash rules                                             |
| Idempotent writes where needed     | N/A  | Create always inserts                                      |
| Cross-tenant deny test             | ☑    | Existing 360 foreign-tenant 404 + discipline unit coverage |

---

## 3. UI (redesign)

| Screen              | Empty/loading/error | Write works  | Board-aware | Evidence                               |
| ------------------- | ------------------- | ------------ | ----------- | -------------------------------------- |
| Discipline 360 card | ☑ empty copy        | ☑ add+remove | N/A         | `student-360-panel.tsx` DisciplineCard |

---

## 4. Cross-module integration

| Dependency                    | Integrated | Evidence                      |
| ----------------------------- | ---------- | ----------------------------- |
| Students / enrollments        | ☑          | requireStudent on 360 service |
| Parent portal visibility flag | ☑          | `visibleToParent` on create   |
| Safeguarding / case mgmt      | ☐ NON-GOAL | Explicit product non-goal     |

---

## 5. Observability & audit

| Check                               | Done | Evidence                        |
| ----------------------------------- | ---- | ------------------------------- |
| Structured logs on writes           | ☐    | Prior G-914; no new logger work |
| Audit trail for sensitive mutations | ☑    | `reporter_id` + `created_at`    |

---

## 6. Security & compliance

| Check                  | Done | Evidence                                   |
| ---------------------- | ---- | ------------------------------------------ |
| Tenant isolation       | ☑    | RLS on `035` + service tenant checks       |
| RBAC matrix documented | ☑    | PRODUCT §6                                 |
| Safeguarding PHI vault | N/A  | Out of scope (use Health PHI for clinical) |

---

## 7. Hand-off / honesty

| Claim forbidden                                               | Why                                |
| ------------------------------------------------------------- | ---------------------------------- |
| Full safeguarding / DSL case-management product               | Dated NON-GOAL (PRODUCT §3)        |
| Product 10/10 behaviour suite (PBIS, detention, multi-agency) | Depth beyond G-914 residual        |
| P1-SAFE DONE in TASKS register                                | This slice does **not** edit TASKS |

**Residual (accept):** no in-place PATCH; staff correct by delete + re-add. Re-open when product funds a safeguarding epic.

---

## Slice changes (this branch)

| Path                                                                      | Change                                       |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `docs/audits/PRODUCT_SAFE_DISCIPLINE.md`                                  | IA lock + non-goals                          |
| `docs/audits/DEV_SAFE_DISCIPLINE.md`                                      | Build residual checklist                     |
| `packages/backend/student/src/students-360/students-360.test.ts`          | Discipline create/list/delete + cross-tenant |
| `apps/web/src/lib/api/students.ts`                                        | `removeStudentDiscipline`                    |
| `apps/web/src/app/(dashboard)/students/actions.ts`                        | `removeStudentDisciplineAction`              |
| `apps/web/src/app/(dashboard)/students/_components/student-360-panel.tsx` | Description line + remove control            |
