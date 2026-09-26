# Screen test — Institutions (Sunrise demo tenant)

**Worker:** Cloud screen-test (institutions only)  
**Branch:** `cursor/screen-test-institutions-48e3`  
**Date (UTC):** 2026-09-26  
**Scope:** `apps/web` institution list, detail tabs, and primary actions. **Attendance routes and tabs excluded** (forbidden issues #388 #386 #382 #381 #377 #375 #374 not touched).

## Seed reference

| Field | Value |
| ----- | ----- |
| Tenant id | `00000000-0000-4000-8000-00000000a501` |
| Tenant slug | `sunrise-public-school` |
| Institution id | `00000000-0000-4000-8000-00000000a551` |
| Institution code | `SPS-PUN-01` |
| Name | Sunrise Public School |
| Classes (sections) | `8-A`, `9-B`, `10-A` |
| Seed file | `db/seeds/006_sunrise_public_school_demo.sql` |
| Seed audit | `docs/audits/DATA_SUNRISE_DEMO_TENANT.md` |

**Auth for this pass:** HS256 `access_token` cookie (`JWT_SECRET=dev-secret-change-in-production`), `tenantId` bound to Sunrise (same pattern as `E2E_HS256_SESSION` harness). No password user in seed.

**Stack (local agent):** Postgres 16 + `apply-sql.sh` + Sunrise seed; `api-gateway` `:3000`; `@proctira/web` `next dev` `:3001`.

**Evidence artifact:** `/opt/cursor/artifacts/screen-test-institutions-results.json`

## Aggregate disposition

| Gate | Result | Notes |
| ---- | ------ | ----- |
| Screen walk (this doc) | **14 PASS · 1 FAIL (flake) · 1 BLOCKED** | See route table |
| Tip **CI Aggregate (Required)** | **EXTERNALLY_UNVERIFIED** | Merge only when Aggregate green on PR tip (per release gate) |

## Route table

| Route | Label | Primary action exercised | Result | Notes |
| ----- | ----- | ------------------------ | ------ | ----- |
| `/institutions` | List | Search `SPS`; row shows Sunrise + code | **PASS** | Block column empty (area tree RBAC 403 — see blocked row) |
| `/institutions/new` | Register | Form shell (no submit) | **PASS** | Irreversible create not attempted |
| `/institutions/00000000-0000-4000-8000-00000000a551` | Detail root | Redirect to overview | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/overview` | Overview | KPI / facts render | **PASS** | Re-run after navigation flake; first sequential goto aborted during redirect |
| `/institutions/00000000-0000-4000-8000-00000000a551/edit` | Edit | Form load (no save) | **PASS** | Save/deactivate not attempted |
| `/institutions/00000000-0000-4000-8000-00000000a551/classes` | Classes | Table lists 8-A, 9-B, 10-A | **PASS** | Roster Eye links to `/attendance?…` — **not clicked** (attendance out of scope) |
| `/institutions/00000000-0000-4000-8000-00000000a551/grades` | Grades | Tab + Add grade control | **PASS** | Create not submitted |
| `/institutions/00000000-0000-4000-8000-00000000a551/schedule` | Schedule | Master schedule shell | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/timetable` | Timetable | Grid shell | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/timetable/generate` | Timetable · generate | Wizard shell | **PASS** | Generate not run (would mutate timetable) |
| `/institutions/00000000-0000-4000-8000-00000000a551/timetable/substitutions` | Timetable · substitutions | List shell | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/gradebook` | Gradebook | Shell | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/curriculum` | Curriculum | Coverage shell | **PASS** | |
| `/institutions/00000000-0000-4000-8000-00000000a551/infrastructure` | Infrastructure | Hierarchy shell | **PASS** | |
| *(action)* | Classes · Add section | Open dialog, dismiss | **PASS** | Use `data-testid="add-section"` after hydration; dialog closed without save |
| *(blocked)* | List / hero · Block (area) | Resolve `areaId` → Pune | **BLOCKED** | `GET /api/v1/areas/tree` and `GET /api/v1/areas/:id` return **403** default-deny RBAC; fallback area list has no `a511`. Not fixable in web-only scope. |

### Explicitly skipped (attendance)

- `/attendance` and institution class-row roster links (`/attendance?institutionId=…`)
- Overview attendance KPI fetch (read-only; no attendance module navigation)

## Code fix from screen test

| Issue | Fix | Files |
| ----- | --- | ----- |
| Type column / hero meta blank when API returns slug `typeId` (`school`) | `resolveLookupLabel()` slug fallback | `apps/web/src/lib/institutions/lookups.ts`, list + layout + overview |

## Merge criteria

- [ ] **CI Aggregate (Required)** green on PR merge commit  
- [x] Screen table recorded with PASS/FAIL/BLOCKED honesty  
- [x] No forbidden issue branches / attendance writes  
