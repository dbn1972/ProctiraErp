# Enterprise security & tenancy — Hostel (W1-SEC-02 residual)

**Module / slice:** `@proctira/backend-hostel` route guards  
**Branch / tip:** `cursor/aud-w1-sec-02-authz-residual-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PII (assignments, leaves, visitors, attendance) / financial (fee structures, assignment invoices)  
**Paired finding:** W1-SEC-02 (critical, partial) — one residual domain close  
**Prior residual:** Scholarships merged in `#183`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `GET/POST /hostel*` facility | gateway JWT | `hostel.read` / `facility.write` | PII/ops | fail closed |
| `POST /hostel/assignments` | gateway JWT | `assignment.manage` | PII/financial | fail closed |
| `POST /hostel/leaves*` | gateway JWT | `leave.manage` | PII | fail closed |
| `POST /hostel/visitors*` | gateway JWT | `visitor.manage` | PII | fail closed |
| mess / gate-pass / attendance writes | gateway JWT | `ops.write` | PII | fail closed |
| `/hostel/fee-structures*` | gateway JWT | `fee.manage` | financial | fail closed |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Unauthenticated → sign-in / 401         | ☐    | Gateway concern; package assumes decorated `user`/`tenantId` |
| RBAC deny / hide                        | ☑    | `hostel-route-authz.test.ts` teacher/empty → 403 |
| Cross-tenant IDOR blocked (API)         | ☑    | shared-repo foreign GET → 404; home tenant still 200 |
| Cross-tenant IDOR blocked (UI)          | ☐    | Out of scope for this residual |
| Write audit events (money/consent/PHI)  | ☐    | Not added in this residual |
| No secrets/tokens in git or client logs | ☑    | N/A for RBAC helpers |
| Tenant isolation suite cited/run        | ☐    | Package unit proofs; gate not re-run |
| Input validation / abuse basics         | ☑    | Existing TypeBox validation retained |

---

## 2. Findings

### P0

| ID  | Finding | Fix |
| --- | ------- | --- |
| —   | Hostel package routes lacked domain RBAC | `hostel-access` + `requireHostelAction` on all routes |

### P1 / P2

| ID  | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P1 | Other domains still ungarded (transport, library staff writes, registration pipeline staff) | Next W1-SEC-02 residuals |
| residual | P2 | Parent/student self-scope leave/gate-pass not modeled | Fail closed to hostel staff until self-scope exists |

---

## 3. Sign-off

| Claim                            | Status |
| -------------------------------- | ------ |
| P0 cleared for hostel package | ☑ |
| P1 cleared or waived             | ☑ waived → backlog residuals |
| Safe to merge from security view | ☑ for this residual only |

**Residual risks:** W1-SEC-02 remains partial until transport/library/registration-pipeline (and peers) get matching package guards.
