# Enterprise module development checklist

**Capability / module:** Reports / BI catalogue (G-909)  
**Branch / tip:** `cursor/w9-g909-reports-56c3`  
**Owner / agent:** Cloud agent (G-909)  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Real CSV/XLSX/PDF bytes with sha256, cadence schedules, four role dashboards  
**Dev session:** Wave 9 gap G-909  
**Paired test audit:** not opened (test skill not claimed)

Copy from `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`.

---

## 0. Product contract

| Item                   | Content |
| ---------------------- | ------- |
| Capability statement   | See `docs/audits/PRODUCT_REPORTS.md` |
| In scope (peer parity) | Catalogue exports, schedules + run history, role dashboards inside report package |
| Explicit non-goals     | Cube designer, SMTP send, unparking `backend/dashboards`, live S3 required |
| Roles (RBAC)           | `report` resource; parent/guardian `report.read` for dashboard GET |
| Boards impacted        | Other — operational BI, not marksheet |

Screen / API inventory: catalogue `/reports`, generate `POST /reports/generate`, schedules, `GET /reports/dashboard`, download proxy `/api/reports/artifacts/[id]/download`. Tables `037`: `report_definitions`, `report_artifacts`, `report_schedules`, `report_runs`.

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/037_reports_schema.sql` |
| Constraints / indexes / FKs   | ☑    | format/cadence/status CHECKs; sha256 hex CHECK |
| Multi-board seed fixtures     | ☐    | Demo rows when domain tables missing (tenant-scoped) |
| Domain unit/property tests    | ☑    | `packages/backend/report/src/catalogue-service.test.ts` |
| Invariants documented         | ☑    | `docs/audits/DATA_REPORTS.md` (if present) / PRODUCT_REPORTS.md |

---

## 2. API / services

| Check                              | Done | Evidence |
| ---------------------------------- | ---- | -------- |
| Tenant middleware on all routes    | ☑    | `x-tenant-id` / JWT; RLS `app.tenant_id` |
| Validation + typed errors          | ☑    | TypeBox catalogue schemas |
| RBAC enforced                      | ☑    | PATH_RESOURCE_MAP `reports` → `report`; parent read |
| Conflict / rule failures → 409/422 | ☐    | 400 validation; 404 cross-tenant |
| Idempotent writes where needed     | ☐    | Generate always creates a new artifact |
| Cross-tenant deny test             | ☑    | catalogue-service + e2e 46 live block |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| ------ | ------------------- | ----------- | ----------- | -------- |
| `/reports` | ☑ scaffold banner | ☑ generate panel | n/a | `catalogue-generate-panel.tsx` |
| `/reports/schedules` | ☑ | ☑ create/enable/run | n/a | schedules page |
| `/reports/dashboard` | ☑ | read | n/a | role cards |
| `/reports/new` | ☑ | ☑ existing builder | n/a | 14c live generate |

---

## 4. Cross-module integration

| Dependency                                       | Integrated | Evidence |
| ------------------------------------------------ | ---------- | -------- |
| Institutions / periods                           | ☑          | enrolment provider joins `grades` when present |
| Staff / students / enrollments                   | ☑          | roster + enrolment providers |
| Attendance / assessments / exams (as applicable) | ☑          | attendance + exam_results providers |
| Exports / jobs (as applicable)                   | ☑          | CSV/XLSX/PDF generators + scheduler |

---

## 5. Observability & audit

| Check                               | Done | Evidence |
| ----------------------------------- | ---- | -------- |
| Structured logs on mutate           | ☑    | scheduler tick logs |
| Audit-relevant writes               | ☐    | Gateway G-105 on mutating `/api/v1` |
| No secrets in logs                  | ☑    | download tokens not logged |

---

## 6. Honesty / residuals

- Recipients persisted; **SMTP send of attachments deferred** (no mailer in this slice).
- **XLSX** via minimal OOXML zip (`node:zlib`), not ExcelJS (not a report-package dep; no `pnpm install`).
- PDF via `@proctira/pdf-lite` (same as examination).
- Live S3 optional; disk/memory fallback when `S3_BUCKET` unset.
- `packages/backend/dashboards` stays **parked**; role dashboards live on `GET /reports/dashboard`.
- Legacy `reportPlugin` (jobs/templates/cron) stays unmounted; gateway mounts **`reportCataloguePlugin` only**.
- Domain SQL queries used when relations exist; otherwise **tenant-scoped demo rows** (real bytes + sha256).
- `037` not applied via live `psql` in this agent; CI `apply-sql.sh` picks it up.

Gateway registrar: `report`. Prefix: `/reports`. E2E: `apps/web/e2e/46-reports-real-exports-smoke.spec.ts`.
