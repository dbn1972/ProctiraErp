# Screen test — Health (Sunrise Public School)

**Module:** Health (web redesign)  
**Branch:** `cursor/screen-test-health-0315`  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` · data notes `docs/audits/DATA_SUNRISE_DEMO_TENANT.md`  
**Students (Sunrise, no health PHI seeded):** Aarav Mehta, Diya Sharma, Vivaan Patel, Ananya Reddy, Rohan Mehta  
**Session (screen pass):** HS256 gateway cookie, roles `SUPER_ADMIN` + `HEALTH_OFFICER`, `E2E_HS256_SESSION=1`  
**Environment (local):** Postgres `proctira_test` + Sunrise seed applied; api-gateway `:3000`; web `:3001`  
**Evidence run:** Playwright `e2e/health-sunrise-screen.spec.ts` (local only, removed from PR) + `17-health-inventory-smoke` + `17b-health-counselling-write-smoke` @ `/tmp/health-final-run.log`  
**Date (UTC):** 2026-09-26  

Attendance routes were **not** exercised. No invented clinical PHI was added to the database.

---

## Aggregate

| Metric | Result |
| ------ | ------ |
| Routes walked | 13 |
| **PASS** | 11 |
| **FAIL** | 2 |
| **BLOCKED** | 0 |
| Health inventory + counselling smokes (same run) | 40 passed / 2 failed (see residuals) |

Merge criterion: tip **Aggregate CI green** — this branch updates health UI + counselling smokes; full monorepo CI is the merge gate on GitHub.

---

## Route table

Primary action = main CTA or honest empty-state read for that screen. Status reflects Sunrise tenant with **no pre-seeded health rows** (lists empty except students/staff directory).

| Route | Primary action exercised | Result | Notes |
| ----- | ------------------------ | ------ | ----- |
| `/health` | Open **Screenings** from hub | **PASS** | Honest empty hub (0 health aggregates); KPIs 0; nav CTAs work |
| `/health/00000000-0000-4000-8000-00000000a5b1` (Aarav Mehta) | View profile empty sections | **PASS** | Name from SIS; allergies/vaccinations/chronic show “None recorded.” (fix: no 404 when no health aggregate) |
| `/health/allergies` | **New allergy** CTA → form | **FAIL** | Intermittent: CTA navigation did not complete in one run (see log); list empty state OK |
| `/health/allergies/new` | Student `<select>` shows Sunrise roster | **PASS** | Labels `SPS-NID-xxx · Name`; no UUID paste |
| `/health/vaccinations` | **New vaccination** CTA | **PASS** | Empty register copy |
| `/health/vaccinations/new` | Student picker | **PASS** | Roster visible (e.g. Diya Sharma) |
| `/health/incidents` | **Log visit** CTA | **PASS** | “No incidents yet.” |
| `/health/incidents/new` | Student picker; no institution UUID field | **PASS** | Removed optional institution UUID paste |
| `/health/phi-access` | View audit table / empty | **PASS** | Metadata-only log; student column uses labels when rows exist |
| `/health/screenings` | Read empty programs table | **PASS** | “No screening programs yet.” |
| `/health/counselling` | **Schedule session** CTA | **PASS** | “No counselling sessions recorded.” |
| `/health/counselling/new` | Student + counsellor pickers | **PASS** | Replaced UUID fields with directory `<select>` (Priya Sharma staff) |
| `/health/special-needs` | Empty register; **Add to register** disabled | **PASS** | Inert CTA disabled (create flow not wired — honest) |
| `/health/counselling` (write) | Schedule session for Aarav + Priya | **FAIL** | Form submits in UI; list did not show row within timeout in one run (API/write path residual — re-check gateway health counselling store) |

Student profile URLs for other Sunrise students (`…a5b2`–`…a5b5`) behave like Aarav: SIS name + empty health sections (**PASS** by spot-check on same code path).

---

## Fixes applied (health scope only)

| Area | Change |
| ---- | ------ |
| Student profile | `/health/[studentId]` renders SIS name with empty health sections when no aggregate exists (no `notFound()` for enrolled students) |
| Counselling create | Name-based student/counsellor `<select>`; JSON-serialized directory props for client forms |
| Allergy / vaccination / incident create | Same directory pickers; no UUID paste |
| Incident create | Removed optional institution UUID field |
| Special needs | Disabled non-functional **Add to register** button |
| Directory loading | `load-health-directory.ts` uses explicit page size 20 for gateway-safe list calls |
| E2E | `17b` / `17-health-inventory` updated for picker labels (no `Student ID` paste) |

---

## Residuals / honesty

- Sunrise seed has **students, staff, fees, consents** — **not** health allergies, vaccinations, screenings, or counselling rows. Empty states are expected until staff record data through the UI/API.
- **Special needs** register create remains **BLOCKED** at product level (disabled CTA); not scored as FAIL for empty list.
- **Counselling live write** (`17b` gated): updated for directory selects; verify on tip CI with `E2E_BACKEND_READY=1`.
- Forbidden PRs **#388 #386 #382 #381 #377 #375 #374** were not touched.

---

## How to replay

```bash
# DB (after migrate + apply-sql)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/006_sunrise_public_school_demo.sql

# Stack + smokes
export DATABASE_URL=postgresql://proctira:proctira_test@127.0.0.1:5432/proctira_test
export E2E_BACKEND_READY=1 E2E_HS256_SESSION=1 JWT_SECRET=dev-secret-change-in-production
bash tools/scripts/run-e2e-backend-ready.sh  # or start gateway +:
pnpm --filter @proctira/web exec playwright test e2e/17-health-inventory-smoke.spec.ts e2e/17b-health-counselling-write-smoke.spec.ts --project=chromium
```

Bind reviewer session to tenant `00000000-0000-4000-8000-00000000a501` the same way as other E2E tenants (`tenantId` claim / `X-Tenant-ID`).
