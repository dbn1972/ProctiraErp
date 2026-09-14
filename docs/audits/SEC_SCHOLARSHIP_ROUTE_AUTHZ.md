# Enterprise security & tenancy — Scholarships (W1-SEC-02 residual)

**Module / slice:** `@proctira/backend-scholarship` route guards  
**Branch / tip:** `cursor/aud-w1-sec-02-authz-residual-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** financial / PII (applications, disbursements, compliance)  
**Paired finding:** W1-SEC-02 (critical, partial) — one residual domain close

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `POST/PUT/DELETE /scholarships/programs*` | gateway JWT | `program.write` | financial | fail closed |
| `GET /scholarships/programs*` | gateway JWT | `scholarship.read` | financial | fail closed |
| `POST /scholarships/applications` | gateway JWT | `application.submit` | PII/financial | staff aid roles |
| `POST .../approve\|reject` | gateway JWT | `application.decide` | financial | narrower officer set |
| `POST/PUT /scholarships/disbursements*` | gateway JWT | `disbursement.manage` | financial | fail closed |
| `POST /scholarships/compliance` | gateway JWT | `compliance.record` | PII | fail closed |
| reports / lists | gateway JWT | `scholarship.read` | financial | fail closed |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Unauthenticated → sign-in / 401         | ☐    | Gateway concern; package assumes decorated `user`/`tenantId` |
| RBAC deny / hide                        | ☑    | `scholarship-route-authz.test.ts` teacher/empty → 403 |
| Cross-tenant IDOR blocked (API)         | ☑    | shared-repo foreign GET/DELETE → 404; home tenant still 200 |
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
| —   | Scholarship package routes lacked domain RBAC | `scholarship-access` + `requireScholarshipAction` on all routes |

### P1 / P2

| ID  | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P1 | Other domains still ungarded (hostel, transport, library staff writes, registration pipeline staff) | Next W1-SEC-02 residuals |
| residual | P2 | Parent/student self-scope apply not modeled | Fail closed to staff aid roles until self-scope exists |

---

## 3. Sign-off

| Claim                            | Status |
| -------------------------------- | ------ |
| P0 cleared for scholarships package | ☑ |
| P1 cleared or waived             | ☑ waived → backlog residuals |
| Safe to merge from security view | ☑ for this residual only |

**Residual risks:** W1-SEC-02 remains partial until hostel/transport/library/registration-pipeline (and peers) get matching package guards.
