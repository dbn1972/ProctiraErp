# Admissions — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-admissions-0d5c`  
**Date (UTC):** 2026-09-26  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`, Sunrise Public School)  
**Seed reference:** `db/seeds/006_sunrise_public_school_demo.sql` on `origin/main` (not applied by `apply-sql.sh`; applied manually for this walk)  
**Session auth:** HS256 cookies (`JWT_SECRET=dev-secret-change-in-production`), role `SUPER_ADMIN` — same binding pattern as E2E tenant fixtures  
**Stack:** Local Postgres 16 (`proctira_test`), api-gateway `:3000` (`SEED_DEMO_DATA=0`), web `:3001`  
**Out of scope (forbidden / skipped):** attendance; parent / fees / students trees; PRs #388 #386 #382 #381 #377 #375 #374  

## Sunrise seed — admissions data plane (honest)

| Table / API | Expected from seed | Observed (this run) | Notes |
| ----------- | ------------------ | ------------------- | ----- |
| `admission_enquiries` | **0 rows** (seed has no CRM inserts) | **0** | Empty list UI — not an error |
| `admission_applications` / registrations inbox | **0** | **0** via `/registrations/*` lists | Empty inbox copy shown |
| `admission_offers` | **0** | n/a | No application to attach offers |
| Institutions / periods / grades | 1 / 1 / 3 (Sunrise, AY 2026-27, G8–G10) | **200** from gateway with Sunrise `X-Tenant-ID` | Lookups populate enquiry / seat / merit forms |

Student rows in the seed use `admission_number` on enrolled pupils only; they are **not** admissions CRM applications.

## Route inventory (staff admissions nav)

| Label | Route | Role |
| ----- | ----- | ---- |
| Inbox | `/admissions` | Staff CRM |
| Enquiries | `/admissions/enquiries` | Staff CRM |
| Seat matrix | `/admissions/seat-matrix` | Staff CRM |
| Merit list | `/admissions/merit` | Staff CRM |
| Application detail | `/admissions/[id]` | Staff CRM (dynamic) |

## Screen results

| Route | Result | Evidence | Notes |
| ----- | ------ | -------- | ----- |
| `/admissions` | **PASS** | Playwright walk; heading + empty applications / waitlist / slots copy | Status + interview forms render; update/book controls disabled with zero applications (expected) |
| `/admissions/enquiries` | **PASS** | Playwright; `enquiry-empty` + institution option **Sunrise Public School** | Empty enquiry list (seed); create form hydrated |
| `/admissions/seat-matrix` | **PASS** | Playwright; `seat-matrix-form` hydrated | No matrix rows (empty, not error) |
| `/admissions/merit` | **PASS** | Playwright; `merit-form` hydrated | No merit list generated yet |
| `/admissions/00000000-0000-4000-8000-00000000dead` | **PASS** | Playwright; **Page not found** heading (gateway 404 on bundle) | HTTP status may be 200 in dev while not-found UI renders |
| `/admissions/[id]` (real application) | **BLOCKED** | — | Seed has **no** application id; offer / accept / decline / enrol dialogs not exercised |
| Offer send / accept / decline / pay / enrol actions | **BLOCKED** | — | Per runbook: no irreversible offer actions without rollback; requires seeded or created application |

### Aggregate (this module walk)

| Metric | Value |
| ------ | ----- |
| Routes walked | 5 / 5 listed nav + detail not-found |
| PASS | 5 |
| FAIL | 0 |
| BLOCKED | 2 (detail with real id; money/enrol confirm flows) |

## Automated check log

Ephemeral worker spec (not committed): `apps/web/e2e/_sunrise-screen.worker.spec.ts` — **5/5 passed** against `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001` with Sunrise tenant session.

Existing ungated smoke (default tenant session): `e2e/41-admissions-crm-write-smoke.spec.ts` not-found case — **passed** on same stack.

## Code changes

**None** — no clear admissions UI/API defects found on walked routes with empty CRM data.

## CI / merge honesty

| Check | Status |
| ----- | ------ |
| **CI Aggregate (Required)** on PR tip | **EXTERNALLY_UNVERIFIED** — merge only when Aggregate is green on the PR commit |
| Local `ci-aggregate-gate.mjs` | Not certifiable without CI change-detection context |
| `@proctira/web` typecheck | Pass (this branch tip) |
| `@proctira/web` lint | Pre-existing warning in `ThemeProvider.tsx` (outside admissions scope) |

## Residual / follow-up

- Bind Sunrise tenant in reviewer IdP the same way as E2E tenant `…0001` for password-login walks.
- To **PASS** offer-panel confirm-cancel tests, seed at least one `admission_applications` row (or create enquiry → convert in a disposable environment with rollback).
- Re-run this table after CRM rows exist to upgrade BLOCKED rows to PASS.
