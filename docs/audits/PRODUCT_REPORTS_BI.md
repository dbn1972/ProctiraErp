# Enterprise product / IA checklist

**Module / slice:** Reports / BI / Dashboards (Wave 9 G-909)  
**Branch / tip:** `cursor/w9-g909-reports-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Cloud agent

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Scope lock before schema/UI.

---

## 1. Capability statement

Staff (board officer, principal, registrar, teacher) can pick a named report definition (dataset + format), run it now, and download a real CSV / SpreadsheetML XLSX / PDF artifact whose SHA-256 matches the stored run hash. They can schedule daily / weekly / monthly runs with an hour and recipients; a job-runner endpoint executes due schedules and records `trigger=schedule` in run history. Parents, teachers, principals, and board officers each see a role-specific dashboard of live aggregates; a parent cannot fetch principal (or higher) widgets.

## 2. Personas & jobs

| Persona            | Job-to-be-done                                 | Success looks like                       |
| ------------------ | ---------------------------------------------- | ---------------------------------------- |
| Registrar / office | Export enrolment or attendance as CSV/XLSX/PDF | Download bytes hash-match the run row    |
| Principal          | Schedule a weekly attendance pack              | Due tick creates a `schedule` run        |
| Teacher            | See class-scoped dashboard widgets             | Teacher card set, not principal KPIs     |
| Parent / guardian  | See linked-child dashboard                     | Parent widgets only; principal query 403 |
| Board officer      | Board roll-up + enrolment export               | Board dashboard + existing G-809 summary |

## 3. Scope

| In scope                                                                 | Non-goals                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Built-in catalogue (students roster, attendance, fees, enrolment, exams) | Ad-hoc SQL / cube designer                           |
| Real CSV + SpreadsheetML XLSX + `@proctira/pdf-lite` PDF                 | ExcelJS / PDFKit new deps                            |
| Object storage via `@proctira/storage` (+ disk/memory fallback)          | Live MinIO evidence in this slice                    |
| `report_schedules` cadence + hour + `runDue(now)`                        | Email delivery SMTP                                  |
| Role dashboards GET `/reports/dashboard?role=`                           | Unparking `backend/dashboards` AreaHierarchyResolver |
| Replace insights-ui synthetic generate/runs                              | Data-warehouse ETL (G-924)                           |

## 4. Peer parity

| Peer capability                            | Our target this slice         |
| ------------------------------------------ | ----------------------------- |
| PowerSchool / Infinite Campus report queue | Run-now + history + hash      |
| Scheduled report packs                     | Daily/weekly/monthly + hour   |
| Role home dashboards                       | Four widget sets, RBAC-capped |

## 5. Surface map

| Nav label     | Route                   | API                              | Tables / events           | Shell                   |
| ------------- | ----------------------- | -------------------------------- | ------------------------- | ----------------------- |
| Reports       | `/reports`              | `GET /reports/templates`         | catalogue                 | staff                   |
| New report    | `/reports/new`          | `POST /reports/generate`         | `report_runs` + storage   | staff                   |
| Run history   | `/reports/[id]/results` | `GET /reports/runs`              | `report_runs` / artifacts | staff                   |
| Schedules     | `/reports/schedules`    | CRUD `/reports/schedules`        | `report_schedules`        | staff                   |
| Dashboards    | `/reports/dashboards`   | `GET /reports/dashboard?role=`   | live aggregates           | staff + parent (capped) |
| Board summary | `/reports` panel        | `GET /reports/board/:id/summary` | insights G-809            | staff                   |

## 6. Roles & tenancy (high level)

| Role                      | Can                                                   | Cannot                                |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| admin / principal / board | Generate, schedule, any dashboard they are ranked for | Cross-tenant artifacts                |
| teacher                   | Generate, read teacher dashboard                      | Principal/board aggregates            |
| parent                    | Parent dashboard (report:read)                        | Principal aggregates; schedule writes |

Tenant boundary notes: every 037 table is FORCE RLS on `app.tenant_id`. Artifact keys are tenant-prefixed. Download requires tenant session (optional HMAC token).

## 7. Success metrics / DoD

- [x] Download SHA-256 matches content bytes
- [x] Scheduled run appears with `trigger=schedule`
- [x] Role-switch: parent denied principal dashboard
- [ ] Live Playwright (`E2E_BACKEND_READY`) — spec written, not executed in this agent (resource discipline)
- [ ] Tip CI on merge commit — deferred to release skill

## 8. Handoff

| Next skill | Audit path                                                         |
| ---------- | ------------------------------------------------------------------ |
| Build      | `docs/audits/DEV_REPORTS_BI.md`                                    |
| UX         | not claimed this slice (no capture pack)                           |
| Security   | tenant deny + parent 403 in unit tests                             |
| Test       | `apps/web/e2e/46-reports-bi-write-smoke.spec.ts` (ungated + gated) |
| Release    | not claimed                                                        |
