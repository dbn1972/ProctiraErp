# Overview & People — done vs not done

Compared redesign catalog (**Web App — Overview & People**) to the live ProctiraERP web app on EC3.

## Verdict (nav item by item)

| Redesign nav item | Live route | Status | Evidence |
|-------------------|------------|--------|----------|
| Dashboard | `/home` | **DONE** | Live dashboard with KPIs + quick actions |
| Students · list | `/students` | **DONE** | List with tabs/filters/table; 1 demo student |
| Students · profile | `/students/[id]` | **DONE** | Profile opens for demo student |
| Students · add | `/students/new` | **DONE** | Add-student form page loads |
| Students · edit | `/students/[id]/edit` | **PARTIAL** | Route file exists; live returned 404/`notFound()` in test |
| Students · bulk import | `/students/import` | **DONE** | Bulk import page loads |
| Students · transfer | `/students/[id]/transfer` | **PARTIAL** | Route file exists; live returned 404/`notFound()` in test |
| Staff · list | `/staff` | **DONE** | Staff list UI works (0 staff in demo tenant) |
| Staff · profile | `/staff/[id]` | **CODE DONE / NO DATA** | Page implemented; no staff rows to open |
| Staff · add | `/staff/new` | **DONE** | Add-staff form page loads |
| Staff · edit | `/staff/[id]/edit` | **CODE DONE / NO DATA** | Implemented; needs a staff record |
| Staff · new assignment | `/staff/[id]/assignments/new` | **CODE DONE / NO DATA** | Implemented; needs a staff record |
| Staff · new appraisal | `/staff/[id]/appraisals/new` | **CODE DONE / NO DATA** | Implemented; needs a staff record |

## Also fixed while auditing

- Split client-safe notification preferences API from server-only inbox helpers (`notifications.ts` / `notifications.server.ts`) so the app shell no longer pulls `next/headers` into Client Components via `gateway.ts`.
- Marked `gateway.ts` with `server-only` and moved URL constants to `gateway-config.ts`.

## Screenshots

Artifacts under `/opt/cursor/artifacts/overview-people-audit/` (redesign mocks + live pages).
