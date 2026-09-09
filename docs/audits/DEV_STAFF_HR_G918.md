# Enterprise module development checklist

**Capability / module:** Staff / HR — contracts, qualifications, attendance, CSV import, payroll export (G-918)  
**Branch / tip:** `cursor/w9-g918-hr-comms-56c3`  
**Owner / agent:** Wave 9 gap-close agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Contract + qualification registry, daily staff attendance, CSV hire load, monthly payroll extract (not a statutory payroll engine)  
**Dev session:** Wave 9 G-918  
**Paired test audit:** e2e `apps/web/e2e/52-staff-hr-write-smoke.spec.ts` (authored; not run)

---

## 0. Product contract

| Item                   | Content                      |
| ---------------------- | ---------------------------- |
| Capability statement   | See `PRODUCT_STAFF_HR_G918.md` |
| In scope (peer parity) | Contracts, qualifications, daily attendance, CSV import, payroll CSV |
| Explicit non-goals     | Live payroll tax, xlsx parse, biometric clocks, auto-renewal workflow |
| Roles (RBAC)           | Existing `staff` resource via `/staff` prefix |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: N/A (HR, not board exams) |

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| ------------- | ----- | --- | ------ | --- |
| Contracts | `/staff/contracts` | `/staff/contracts` | `staff_contracts` | salary band, dates |
| Attendance | `/staff/attendance` | `/staff/attendance` | `staff_attendance` | presence |
| Import | `/staff/import` | `/staff/import/*` | staff + contracts | identity, phone, email |
| Payroll | `/staff/payroll` | `/staff/payroll/export` | computed | salary band |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/043_staff_hr_schema.sql` |
| Constraints / indexes / FKs   | ☑    | unique staff+date; contract dates check |
| Multi-board seed fixtures     | ☐    | N/A this slice |
| Domain unit/property tests    | ☑    | `hr-service.test.ts`, `staff-csv.test.ts` |
| Invariants documented         | ☑    | one attendance row per staff/day; payableDays = present + 0.5×half-day |

---

## 2. API / services

| Check                              | Done | Evidence |
| ---------------------------------- | ---- | -------- |
| Tenant middleware on all routes    | ☑    | gateway tenant + store filter |
| Validation + typed errors          | ☑    | Typebox + AppError |
| RBAC enforced                      | ☑    | existing `/staff` → `staff` |
| Conflict / rule failures → 409/422 | ☑    | duplicate attendance 409; bad dates 422 |
| Idempotent writes where needed     | ☑    | attendance upsert same day/status |
| Cross-tenant deny test             | ☑    | hr-service tenant isolate |

---

## 3–7. UI / integration / observability / security / test handoff

UI pages added under `apps/web/src/app/(dashboard)/staff/{contracts,attendance,import,payroll}`. Structured logs: `console.info` JSON on import commit and payroll export (no new logger wiring). Tenant isolation: RLS SQL unit + service tests. Playwright live chain **not executed** (resource discipline).

**Verdict:** Ready w/ waivers (no live E2E, no xlsx, payroll is an extract not a payroll engine). Not a 10/10 product slice.
