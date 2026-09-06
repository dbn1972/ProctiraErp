# CivitasOne redesign — program production-readiness scorecard

**Date (UTC):** 2026-09-06  
**Tip:** `main` (includes merged Other Portals #20)  
**Method:** enterprise skill · 4 parallel auditor agents · 1 senior reviewer  
**Rule:** screenshot = YES only if PNG exists under `/opt/cursor/artifacts` (no invented captures)

## Program verdict

| Metric                         | Value                                        |
| ------------------------------ | -------------------------------------------- |
| Weighted program score         | **5.6 / 10**                                 |
| Screens scored                 | 126 (≈124 redesign inventory)                |
| Modules Ready w/ waivers       | **1 / 10** (Web Auth only)                   |
| Screens with verified shots    | **43**                                       |
| Screens without verified shots | **83**                                       |
| Overall claim                  | **Not ready** for full enterprise production |

## Module scores

| Module                      | Screens | Score /10 | Screenshots        | Enterprise audit | Verdict                                               |
| --------------------------- | ------: | --------: | ------------------ | ---------------- | ----------------------------------------------------- |
| Web App — Auth              |       5 |   **8.0** | YES (multi-device) | YES              | Ready w/ waivers                                      |
| Web App — Overview & People |      13 |   **5.5** | YES (pack)         | YES              | Ready w/ waivers (gated live E2E; no staff write e2e) |
| Web App — Academics         |      22 |   **5.4** | PARTIAL 14/22      | NO formal        | Not ready                                             |
| Web App — Services          |      15 |   **6.2** | PARTIAL 6/15       | Partial          | Not ready                                             |
| Web App — Insights & System |      12 |   **4.9** | NONE               | YES              | Not ready                                             |
| Platform Admin Console      |      13 |   **4.4** | NONE               | YES (stubs)      | Not ready                                             |
| Registration Portal         |       7 |   **6.4** | NONE               | YES              | Not ready                                             |
| Public Website              |      12 |   **7.0** | NONE               | YES              | Not ready                                             |
| Other Portals               |       5 |   **5.0** | YES (incl. stubs)  | YES              | Not ready                                             |
| Mobile App (native)         |      22 |   **5.5** | NONE (Flutter)     | YES (waivers)    | Not ready                                             |

## Subsystem scores (selected)

| Area                     | Score | Shots                             |
| ------------------------ | ----: | --------------------------------- |
| Auth surfaces            |   8.0 | YES                               |
| Scholarships             |   7.9 | YES                               |
| Public Website           |   7.0 | NONE                              |
| Academic periods         |   7.0 | YES                               |
| Attendance / Assessments |   6.5 | YES                               |
| Registration             |   6.4 | NONE                              |
| Examinations             |   5.6 | YES                               |
| Workflows                |   5.5 | NONE                              |
| Mobile overall           |   5.5 | NONE                              |
| Other Portals            |   5.0 | YES                               |
| Insights & System        |   4.9 | NONE                              |
| Health                   |   4.5 | NONE                              |
| Platform Admin           |   4.4 | NONE                              |
| Institutions             |   4.5 | NONE (summary.json only; PNG gap) |

## Verified screenshot packs (real)

- `/opt/cursor/artifacts/auth-audit/` (~21)
- `/opt/cursor/artifacts/overview-people-audit/` (~23)
- `/opt/cursor/artifacts/academics-audit/` (14)
- `/opt/cursor/artifacts/scholarships-audit/` (6)
- `/opt/cursor/artifacts/other-portals-audit/` (15)

**Missing packs:** institutions, health, workflows, insights/admin, registration, public-website, flutter-mobile

## Top blockers to ≥ 8.0

1. Screenshot debt across 83 screens
2. Platform Admin stub APIs
3. Insights scaffold (import / field-mapping)
4. Gated e2e without `E2E_BACKEND_READY` in default CI
5. ~~No Overview & People enterprise audit doc~~ → `OVERVIEW_PEOPLE_DASHBOARD_STUDENTS_STAFF.md` + ungated `15-…` smoke
6. Zero staff write-path e2e (still open)
7. Institutions audited (`ACADEMICS_INSTITUTIONS.md` + `16-…` smoke) but **still uncaptured (no PNGs)**
8. Examinations lack dedicated Playwright suite
9. Mobile device IT waived + no Flutter captures
10. Other Portals docs/dashboard/marketplace still stubs

## Team

| Role            | Scope                                                |
| --------------- | ---------------------------------------------------- |
| Auditor A       | Auth + Overview & People                             |
| Auditor B       | Academics + Scholarships/Health/Workflows            |
| Auditor C       | Insights + Platform Admin + Portals                  |
| Auditor D       | Mobile Flutter                                       |
| Senior reviewer | Conflict resolution (prefer lower score on conflict) |

Canvas: `/cursor/stores/user/canvases/ceb85c59-c8af-4f46-bd7c-25a932bb1769/source.canvas.tsx`
