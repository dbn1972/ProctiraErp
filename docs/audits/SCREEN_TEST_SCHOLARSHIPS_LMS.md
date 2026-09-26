# Screen test — Scholarships & LMS (Sunrise Public School)

**Repository:** `dbn1972/ProctiraERP`  
**Branch:** `cursor/screen-test-scholarships-lms-2a96`  
**Tip SHA (audit):** `7f00f664`  
**Tenant:** `00000000-0000-4000-8000-00000000a501` · slug `sunrise-public-school`  
**Institution:** `00000000-0000-4000-8000-00000000a551` · Sunrise Public School  
**Session:** HS256 gateway cookie (`JWT_SECRET` dev default) · tenant id bound in JWT  
**Stack:** local Postgres + `tools/e2e/seed-e2e-tenants.sql` + `db/seeds/006_sunrise_public_school_demo.sql` (from tip `b6965555`, applied manually for this run) · api-gateway `:3000` · `@proctira/web` `:3001`  
**Out of scope (forbidden / skipped):** attendance, parent, fees, students modules · PRs #388 #386 #382 #381 #377 #375 #374  

**Named learners (Sunrise seed):** Aarav Mehta, Diya Sharma, Vivaan Patel, Ananya Reddy, Rohan Mehta — used for PAL lookup spot-check only (invalid UUID client validation); no writes.

**Data posture:** scholarship programs, applications, LMS assignments, and disbursements were **empty** for this tenant (expected). Detail routes that require an entity id are **BLOCKED**, not failures.

**Destructive controls:** Approve, reject, and retry-failed-transfers were exercised only through the confirm dialog; **Confirm was not clicked** (Escape / cancel). No decisions or retries were submitted.

---

## Aggregate (Scholarships + LMS)

| Disposition | Count |
| ----------- | ----: |
| **PASS**    |    13 |
| **FAIL**    |     0 |
| **BLOCKED** |    11 |

**Merge gate:** merge this PR only when **CI Aggregate (Required)** is green on the merge commit. This audit does not claim Aggregate green by itself.

---

## Scholarships route table (App Router + federated registry)

| Route | Label | Result | Notes |
| ----- | ----- | ------ | ----- |
| `/scholarships` | Programs catalog | **PASS** | Empty state; h1 + CTAs |
| `/scholarships/programs/new` | New program | **PASS** | Form rendered; **no submit** |
| `/scholarships/programs/:id` | Program detail | **BLOCKED** | No programs seeded (404 / notFound) |
| `/scholarships/programs/:id/edit` | Program edit | **BLOCKED** | No programs seeded (404 / notFound) |
| `/scholarships/applications` | Applications queue | **PASS** | Empty queue |
| `/scholarships/applications/:id` | Application detail | **BLOCKED** | No applications seeded (404 / notFound) |
| `/scholarships/disbursements` | Disbursements | **PASS** | Empty ledger; no failed batch |
| `/app/scholarships` | Federated programs mount | **BLOCKED** | App Router retires `/app/*` (see `not-found.tsx`); canonical `/scholarships` |
| `/app/scholarships/apply` | Federated apply wizard | **BLOCKED** | Same — not mounted on App Router |
| `/app/scholarships/review` | Federated review queue | **BLOCKED** | Same — staff queue is `/scholarships/applications` |
| `/app/scholarships/disbursements` | Federated disbursements | **BLOCKED** | Same — canonical `/scholarships/disbursements` |

### Scholarships confirm actions

| Control | Result | Notes |
| ------- | ------ | ----- |
| Approve application | **BLOCKED** | No applications in queue |
| Reject application | **BLOCKED** | No applications in queue |
| Retry failed transfers | **BLOCKED** | No failed disbursements; retry control not rendered |

When an application exists, the Next detail surface uses `ApplicationDecisionForm` with `ConfirmActionDialog` (`scholarship-approve-confirm` / reject dialog) — stop at confirm without submitting.

---

## LMS route table (App Router + federated registry)

| Route | Label | Result | Notes |
| ----- | ----- | ------ | ----- |
| `/lms` | Coursework hub | **PASS** | Subnav + empty assignments OK |
| `/lms/bank` | Question bank | **PASS** | |
| `/lms/rubrics` | Rubrics | **PASS** | |
| `/lms/discussions` | Discussions | **PASS** | |
| `/lms/lessons` | Lessons | **PASS** | |
| `/lms/content` | Content | **PASS** | |
| `/lms/analytics` | Class analytics | **PASS** | |
| `/lms/pal` | Spiral PAL | **PASS** | Invalid learner id shows client validation (no API write) |
| `/lms/assignments/new` | Assignment builder | **PASS** | Empty save blocked client-side; **no save** |
| `/lms/assignments/:id` | Assignment detail | **BLOCKED** | No assignments seeded (notFound) |
| `/app/lms` | Federated LMS mount | **BLOCKED** | App Router retires `/app/*`; canonical `/lms` |
| `/app/lms/pal` | Federated PAL redirect | **BLOCKED** | Same |
| `/app/lms/assignments/new` | Federated builder redirect | **BLOCKED** | Same |

---

## Automated cross-check (ungated)

| Spec | Result |
| ---- | ------ |
| `e2e/26-lms-write-smoke.spec.ts` (client validation) | 3/3 passed |
| `e2e/10-scholarships.spec.ts` (live list) | skipped (`E2E_BACKEND_READY` unset in default `pnpm test:e2e`) |

Live Sunrise walk used headless Chromium against `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001` with tenant `…a501` in the JWT.

---

## Code changes from this screen pass

No product defects requiring a code fix were found in the Scholarships or LMS App Router surfaces at empty-data posture. Federated `/app/*` 404s match documented retirement; canonical routes PASS.

**Disposition:** screen test **PARTIAL** for write/confirm paths (blocked on empty scholarship/LMS entities) · list/hub surfaces **PASS** on Sunrise tenant.
