# Enterprise product / IA checklist — P1-HR S0/S1

**Module / slice:** P1-HR — staff contracts, leave, thin offboard status  
**Branch / tip:** `cursor/hr-contracts-leave-offboard-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (P1-HR S0/S1 close)  
**Task register:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` (**do not edit TASKS in this slice**)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`.

---

## 1. Capability statement

HR officers and school admins can manage **employment contracts** (renewal alert) and **staff leave requests** (create → approve/reject with balance deduct) on the existing staff package surfaces. This S0/S1 close **inventory-locks** those capabilities as already shipped, adds an optional **thin offboard status stub** (mark staff INACTIVE with reason/effective date), and **dates** recruitment ATS plus statutory payroll as out of scope for P1-HR (payroll → **P1-PAY**). Staff shell only — no parent/public HR surfaces.

## 2. Personas & jobs

| Persona           | Job-to-be-done                                      | Success looks like                                                          |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| HR officer        | Keep contracts current; process leave               | `/staff/contracts` + `/staff/leaves` work; renewal alert when due           |
| Principal / admin | Approve leave; mark someone as left                 | Leave decide API; POST `/staff/:id/offboard` → status INACTIVE + stub meta  |
| Payroll clerk     | Produce a month file (extract only)                 | Existing G-918 CSV export — **not** statutory payroll (→ P1-PAY)            |
| Recruiter (peer)  | Run ATS pipeline                                    | **NON-GOAL (dated)** — not in this product until funded                     |

## 3. Scope

| In scope (S0/S1)                                                                                          | Non-goals (dated 2026-09-12)                                                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Existing leave v1 (`013`/`018`, `/staff/leaves`, approve/reject + balances)                               | **Recruitment ATS** (requisitions, applicants, interviews, offers) — **NON-GOAL**            |
| Existing contracts / quals / attendance / import / payroll **CSV extract** (G-918, `043`)                 | **Statutory payroll** (tax/PF/ESI/payslips/bank file/GL post) — deferred to **P1-PAY**       |
| Thin offboard **status stub**: POST/GET `/staff/:id/offboard` → INACTIVE + reason/effectiveDate metadata  | Full offboard checklist (IT revoke, asset return, final settlement, e-sign exit letter)      |
| Staff package + staff shell only                                                                          | Workload planner / FTE optimizer beyond existing assignments                                 |
|                                                                                                           | Parent / public HR surfaces                                                                  |

### Decision log (dated)

| Item                         | Decision                                                                                                                                                          | Date       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Recruitment ATS              | **Dated NON-GOAL** until a funded recruiting epic. Do not claim Workday/Greenhouse-class ATS. Waiver board **PRD-017**.                                         | 2026-09-12 |
| Statutory payroll            | **Out of P1-HR** — tracked as **P1-PAY** (`payroll-statutory-gl`). Existing `/staff/payroll` remains a **CSV extract** only (G-918 honesty). Waiver **PRD-018**. | 2026-09-12 |
| Leave + contracts            | **Already shipped** — S0 inventory + S1 product lock cite existing PRODUCT/DEV/SEC audits; no rewrite this slice.                                               | 2026-09-12 |
| Offboard                     | Optional **thin status stub** only (staff package). Not a full HCM offboarding product.                                                                         | 2026-09-12 |

## 4. Peer parity

| Peer capability                         | Our target this slice                                      |
| --------------------------------------- | ---------------------------------------------------------- |
| PowerSchool / IC staff contracts        | Already: type, dates, band, status, renewal alert          |
| Leave request + approve                 | Already: leave v1 + balances                               |
| Offboard / terminate employment         | Thin status stub only (INACTIVE + metadata)                |
| ATS recruiting                          | Explicit NON-GOAL                                          |
| Workday/Banner statutory payroll        | Explicit → **P1-PAY** (not claimed here)                   |

## 5. Surface map

| Nav label  | Route               | API                         | Tables / events                         | Shell |
| ---------- | ------------------- | --------------------------- | --------------------------------------- | ----- |
| Contracts  | `/staff/contracts`  | `/staff/contracts`          | `staff_contracts`                       | Staff |
| Leaves     | `/staff/leaves`     | `/staff/leaves`             | `staff_leave_requests`, balances        | Staff |
| Payroll    | `/staff/payroll`    | `/staff/payroll/export`     | computed extract (not statutory)        | Staff |
| Offboard   | *(API-only stub)*   | `/staff/:id/offboard`       | staff status + `customData.__offboard`  | Staff |

## 6. Roles & tenancy (high level)

| Role                         | Can                                              | Cannot                         |
| ---------------------------- | ------------------------------------------------ | ------------------------------ |
| HR officer / registrar / admin | Contracts, leave decide, offboard stub, import | Cross-tenant                   |
| Teacher                      | Read surfaces already granted                    | Offboard / import / payroll    |
| Parent / public              | —                                                | All HR                         |

Tenant boundary: existing staff/leave/HR RLS + service `tenantId` filters. Offboard stub uses the same staff repository path.

## 7. Success metrics / DoD (S0/S1)

- [x] S0 inventory: leave + contracts documented as present (this file + prior PRODUCT_HR_LEAVE_V1 / PRODUCT_STAFF_HR_G918)
- [x] Dated NON-GOAL: recruitment ATS (PRD-017) + statutory payroll → P1-PAY (PRD-018)
- [x] Thin offboard status stub in `@proctira/backend-staff` with unit tests
- [x] No TASKS file edits (parent reconciles P1-HR status after merge)
- [ ] Full HCM offboard / ATS / statutory payroll — **not claimed**

## 8. Handoff

| Next skill | Audit path                                      |
| ---------- | ----------------------------------------------- |
| Build      | `docs/audits/DEV_HR_CONTRACTS_LEAVE_OFFBOARD.md` |
| Security   | Existing `SEC_HR_LEAVE.md`; stub reuses staff RBAC |
| Test       | Staff package vitest (offboard + prior leave/HR) |
| Release    | Parent marks P1-HR S0/S1 after tip CI on merge  |
