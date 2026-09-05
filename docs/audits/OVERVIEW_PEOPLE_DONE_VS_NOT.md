# Overview & People — done vs not done

Compared redesign catalog (**Web App — Overview & People**) to the live ProctiraERP web app on EC3.

## Verdict (nav item by item)

| Redesign nav item | Live route | Status | Evidence |
|-------------------|------------|--------|----------|
| Dashboard | `/home` | **DONE** | Live dashboard with KPIs + quick actions |
| Students · list | `/students` | **DONE** | List with tabs/filters/table |
| Students · profile | `/students/[id]` | **DONE** | Profile loads for demo student |
| Students · add | `/students/new` | **DONE** | Add-student form page loads |
| Students · edit | `/students/[id]/edit` | **DONE** | Fixed 2026-09-05 — edit form loads with student data |
| Students · bulk import | `/students/import` | **DONE** | Bulk import page loads |
| Students · transfer | `/students/[id]/transfer` | **DONE** | Fixed 2026-09-05 — transfer request form loads |
| Staff · list | `/staff` | **DONE** | Staff list UI works |
| Staff · profile | `/staff/[id]` | **DONE** | Profile loads for seeded demo staff |
| Staff · add | `/staff/new` | **DONE** | Add-staff form page loads |
| Staff · edit | `/staff/[id]/edit` | **DONE** | Edit form loads with staff data |
| Staff · new assignment | `/staff/[id]/assignments/new` | **DONE** | New teaching assignment form loads |
| Staff · new appraisal | `/staff/[id]/appraisals/new` | **DONE** | New appraisal form loads |

## Root cause of prior 404s (edit / transfer)

`GET /api/v1/students/:id` crashed with:

`entity.createdAt.toISOString is not a function`

Redis cache JSON-serializes `Date` values to strings. After cache hit, route formatters called `.toISOString()` on strings → 500 → web `getStudent()` returned null → `notFound()` → 404 page.

**Fix:** coerce `Date | string` in student (and staff) response formatters via `toIsoString()`.

## Screenshots

Artifacts under `/opt/cursor/artifacts/overview-people-audit/` including `22-live-students-edit-fixed.png`, `23-live-students-transfer-fixed.png`, staff profile/edit/assignment/appraisal.
