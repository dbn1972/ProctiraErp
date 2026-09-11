# Enterprise product / IA — Parent academic 360 (UI close)

**Module / slice:** Parent portal academic 360 — LMS, report cards, PAL  
**Branch / tip:** `cursor/parent-academic-360-56c3`  
**Date (UTC):** 2026-09-11  
**Owner / agent:** Cloud agent

## 1. Capability statement

A linked parent can open dedicated **LMS**, **report cards**, and **PAL** pages for each child and see live (or honest empty) academic depth already exposed by parent-portal APIs — without calling staff LMS/gradebook routes.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| Parent / guardian | See child’s LMS submissions and scores | `/parent/lms` lists assignments + summary |
| Parent / guardian | Read subject-line report cards | `/parent/report-cards` shows subjects per card |
| Parent / guardian | Understand practice plan | `/parent/pal` shows review/reinforce/introduce skills |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| Client getters for `lms`, `report-cards`, `pal` | Staff Health/Fees tabs on parent |
| Parent pages + nav for the three views | Sealed PDF / print shop |
| Empty / forbidden / error honesty via `AcademicFrame` | Live Keycloak login evidence (G-107) |
| Extend G-904 smoke + route audit | LTI/SCORM, MapLibre, Flutter |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| PowerSchool / IC parent academic depth | Read-only LMS + report-card subjects + PAL plan |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell |
| --------- | ----- | --- | --------------- | ----- |
| LMS | `/parent/lms` | `GET /parent-portal/children/:id/lms` | LMS assignments/submissions | parent |
| Report cards | `/parent/report-cards` | `GET …/report-cards` | report card jobs + subject lines | parent |
| PAL | `/parent/pal` | `GET …/pal` | Spiral PAL plan | parent |

## 6. Roles & tenancy

| Role | Can | Cannot |
| ---- | --- | ------ |
| Parent (linked) | Read own children’s academic views | Read unlinked students |
| Student (self) | Existing `/student/pal` (+ optional self LMS/report-cards later) | Parent nav |

Tenant boundary: JWT tenant + parent–child link enforcement in parent-portal service.

## 7. Success metrics / DoD

- [ ] Three parent pages render with `AcademicFrame` honesty
- [ ] Nav + route audit include the routes
- [ ] G-904 ungated login redirect covers the three paths
- [ ] Live gated e2e GETs include `lms`, `report-cards`, `pal` when backend ready
- [ ] Tip CI green; no 10/10 claim beyond this UI close

## 8. Handoff

| Next skill | Audit path |
| ---------- | ---------- |
| Build | `docs/audits/DEV_PARENT_ACADEMIC_360.md` |
| Test | G-904 e2e + route-audit |
| Release | tip CI on this branch → PR |
