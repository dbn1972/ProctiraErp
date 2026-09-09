# Enterprise product / IA checklist

**Module / slice:** Reports / BI catalogue (G-909, Wave 9 S1)  
**Branch / tip:** `cursor/w9-g909-reports-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Cloud agent (G-909)

Copy → `docs/audits/PRODUCT_REPORTS.md`. Complete **before** build.

---

## 1. Capability statement

A tenant registrar, principal, or finance officer can generate the four catalogue reports (attendance summary, fee dues, enrolment by grade, exam results) as real CSV, XLSX, or PDF files whose sha256 is stored with the artifact and whose bytes are served through an authenticated download (object storage when a bucket is configured, local disk otherwise). They can schedule those reports daily, weekly, or monthly to named recipients and see each run in history. Board, principal, teacher, and parent each receive a distinct dashboard payload under `/reports/dashboard` gated by RBAC — the parked `dashboards` package is not mounted.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| Registrar / office | Export enrolment and exam packs for board returns | Downloaded file hash matches stored sha256 |
| Principal | Weekly attendance + dues pack to leadership | Schedule run appears in history |
| Teacher | See class-scoped dashboard cards | Teacher dashboard cards ≠ principal cards |
| Parent | See child-scoped cards only | Parent payload has no staff KPIs |
| Board officer | Roll-up cards + catalogue exports | Board cards (schools / enrolment / fees) |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| Catalogue of 4 reports with CSV / XLSX / PDF | Full ad-hoc query builder / cube |
| Artifact store + sha256 + signed download | Mounting `packages/backend/dashboards` |
| Cadence schedules (daily/weekly/monthly) + run history | Email SMTP delivery of attachments (recipients persisted; send deferred) |
| Role dashboards inside the report package | Data-warehouse ETL / `backend-etl` |
| Replace insights-ui synthetic generate/download | Report-card merge-field template engine (already in unused legacy engine) |
| Keep insights board summary + `/data-warehouse` | Live S3/MinIO required (disk fallback when no bucket) |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| PowerSchool / IC canned exports | Four named catalogue reports with real bytes |
| Scheduled report packs | Daily/weekly/monthly + run history |
| Role home dashboards | Distinct board / principal / teacher / parent payloads |
| Signed file download | HMAC token + Next session proxy |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell (staff / parent / public) |
| --------- | ----- | --- | --------------- | ------------------------------- |
| Reports | `/reports` | `GET /reports/catalogue`, `POST /reports/generate`, `GET /reports/templates` | `report_artifacts`, `report_runs` | Staff |
| New report | `/reports/new` | `POST /reports/generate` | same | Staff (existing builder) |
| Results | `/reports/[id]/results` | `GET /reports/runs` | `report_runs` | Staff |
| Schedules | `/reports` (Schedules tab) | `GET/POST /reports/schedules` | `report_schedules`, `report_runs` | Staff |
| Dashboard | `/reports/dashboard` | `GET /reports/dashboard` | none (computed) | Staff; parent cards when JWT is parent |
| Download | `/api/reports/artifacts/[id]/download` | `GET /reports/artifacts/:id/download` | blob + `report_artifacts` | Staff (session) |
| Board summary (kept) | `/reports` panel | `GET /reports/board/:boardId/summary` | insights-ui | Staff |

## 6. Roles & tenancy (high level)

| Role | Can | Cannot |
| ---- | --- | ------ |
| admin / principal | Generate any catalogue report, manage schedules, see principal dashboard | Cross-tenant artifacts |
| teacher | Generate catalogue (tenant-scoped), see teacher dashboard | Other tenants; board-only cards |
| parent | See parent dashboard cards | Staff catalogue writes (RBAC `report` manage) |
| board | Board dashboard + catalogue | Other tenants |

Tenant boundary notes: every artifact / schedule / run row is `tenant_id` + RLS (`app.tenant_id`, FORCE). Scheduler due-scan uses `app.platform_admin=1` SELECT across tenants then executes each run inside `withPgTenant`.

## 7. Success metrics / DoD

- [ ] Downloaded file sha256 matches stored artifact hash
- [ ] Scheduled run appears in run history
- [ ] Role-switch e2e: principal vs teacher dashboard cards differ
- [ ] Tenant B cannot read tenant A artifacts
- [ ] `report` row in mount matrix is mounted; `EXPECTED_PARKED === EXPECTED_UNMOUNTED`
- [ ] insights-ui synthetic generate removed; board summary + DW remain

## 8. Handoff

| Next skill | Audit path        |
| ---------- | ----------------- |
| Build      | `docs/audits/DEV_REPORTS_CATALOGUE.md` |
| Data       | `docs/audits/DATA_REPORTS.md` |
| UX         | deferred (no captures this slice) |
| Security   | tenant isolation unit + e2e |
| Test       | `apps/web/e2e/46-reports-real-exports-smoke.spec.ts` (`--list` only here) |
| Release    | mount-matrix + registrar |
