# Screen test — Student portal (Sunrise demo)

**Repo:** [dbn1972/ProctiraErp](https://github.com/dbn1972/ProctiraErp)  
**Branch:** `cursor/screen-test-student-portal-1477`  
**Tip SHA (audit run):** `52e01ed5dce36f7b59f0cd751d524e6f0e6cd31b`  
**Date (UTC):** 2026-09-26  
**Scope:** `(student)` shell only — not staff `/students` admin, parent, or fees.  
**Forbidden overlap:** #388, #386, #382, #381, #377, #375, #374 (attendance route skipped per #386).

## Session binding

| Field                      | Value                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant (requested)**     | `00000000-0000-4000-8000-00000000a501` (Sunrise demo)                                                                            |
| **Student (requested)**    | Aarav Mehta                                                                                                                      |
| **JWT `sub` (student id)** | `00000000-0000-4000-8000-00000000a502`                                                                                           |
| **Binding model**          | Same as E2E: HS256 session cookie + gateway `/api/v1/student-portal/me/*` resolves actor from JWT `sub` (not forgeable headers). |

**Seed honesty:** At tip `52e01ed5`, the repository has **no** committed SQL seed for tenant `…a501` or student “Aarav Mehta”. For this screen pass, a **minimal local-only** tenant row and student row were inserted in the agent Postgres instance so binding matches production rules; nothing outside `docs/audits/` was changed for that bootstrap.

**Stack:** Local Postgres 16 + Redis + `@proctira/api-gateway` (`127.0.0.1:3000`) + `@proctira/web` (`127.0.0.1:3001`), `JWT_SECRET=dev-secret-change-in-production`, E2E tenant SQL + domain `apply-sql.sh` (CI profile).

## Route matrix

| Route                 | Screen      | Result      | Notes                                                                                |
| --------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------ |
| `/student`            | Today (hub) | **PASS**    | Hub cards + nav; `data-testid=student-home`.                                         |
| `/student/attendance` | Attendance  | **BLOCKED** | Skipped — open UX/module work **#386** (forbidden edit surface).                     |
| `/student/calendar`   | Calendar    | **PASS**    | API 200, `data: []`; UI empty copy: “No holidays or events have been published yet.” |
| `/student/grades`     | Grades      | **PASS**    | API 200, empty arrays; honest “No published grades yet.”                             |
| `/student/homework`   | Homework    | **PASS**    | API 200, empty list; honest “No published homework yet.”                             |
| `/student/library`    | Library     | **PASS**    | OPAC search shell, “Enter a title…”, empty loans/holds status lines.                 |
| `/student/notices`    | Notices     | **PASS**    | API 200, empty list; honest “There are no school notices right now.”                 |
| `/student/pal`        | PAL plan    | **PASS**    | API 200, empty plan; honest “No practice plan yet…”                                  |
| `/student/timetable`  | Timetable   | **PASS**    | API 200, empty slots; honest “No published class meetings yet.” + empty grid.        |

### Aggregate (in-scope routes)

| PASS | FAIL | BLOCKED |
| ---- | ---- | ------- |
| 8    | 0    | 1       |

Attendance excluded from pass/fail denominator per #386 skip instruction.

## Defects / fixes

No **clear** student-portal bugs were reproduced on this pass; **no** edits under `apps/web/src/app/(student)/**`.

## Evidence

- Playwright headless walk (Sunrise tenant cookie + live gateway), one PNG per exercised route under `/opt/cursor/artifacts/student-{today,calendar,grades,homework,library,notices,pal,timetable}.png`.
- Ungated auth: existing inventory `apps/web/e2e/40-portals-academic-visibility-smoke.spec.ts` (student routes → `/login` when logged out).

## CI / merge

Merge when **Aggregate** workflow is green on the PR merge commit. This document does **not** claim CI green until the PR check completes.

## Disposition

Student portal screen slice at tip: **PARTIAL** overall program bar (attendance **BLOCKED** on #386; Sunrise demo seed not yet in repo SQL). In-scope routes exercised here: **8/8 PASS**, **0 FAIL**.
