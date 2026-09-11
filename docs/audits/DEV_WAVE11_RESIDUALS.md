# Development checklist — Wave 11 residual depth

**Slice:** Wave 11 residuals (rollover graduate, bulk status, student 360 live tabs, institution live KPIs)  
**Branch:** `cursor/next-gaps-close-56c3`  
**Date (UTC):** 2026-09-11  
**Product IA:** `docs/audits/PRODUCT_WAVE11_RESIDUALS.md`

## Closed in this slice

| Item                                                   | Evidence                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Rollover marks terminal ENROLLED → GRADUATED on source | `calendar-service` updateMany + academic-calendar test asserts `GRADUATED` + `exitedAt` |
| `POST /enrollments/bulk-status`                        | Schema + service + route; unit tests for success + per-id failure                       |
| Student profile Graduate CTA                           | `GraduateStudentButton` + `graduateEnrollmentAction`                                    |
| Student list bulk graduate                             | `StudentsBulkGraduateBar` + `bulkGraduateStudentsAction`                                |
| Student tabs Health / Fees / LMS                       | Live panels over health, fees, LMS/PAL clients                                          |
| Institution overview live KPIs                         | Students/staff totals, attendance %, room count from hierarchy                          |

## Non-goals (unchanged)

MapLibre · sealed transcript PDF · live IdP/PSP/Twilio · second staff-attendance UI · sibling/consent create forms

## Honesty

This closes residual **Wave 11** depth only. Do not claim product 10/10, production-ready, or tip-CI ship until release-ops gate on the merge commit.
