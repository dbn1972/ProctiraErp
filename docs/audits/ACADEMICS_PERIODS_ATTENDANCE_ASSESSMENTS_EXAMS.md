# Web App — Academics (periods / attendance / assessments / examinations)

Live verification against EC3 (`:3200` gateway / `:3201` web), demo tenant.

## Redesign nav → live status

| Redesign item | Live route | Status | Evidence |
|---|---|---|---|
| Academic periods | `/academic-periods` | **DONE** | H1 “Academic periods”; list + CRUD manager |
| Attendance · mark | `/attendance` | **DONE** | H1 “Mark attendance”; context pickers + roster form |
| Attendance · reports | `/attendance/reports` | **DONE** | H1 “Attendance analytics”; filters + report client |
| Assessments · schemes | `/assessments` | **DONE** | H1 “Assessment schemes”; scheme list |
| Assessments · items | `/assessments/items` | **DONE** | H1 “Assessment items”; item config form |
| Assessments · new scheme | `/assessments/schemes/new` | **DONE** | H1 “New grading scheme”; create form |
| Assessments · edit scheme | `/assessments/schemes/[id]/edit` | **DONE** | Edit form for seeded “CBSE 9-point Scale” |
| Assessments · result entry | `/assessments/results` | **DONE** | H1 “Result entry”; entry grid |
| Examinations · list | `/examinations` | **DONE** | H1 “Examinations”; list includes seeded exam |
| Examinations · schedule | `/examinations/new` | **DONE** | H1 “Schedule examination”; create form |
| Examinations · detail | `/examinations/[id]` | **DONE** | H1 “Class X Mid-Term 2026” |
| Examinations · candidates | `/examinations/[id]/candidates` | **DONE** | Candidates tab for seeded exam |
| Examinations · documents | `/examinations/[id]/documents` | **DONE** | Documents tab for seeded exam |
| Examinations · results | `/examinations/[id]/results` | **DONE** | Results tab for seeded exam |

**Result: 14 / 14 DONE** (HTTP 200 + page markers).

## Seed data used for detail/edit routes

- Grading scheme: `CBSE 9-point Scale` (`51c0c907-818d-4962-9e6f-281f5ced9ceb`)
- Examination: `Class X Mid-Term 2026` / `X-MID-2026` (`5ece4f4d-ba83-4d85-96b0-9948a1c35e8b`)

## Notes

- Empty-state UIs (no candidates/docs/results yet) still count as route-ready when the page chrome and primary CTA load without 404/500.
- Screenshots: `/opt/cursor/artifacts/academics-audit/`.
