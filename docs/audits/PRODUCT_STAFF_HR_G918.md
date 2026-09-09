# Enterprise product / IA checklist

**Module / slice:** G-918 Staff / HR (contracts, qualifications, attendance, bulk import, payroll CSV)  
**Branch / tip:** `cursor/w9-g918-hr-comms-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Wave 9 gap-close agent

Copy → `docs/audits/PRODUCT_<MODULE>.md`. Complete **before** build.

---

## 1. Capability statement

HR officers and school administrators can record employment contracts (with renewal alerts) and qualifications, mark daily staff attendance (present / absent / leave / half-day) with a monthly summary, bulk-import staff from CSV with a dry-run error report then commit, and export a monthly payroll CSV (salary band, days present, leave days, deductions placeholder, payable days). Builds on the existing staff directory, assignments, appraisals, training, and HR leave v1 — it does not replace them.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| HR officer | Keep contracts and qualifications current; know who is due for renewal | Contract list with `renewalAlert`; verified qualifications on the staff record |
| Principal / admin | Mark who was in school today | Daily attendance grid saved; monthly counts match marks |
| Payroll clerk | Produce a month file for the bursar | CSV with staff id, name, band, present, leave, deductions=0, payable days |
| Data clerk | Onboard a batch of new hires | CSV dry-run lists row errors; commit creates only valid rows |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| `staff_contracts`, `staff_qualifications`, `staff_attendance` (raw SQL + RLS) | Live statutory payroll / tax / PF / ESI engines |
| Daily mark + monthly summary UI at `/staff/attendance` | Biometric / device clock-in |
| CSV bulk import (dry-run then commit). `.xlsx` is **not** parsed (OOXML zip; no xlsx library) | Excel/xlsx writer or sheet parser |
| Payroll **CSV export** (computed; deductions placeholder 0) | Bank transfer / payslip PDF |
| Renewal alert when `end_date` is within 60 days and status is `active` | Automatic contract renewal workflow |
| Existing leave v1 remains the leave **request** path | Replacing leave balances / approval |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| PowerSchool / Infinite Campus staff contracts | Type, dates, salary band, status + renewal flag |
| Qualifications registry | Degree, institution, year, verified, document ref |
| Daily staff attendance | Four statuses + monthly rollup |
| Bulk staff load | CSV dry-run + commit |
| Payroll extract | Monthly CSV, not a full payroll product |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell (staff / parent / public) |
| --------- | ----- | --- | --------------- | ------------------------------- |
| Staff | `/staff` | existing `/staff` | `staff` (Prisma) | Staff |
| Contracts | `/staff/contracts` | `/staff/contracts` | `staff_contracts` | Staff |
| Attendance | `/staff/attendance` | `/staff/attendance`, `/staff/attendance/summary` | `staff_attendance` | Staff |
| Import | `/staff/import` | `/staff/import/dry-run`, `/staff/import/commit` | staff create + optional contract | Staff |
| Payroll | `/staff/payroll` | `/staff/payroll/export` | computed from contracts + attendance | Staff |

## 6. Roles & tenancy (high level)

| Role | Can | Cannot |
| ---- | --- | ------ |
| SUPER_ADMIN / admin (existing `staff` resource) | CRUD contracts, qualifications, attendance, import, export | Cross-tenant read/write |
| Typical teacher (`staff` role) | Read own directory surfaces already granted | Bulk import / payroll export (gateway mutating RBAC on `/staff`) |
| Parent / public | — | All HR surfaces |

Tenant boundary notes: every new table has `tenant_id` + FORCE RLS on `app.tenant_id`. Services filter by request `tenantId`. Import uniqueness is per identity number (existing staff rule).

## 7. Success metrics / DoD

- [x] SQL 043 with FORCE RLS on every new table
- [x] API: contract → attendance → import dry-run/commit → payroll CSV
- [x] Pages under `/staff/{contracts,attendance,import,payroll}`
- [x] E2E spec `52-staff-hr-write-smoke.spec.ts` (ungated + live chain; not executed here)
- [ ] Live `E2E_BACKEND_READY=1` against seeded Postgres (deferred — resource discipline)

## 8. Handoff

| Next skill | Audit path        |
| ---------- | ----------------- |
| Build      | `docs/audits/DEV_STAFF_HR_G918.md` |
| UX         | not claimed this slice (no capture pack) |
| Security   | RLS unit + in-memory tenant isolate tests |
| Test       | e2e spec authored; Playwright not run |
| Release    | not claimed |
