# Product / IA — Wave 11 residual depth (headless)

**Slice:** Wave 11 residuals after world-class gaps 1–10  
**Branch:** `cursor/next-gaps-close-56c3`  
**Date (UTC):** 2026-09-11  
**Peer targets:** PowerSchool student 360 tabs · Infinite Campus promotion · live campus KPIs

---

## 1. Capability statement

Registrars can **graduate terminal-grade students during year rollover** (not only count them), **bulk-update enrollment status** from the student list, and open a student profile to see **live Health / Fees / LMS** panels. Principals see **live institution overview KPIs** (students, staff, classrooms, attendance %) instead of `customData` placeholders. MapLibre, sealed PDF, and live PSP/Twilio secrets remain non-goals for this slice. **Keycloak is the platform IdP** (ADR-001); tip CI may still omit realm secrets (G-107 evidence residual).

## 2. Personas & jobs

| Persona   | Job                                                            |
| --------- | -------------------------------------------------------------- |
| Registrar | Promote/graduate cohorts at year end; bulk graduate/withdraw   |
| Teacher   | Open student 360 and see health alerts, fee clearance, LMS/PAL |
| Principal | Trust overview KPI tiles as live counts                        |

## 3. In scope / non-goals

| In scope                                                      | Non-goals                                         |
| ------------------------------------------------------------- | ------------------------------------------------- |
| Rollover marks terminal ENROLLED → GRADUATED                  | MapLibre live map                                 |
| `POST /enrollments/bulk-status` + students-list multi-select  | Live IdP / PSP / Twilio                           |
| Student detail tabs: Health, Fees, LMS (read-only live APIs)  | CA-sealed transcript PDF                          |
| Institution overview KPIs from list/hierarchy/attendance APIs | Second staff-attendance UI (HR page is canonical) |
| OSM external map link when lat/lon present                    | Sibling/consent create-form (360 panel exists)    |

## 4. Surface map

| Surface                   | Route / API                           | Data                                    |
| ------------------------- | ------------------------------------- | --------------------------------------- |
| Year rollover             | `POST /academic-periods/:id/rollover` | `enrollments`                           |
| Bulk status               | `POST /enrollments/bulk-status`       | `enrollments`                           |
| Student Health tab        | `/students/[id]?tab=health`           | `/health/records/:id`, allergies        |
| Student Fees tab          | `/students/[id]?tab=fees`             | `/fees/invoices` filtered by student    |
| Student LMS tab           | `/students/[id]?tab=lms`              | `/lms/pal/students/:id/{plan,progress}` |
| Institution overview KPIs | `/institutions/[id]/overview`         | students/staff/infra/attendance APIs    |

## 5. Roles & tenancy

All mutations require existing enrollment/calendar write roles; every query is JWT `tenantId`-scoped. Bulk status rejects cross-tenant IDs.

## 6. Success / DoD

- [ ] Rollover dry-run still counts `graduating`; execute sets source status GRADUATED
- [ ] Bulk status returns per-id results; unit test covers happy + deny already-exited
- [ ] Student page exposes Health / Fees / LMS tabs with empty-state honesty
- [ ] Overview KPIs prefer live fetches; fall back to “Currently unavailable”
- [ ] Vitest for rollover graduate + enrollment bulk-status green
- [ ] Tip CI green before merge; main tip watched after merge

## 7. Already closed (do not rebuild)

Early departure (G-919), infra CSV report, siblings/consents 360 panel, staff HR attendance page, world-class gaps 1–10.
