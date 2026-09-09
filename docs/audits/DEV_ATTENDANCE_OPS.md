# Enterprise module development checklist

**Capability / module:** Attendance ops — regularisation, leave, ingest, EARLY_DEPARTURE (G-919)  
**Branch / tip:** `cursor/w9-g917-timetable-attendance-56c3`  
**Owner / agent:** Wave 9 G-919  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Correction workflow, early departure, leave→excused, device punches, CSV  
**Paired test audit:** `ops-service.test.ts`, `ingest.contract.test.ts`; e2e `51-attendance-ops-write-smoke.spec.ts` (not run)

---

## 0. Product contract

| Item                   | Content |
| ---------------------- | ------- |
| Capability statement   | See `PRODUCT_ATTENDANCE_OPS.md` |
| In scope (peer parity) | Regularisation, EARLY_DEPARTURE, leave, ingest, CSV rows |
| Explicit non-goals     | Injecting `WorkflowService` (self-contained request/approve + audit instead) |
| Roles (RBAC)           | Approver roles: registrar, attendance_officer, principal, admin. Requesters: teacher, parent, student |
| Boards impacted        | none |

**EARLY_DEPARTURE present-partial rule:** the status is not ABSENT. Attendance percentage numerator = `PRESENT + LATE + 0.5 × EARLY_DEPARTURE`. Denominator = all records including EXCUSED and EARLY_DEPARTURE. Absence percentage still uses ABSENT only.

**Regularisation workflow choice:** self-contained domain state machine (`requested` → `approved` | `rejected`) with `attendance_audit` on approve. `WorkflowService` is **not** injected — the engine at `/workflow-engine` would require a pre-seeded definition per tenant; a domain machine keeps this slice testable without that coupling.

Screen / API inventory:

| Nav / surface | Route | API | Tables | PII |
| ------------- | ----- | --- | ------ | --- |
| Marking | `/attendance` | `POST /attendance/student/bulk` | `student_attendance` | student names |
| Ops | `/attendance/ops` | regularisation + leave | `attendance_regularisation_requests`, `attendance_leave_requests` | student ids, reasons |
| Ingest | machine | `POST /attendance/ingest` | `attendance_device_keys`, `attendance_ingest_events` | student ids, punch times |
| Reports | `/attendance/reports` | `GET /attendance/percentage` | student_attendance | aggregates + optional studentRows |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/042_attendance_ops_schema.sql` |
| Constraints / indexes / FKs   | ☑    | status checks, unique (tenant, device, event) |
| Multi-board seed fixtures     | ☐    | waived — attendance statuses are board-agnostic |
| Domain unit/property tests    | ☑    | percentage property includes EARLY_DEPARTURE; ingest contract |
| Invariants documented         | ☑    | present-partial 0.5; ingest idempotent; leave weekdays only |

---

## 2. API / services

Tenant via existing attendance `tenantId` hook. Ingest authorizes with `X-Device-Api-Key` (sha256 at rest) and still accepts gateway JWT tenant when present; the key's institution must match the body.

---

## 3–7. UI / integration / security / test

Staff ops page for regularisation + leave. Marking grid includes Early departure. CSV extended with per-student rows. RLS describe blocks appended. Playwright smokes typecheck-only in this environment.
