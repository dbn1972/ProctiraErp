# DEV — P1-HR S0/S1 (contracts / leave exist + thin offboard stub)

**Capability / module:** Staff / HR — S0 inventory + S1 lock + offboard status stub  
**Branch / tip:** `cursor/hr-contracts-leave-offboard-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_HR_CONTRACTS_LEAVE_OFFBOARD.md`  
**Package scope:** `@proctira/backend-staff` only (no new package; no web UI this slice)

---

## 0. Product contract

| Item                 | Content                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Capability           | See PRODUCT audit                                                                                |
| In scope             | Cite leave v1 + G-918 contracts; add thin offboard status stub                                   |
| Explicit non-goals   | Recruitment ATS (**PRD-017**); statutory payroll → **P1-PAY** (**PRD-018**); full offboard HCM |
| Roles                | Existing `staff.*` / `staff.hr.write` via `staff-access.ts`                                      |

---

## 1. Inventory (already on tip — S0)

| Capability        | Evidence paths                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Leave CRUD/decide | `leave-*.ts`, `db/sql/013_hr_leave_schema.sql`, `018_hr_leave_balances_schema.sql`, PRODUCT_HR_LEAVE_V1 |
| Contracts + HR ops | `hr-*.ts`, `db/sql/043_staff_hr_schema.sql`, PRODUCT_STAFF_HR_G918 / DEV_STAFF_HR_G918                 |
| Assignments       | `assignment-*.ts` (workload allocation ≤100%)                                                           |

No schema rewrite this slice — leave/contracts **exist**.

---

## 2. Thin offboard status stub (this slice)

| Check                    | Done | Evidence                                                              |
| ------------------------ | ---- | --------------------------------------------------------------------- |
| POST `/staff/:id/offboard` | ☑  | Sets `INACTIVE`, writes `customData.__offboard` metadata              |
| GET `/staff/:id/offboard`  | ☑  | Returns status stub (or `active` if never offboarded)                 |
| Tenant isolate           | ☑    | Uses staff repository `tenantId`; cross-tenant → 404                  |
| RBAC                     | ☑    | Mutating path uses `staff.update` via `staffWritePreHandler`          |
| Unit tests               | ☑    | `offboard-service.test.ts`, route coverage in `offboard-routes.test.ts` |
| Idempotent / conflict    | ☑    | Second offboard → 409 CONFLICT                                        |

**Honesty:** Stub is **status + metadata only**. Does not revoke IdP accounts, terminate contracts automatically, run exit checklist, or post final pay.

---

## 3. Dated NON-GOALs / handoffs

| Item                | Treatment                                           | Board   |
| ------------------- | --------------------------------------------------- | ------- |
| Recruitment ATS     | NON-GOAL until funded recruiting epic               | PRD-017 |
| Statutory payroll   | Deferred to **P1-PAY** (`payroll-statutory-gl`)     | PRD-018 |
| Full offboard HCM   | Follow-up after stub if product funds checklist epic | —       |

---

## 4. Verdict

**P1-HR S0/S1 closed** for leave/contracts inventory + dated ATS/payroll honesty + optional offboard stub.  
**Not claimed:** ATS, statutory payroll, full offboarding product, tip CI / UX captures (docs+staff package only).
