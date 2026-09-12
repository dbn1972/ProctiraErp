# Enterprise module development — Enrollment progression UI (P0-04)

**Capability / module:** SIS enrollment / progression UI  
**Branch / tip:** `cursor/enrol-progression-ui-56c3`  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Registrar can add a student and place them into institution/grade/period without landing on a placeholder; transfer/graduate remain reachable from profile  
**Dev session:** P0-04 `enrol-progression-ui`  
**Paired test audit:** `apps/web/e2e/55-enrol-progression-smoke.spec.ts` (+ schema unit tests)

Copied from `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`.

---

## 0. Product contract

| Item                   | Content                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Capability statement   | Staff enroll an existing student into an institution/grade/period; federated `/app/students/enroll` reaches the App Router hub; profile exposes Enroll when no active enrollment. |
| In scope (peer parity) | Hub CTAs, `/students/[id]/enroll` form, `POST /enrollments` client + action, federated redirects, tip e2e |
| Explicit non-goals     | Class roster assignment UI; promotion batch jobs; TASKS file edits; api-gateway RBAC / ETL / queue packages |
| Roles (RBAC)           | Existing student/enrollment gateway authZ; no new roles                                                      |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: N/A (placement fields are board-agnostic UUIDs)                                |

Screen / API inventory:

| Nav / surface        | Route                         | API                    | Tables       | PII      |
| -------------------- | ----------------------------- | ---------------------- | ------------ | -------- |
| Enrol hub            | `/students/enroll`            | —                      | —            | —        |
| Add student          | `/students/new`               | `POST /students`       | students     | PII      |
| Enroll placement     | `/students/[id]/enroll`       | `POST /enrollments`    | enrollments  | PII ids  |
| Federated enroll     | `/app/students/enroll`        | redirect               | —            | —        |
| Profile CTA          | `/students/[id]`              | —                      | —            | —        |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                         |
| ----------------------------- | ---- | -------------------------------- |
| Versioned SQL under `db/sql/` | ☐    | N/A — reuse existing enrollments |
| Constraints / indexes / FKs   | ☐    | N/A                              |
| Multi-board seed fixtures     | ☐    | N/A                              |
| Domain unit/property tests    | ☑    | `enrollmentFormSchema` unit tests |
| Invariants documented         | ☑    | Active enrollment blocks re-enroll UI; transfer CTA when active |

---

## 2. API / services

| Check                              | Done | Evidence                                              |
| ---------------------------------- | ---- | ----------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | Existing enrollment-service + gatewayFetch            |
| Validation + typed errors          | ☑    | zod `enrollmentFormSchema` + Typebox CreateEnrollment |
| RBAC enforced                      | ☑    | Existing gateway (out of scope to rewire)             |
| Conflict / rule failures → 409/422 | ☑    | Service errors mapped via GatewayError                |
| Idempotent writes where needed     | ☐    | N/A for create                                        |
| Cross-tenant deny test             | ☐    | Residual — covered elsewhere on enrollments API       |

---

## 3. UI (redesign)

| Screen                    | Empty/loading/error                         | Write works        | Board-aware | Evidence                          |
| ------------------------- | ------------------------------------------- | ------------------ | ----------- | --------------------------------- |
| `/students/enroll` hub    | ☑ clear CTAs                                | links to new/list  | N/A         | hub page                          |
| `/students/[id]/enroll`   | ☑ no institutions / already enrolled        | EnrollForm submit  | N/A         | enroll page + form                |
| Federated placeholder     | removed → redirect                          | N/A                | N/A         | `StudentEnrollment.tsx`           |
| Profile                   | Enroll CTA when no active enrollment        | link               | N/A         | `[id]/page.tsx`                   |

---

## 4. Cross-module integration

| Dependency              | Integrated | Evidence                                      |
| ----------------------- | ---------- | --------------------------------------------- |
| Institutions grades/periods | ☑      | `getInstitutionGradesAction` / periods        |
| Transfer workflow       | ☑          | Already-active enroll → transfer CTA          |
| Student create          | ☑          | Hub → `/students/new`                         |

---

## 5. Non-goals / residuals

- Full promotion / year-rollover UI batch
- Federated directory rewrite onto App Router list
- Live IdP e2e for enroll (uses fake session + optional `E2E_BACKEND_READY`)

---

## Exit (build bar for this slice)

| Claim                         | Status | Notes                                      |
| ----------------------------- | ------ | ------------------------------------------ |
| Dead-end placeholder removed  | ☑      | Federated redirect + App Router hub/form   |
| Happy-path + empty/error      | ☑      | Form empty institutions + already-active   |
| Tip e2e fragment              | ☑      | `55-enrol-progression-smoke.spec.ts`       |
| Product 10/10                 | ☐      | Requires full test skill evidence pack     |
