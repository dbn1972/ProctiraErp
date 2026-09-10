# Enterprise module development checklist

**Capability / module:** Reports / BI / Dashboards (G-909)  
**Branch / tip:** `cursor/w9-g909-reports-56c3`  
**Owner / agent:** Cloud agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Run-now artifacts with content hash, scheduled runs, four role dashboards  
**Dev session:** Wave 9 gap G-909  
**Paired test audit:** not opened (test skill not claimed)

---

## 0. Product contract

| Item                   | Content                                                      |
| ---------------------- | ------------------------------------------------------------ |
| Capability statement   | See `PRODUCT_REPORTS_BI.md`                                  |
| In scope (peer parity) | Real CSV/XLSX/PDF, schedules, role dashboards                |
| Explicit non-goals     | Cube designer, SMTP delivery, unparking `backend/dashboards` |
| Roles (RBAC)           | `report` resource; parent read-only dashboard                |
| Boards impacted        | n/a (operational BI, not marksheet)                          |

Screen / API inventory: see PRODUCT surface map.

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                       |
| ----------------------------- | ---- | ---------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/037_reports_schema.sql`                |
| Constraints / indexes / FKs   | ☑    | cadence/format checks, tenant indexes          |
| Multi-board seed fixtures     | ☐    | catalogue is code-seeded; no 3-board SQL seed  |
| Domain unit/property tests    | ☑    | `catalogue-service.test.ts`                    |
| Invariants documented         | ☑    | hash on run row; `run_trigger` schedule/manual |

---

## 2. API / services

| Check                              | Done | Evidence                                              |
| ---------------------------------- | ---- | ----------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | `withPgTenant` / tenant header                        |
| Validation + typed errors          | ☑    | TypeBox catalogue schemas                             |
| RBAC enforced                      | ☑    | gateway `reports` → `report`; parent 403 on principal |
| Conflict / rule failures → 409/422 | ☑    | unknown key 400; hash mismatch 400                    |
| Idempotent writes where needed     | ☐    | generate always creates a new run                     |
| Cross-tenant deny test             | ☑    | artefact download 404 for tenant B                    |

---

## 3. UI (redesign)

| Screen                  | Empty/loading/error | Write works     | Board-aware | Evidence                                        |
| ----------------------- | ------------------- | --------------- | ----------- | ----------------------------------------------- |
| `/reports`              | ☑                   | run link        | n/a         | existing catalogue + schedules/dashboards links |
| `/reports/new`          | ☑                   | generate        | n/a         | format picker                                   |
| `/reports/[id]/results` | ☑                   | download + hash | n/a         | sha256 column                                   |
| `/reports/schedules`    | ☑                   | CRUD            | n/a         | cadence + hour                                  |
| `/reports/dashboards`   | ☑                   | role widgets    | n/a         | session role                                    |

---

## 4. Cross-module integration

| Dependency             | Integrated | Evidence                                         |
| ---------------------- | ---------- | ------------------------------------------------ |
| Students / enrollments | ☑          | `students_roster`, `enrolment_by_grade` adapters |
| Attendance             | ☑          | `attendance_summary` → `student_attendance`      |
| Fees                   | ☑          | `fee_dues` → `parent_fee_invoices`               |
| Storage                | ☑          | `@proctira/storage` + disk/memory fallback       |

---

## 5. Observability & audit

| Check                               | Done | Evidence                                   |
| ----------------------------------- | ---- | ------------------------------------------ |
| Structured logs on writes           | ☑    | scheduler logger                           |
| Audit trail for sensitive mutations | ☐    | no separate audit table this slice         |
| Async job status                    | ☑    | run status queued/running/completed/failed |

---

## 6. Security & compliance

| Check                    | Done | Evidence              |
| ------------------------ | ---- | --------------------- |
| Tenant isolation         | ☑    | 037 RLS + unit deny   |
| RBAC matrix documented   | ☑    | PRODUCT §6            |
| Export download auth     | ☑    | session or HMAC token |
| Issued records immutable | ☑    | artifacts append-only |

---

## 7. Hand-off to production-ready **test** skill

Not claimed. Ungated + gated Playwright spec added; not executed here (no Playwright / full `pnpm test`).

**Verdict:** Ready w/ waivers — no live SMTP, no tip CI, no UX capture pack, in-memory datasets when Postgres relations are empty.
