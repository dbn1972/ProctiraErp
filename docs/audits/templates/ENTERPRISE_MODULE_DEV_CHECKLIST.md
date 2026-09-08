# Enterprise module development checklist

**Capability / module:** <!-- e.g. Master schedule · Gradebook · Board exports -->  
**Branch / tip:**  
**Owner / agent:**  
**Date (UTC):**  
**Peer parity target:** <!-- what “10/10 like others” means for this slice -->  
**Dev session:** `.cursor/hooks/state/enterprise-dev-session.json`  
**Paired test audit:** `docs/audits/<MODULE>_….md`

Copy to `docs/audits/DEV_<MODULE>_<CAPABILITY>.md`. Complete every section before claiming product 10/10.

---

## 0. Product contract

| Item                   | Content                      |
| ---------------------- | ---------------------------- |
| Capability statement   |                              |
| In scope (peer parity) |                              |
| Explicit non-goals     |                              |
| Roles (RBAC)           |                              |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: |

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| ------------- | ----- | --- | ------ | --- |
|               |       |     |        |     |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☐    |          |
| Constraints / indexes / FKs   | ☐    |          |
| Multi-board seed fixtures     | ☐    |          |
| Domain unit/property tests    | ☐    |          |
| Invariants documented         | ☐    |          |

---

## 2. API / services

| Check                              | Done | Evidence |
| ---------------------------------- | ---- | -------- |
| Tenant middleware on all routes    | ☐    |          |
| Validation + typed errors          | ☐    |          |
| RBAC enforced                      | ☐    |          |
| Conflict / rule failures → 409/422 | ☐    |          |
| Idempotent writes where needed     | ☐    |          |
| Cross-tenant deny test             | ☐    |          |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| ------ | ------------------- | ----------- | ----------- | -------- |
|        | ☐                   | ☐           | ☐           |          |

---

## 4. Cross-module integration

| Dependency                                       | Integrated | Evidence |
| ------------------------------------------------ | ---------- | -------- |
| Institutions / periods                           | ☐          |          |
| Staff / students / enrollments                   | ☐          |          |
| Attendance / assessments / exams (as applicable) | ☐          |          |
| Exports / jobs (as applicable)                   | ☐          |          |

---

## 5. Observability & audit

| Check                               | Done | Evidence |
| ----------------------------------- | ---- | -------- |
| Structured logs on writes           | ☐    |          |
| Audit trail for sensitive mutations | ☐    |          |
| Async job status (if exports)       | ☐    |          |

---

## 6. Security & compliance

| Check                                | Done | Evidence |
| ------------------------------------ | ---- | -------- |
| Tenant isolation                     | ☐    |          |
| RBAC matrix documented               | ☐    |          |
| Export download auth                 | ☐    |          |
| Issued records immutable / versioned | ☐    |          |

---

## 7. Hand-off to production-ready **test** skill

| Check                                  | Done | Evidence |
| -------------------------------------- | ---- | -------- |
| Test checklist copied & filled         | ☐    |          |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐    |          |
| Desktop + tablet + mobile captures     | ☐    |          |
| Tip CI green                           | ☐    |          |
| Scoreboard updated honestly            | ☐    |          |

---

## Exit — capability 10/10

| Gate                            | Pass |
| ------------------------------- | ---- |
| Peer parity for this slice      | ☐    |
| Live SQL + seeds                | ☐    |
| Live API writes                 | ☐    |
| UI inventory complete           | ☐    |
| Rules tests green               | ☐    |
| Board artifacts (if applicable) | ☐    |
| Security evidence               | ☐    |
| Test skill complete             | ☐    |
| CI green                        | ☐    |

**Residuals / waivers (dated):**

| Residual | Owner | Date |
| -------- | ----- | ---- |
|          |       |      |

**Verdict:** ☐ Not ready · ☐ Ready w/ waivers · ☐ **10/10 product slice**
