# Enterprise module test checklist — Wave 9 gap-closure slice

**Module:** Wave 9 gap closure (G-903 fees · G-904 parent/student portals · G-906 admissions CRM · G-907 gradebook · G-908 exam ops · G-914 students 360 · G-923 curriculum · G-924 platform long-tail · G-925 inert CTAs). **Batch 3 (merged 2026-09-09, §8):** G-909 reports/BI · G-915 LMS depth · G-916 library · G-917 timetable generation · G-918 staff HR · G-919 attendance ops · G-920 transport · G-921 hostel · G-922 circulars. The hooks session was opened with `modules: scholarships, academics` from keyword matches in stream briefs ("scholarship netting", "academics"); the scholarships and institutions modules themselves were certified earlier (`SCHOLARSHIPS_*.md`, `ACADEMICS_INSTITUTIONS.md`). This document records the **Wave 9 slice** that this session builds and tests.  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` (PR #41) — evidence below names the commit it was gathered on.  
**Environment:** cloud agent VM (headless, 4 vCPU / 15 GB), local Postgres 16 (`proctira_test`, non-superuser role `proctira`, RLS forced) + local api-gateway (`tsx`, `SEED_DEMO_DATA=1`) + `next dev` on :3001; GitHub Actions CI (`ci.yml`, `e2e-backend-ready.yml`, `tenant-isolation.yml`, DoD).  
**Tester / agent:** Cursor cloud agent (Wave 9 integration).  
**Date (UTC):** 2026-09-09  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

---

## 0. Screen inventory (added or materially changed by the slice)

| Nav label                       | Route                                                                                | Roles                  | PII/PHI             | Notes                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- | ------------------- | ---------------------------------------------------- |
| Fees · structures               | `/fees/structures`                                                                   | admin, finance         | financial PII       | G-903 — create structure, instalments, bulk invoice  |
| Fees · reports                  | `/fees/reports` (+ `/api/fees/reports/dues` CSV proxy)                               | admin, finance         | financial PII       | G-903                                                |
| Admissions · enquiries          | `/admissions/enquiries`                                                              | admin, admissions      | applicant PII       | G-906                                                |
| Admissions · seat matrix        | `/admissions/seat-matrix`                                                            | admin, admissions      | —                   | G-906                                                |
| Admissions · merit list         | `/admissions/merit`                                                                  | admin, admissions      | applicant PII       | G-906                                                |
| Admissions · application/offers | `/admissions/[id]`                                                                   | admin, admissions      | applicant PII       | G-906 — offer → accept → auto-enrol                  |
| Assessments · outcomes          | `/assessments/outcomes`                                                              | teacher, admin         | —                   | G-907                                                |
| Assessments · report cards      | `/assessments/report-cards`                                                          | teacher, admin         | student PII         | G-907                                                |
| Institution · gradebook         | `/institutions/[id]/gradebook` (workflow, rank/CGPA, comments bank)                  | teacher, admin         | student PII         | G-907                                                |
| Institution · curriculum        | `/institutions/[id]/curriculum`                                                      | teacher, admin         | —                   | G-923                                                |
| Examinations · ops              | `/examinations/[id]/ops`                                                             | admin, exam controller | student PII         | G-908 — invigilators, seating, double entry, re-eval |
| Students · profile 360          | `/students/[id]` (photo, ID card, siblings, consents, discipline, heatmap)           | admin, teacher         | student PII (photo) | G-914                                                |
| Parent · academics              | `/parent/{attendance,grades,timetable,homework,calendar,notices}`                    | parent                 | child PII           | G-904 — parent↔child linkage enforced                |
| Student portal                  | `/student`, `/student/{attendance,grades,timetable,homework,calendar,notices,pal}`   | student                | own PII             | G-904 — self-binding                                 |
| Academic periods · export       | `/academic-periods` → `/api/academic-calendar/export[?periodId=]`                    | admin                  | —                   | G-925 (.ics)                                         |
| Attendance · reports            | `/attendance/reports` (client CSV)                                                   | admin, teacher         | —                   | G-925                                                |
| Infrastructure · report         | `/institutions/[id]/infrastructure` → `/api/institutions/[id]/infrastructure/report` | admin                  | —                   | G-925 (CSV)                                          |
| Help · support ticket           | `/help`                                                                              | all                    | —                   | G-924 (env-configured link)                          |
| MFA setup (canonical)           | `/mfa-setup` (`/mfa/setup`, `/auth/mfa-setup` redirect)                              | all                    | —                   | G-924                                                |
| SCIM 2.0 (API only)             | `/api/v1/scim/v2/{ServiceProviderConfig,ResourceTypes,Schemas,Users,Groups}`         | `user:manage` (admin)  | directory PII       | G-924 — IdP provisioning                             |

---

## 1. Functionality

| Screen                                                  | Load OK | Empty/loading/error                                                       | Write path or N/A                                                          | Evidence                                                                                                                             |
| ------------------------------------------------------- | ------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Fees structures / reports                               | ☑       | ☑ (14-row list, empty dues report)                                        | ☑ structure → instalments → bulk invoice → concession → pay → refund → CSV | `e2e/39` live: 6/6 (`/tmp/pw-fail3.log`, this tip); 44/44 on `a7aa84d` (`/opt/cursor/artifacts/wave9-audit/live-e2e-39-45-run6.log`) |
| Parent / student portal academics                       | ☑       | ☑ "No linked children yet" empty state (parent), empty PAL plan (student) | read-only by design (portal)                                               | `e2e/40` live 12/12 incl. student JWT self-binding + linked parent + unlinked-parent 404                                             |
| Admissions enquiries / seat matrix / merit / offers     | ☑       | ☑                                                                         | ☑ enquiry → stage → seat row → merit → offer → accept                      | `e2e/41` live (run6)                                                                                                                 |
| Gradebook workflow / outcomes / report cards            | ☑       | ☑                                                                         | ☑ draft → submit → approve → lock → publish, comments                      | `e2e/42` live (run6); FK violations now 400 not 500                                                                                  |
| Curriculum coverage                                     | ☑       | ☑                                                                         | ☑ unit → coverage mark                                                     | `e2e/43` live (run6)                                                                                                                 |
| Students 360 (photo, consents, discipline, heatmap, ID) | ☑       | ☑ not-found page for unknown id                                           | ☑ photo upload, consent toggle, incident, ID-card PDF                      | `e2e/44` live 9/9 (`/tmp/pw-fail1.log`, `/tmp/pw-fail3.log`)                                                                         |
| Exam ops (invigilators, seating, double entry, re-eval) | ☑       | ☑                                                                         | ☑                                                                          | `e2e/45` live (run6); `e2e/34` chain 3/3 (`/tmp/pw-fail4.log`)                                                                       |
| Infrastructure hierarchy + report                       | ☑       | ☑                                                                         | ☑ land → building; CSV export                                              | `e2e/27` live 6/6 incl. cross-tenant (`/tmp/pw-fail1.log`)                                                                           |
| Admin console (roles / users / tenant settings)         | ☑       | ☑                                                                         | ☑ invite → suspend → reactivate; role create → delete                      | `e2e/35` live 9/9                                                                                                                    |
| SCIM 2.0, MFA redirects, help link, .ics/CSV exports    | n/a UI  | ☑                                                                         | ☑ (API)                                                                    | Vitest: `scim-mount.test.ts`, `exports.test.ts`, `support.test.ts`, `no-inert-primary-cta.test.ts`                                   |

Backend unit/property: ☑ per-stream vitest suites green on the merge tip (fees 17, parent-portal 19, registration 37, gradebook 30 + curriculum 3, examination 10, student 11 + 57, institution infrastructure 37 incl. live pg-store RLS smoke). Static gates: `tsc --noEmit` clean for `apps/api-gateway`, `apps/web`, `packages/backend/{student,examination,institution}`.

Schema: full `db/sql` sequence `001`→`036` applied from scratch into a clean database (`proctira_w9_check`, 146 tables) via `tools/scripts/apply-sql.sh` with `ON_ERROR_STOP=1` — exit 0. Prisma migration `20260909_academic_period_hierarchy` guarded for the CI order (`prisma migrate deploy` before `apply-sql.sh`).

Defects found and fixed by this pillar (all on this branch): client component reaching `next/headers` through `lib/api/gradebook` (broke every page under `next dev`; new static gate `src/no-server-only-imports-in-client.test.ts`); gradebook FK violations surfacing as 500; non-UUID JWT subjects written to UUID `recorded_by` / `entered_by` columns; bulk-invoice race and structure-select default; exam-ops fixture collisions across runs.

---

## 2. E2E (Playwright)

| Journey              | Spec file                                                                                                                                                                                            | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile                                                               | Evidence                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke routes         | `apps/web/e2e/{39-fees-structures,40-portals-academic-visibility,41-admissions-crm,42-gradebook-workflow,43-curriculum-coverage,44-students-360,45-exam-ops}-write-smoke.spec.ts` (ungated sections) | n/a                          | ☑       | ☑ (40 portal shells at 390px in `touch-target-minimum` Wave 9 block) | run6: 44/44                                                                                                                             |
| Happy path           | same specs — live chain sections                                                                                                                                                                     | ☑                            | ☑       | —                                                                    | run6 44/44 on `a7aa84d`; re-run of 27/34/35/39/40/44 on this tip: 18/18, 3/3, 35/36→36/36 after `test.slow()` on the exam chain         |
| Negative / forbidden | same specs — tenant-B sections, unlinked-parent 404, refund > paid 422, unknown student not-found                                                                                                    | ☑                            | ☑       | —                                                                    | included in the runs above                                                                                                              |
| CI registration      | `.github/workflows/e2e-backend-ready.yml` `PR_SPECS` + `NIGHTLY_SPECS` include specs 39–45                                                                                                           | ☑                            |         |                                                                      | `97df5cf`; first CI run on `7e61b63`: **225 passed / 9 failed / 10 flaky** — every failure root-caused and fixed below, awaiting re-run |

CI E2E failures on `7e61b63` and their fixes (all committed on this branch):

| Failure                                                                                  | Root cause                                                                                                  | Fix                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `27` tenant B read tenant A infrastructure hierarchy                                     | Infra pg-store relied on RLS only; CI's `POSTGRES_USER` is a superuser, which bypasses RLS                  | explicit `tenant_id = $n` on every statement (`pg-store.ts`)                                                 |
| `a11y-axe` dashboard landing + mobile shell home (`main` never visible)                  | Tests never navigated after the G-402 swap from `loginAsTenantAdmin` to the HS256 cookie helper             | `page.goto('/')` added                                                                                       |
| `a11y-axe` `/lms/assignments/new[?kind=quiz]` (contrast 4.37, listitem)                  | Muted hint on the selected `bg-primary/10` tile; `<ul role="radiogroup">` with `<li>` children              | selected hint uses `text-primary`; radiogroup rendered as `div`s                                             |
| `a11y-axe` `/institutions/[id]` (execution context destroyed)                            | Bare route `redirect()`s to `/overview` after the layout shell streams; axe ran mid-hop                     | `waitForURL(…/overview)` before scanning                                                                     |
| `34` exam chain, `40` student self-binding, `35` role create, `44` photo poll (timeouts) | 2-core CI runner on `next dev`; 30s test / 5s expect budgets too small for 5–7 page chains + server actions | CI-aware `timeout: 90s`, `expect.timeout: 20s`; `test.slow()` on the exam chain; 30s waits for the role card |
| `39` bulk invoice created 1 but list filter found 0 (flaky)                              | Form's structure `<select>` defaults to the first row; other specs leave structures behind                  | spec pins its own structure via `selectOption`                                                               |

---

## 3. UX / a11y

| Check                              | Pass | Evidence                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe WCAG 2.1 AA on module routes   | ☑    | Wave 9 routes added to `a11y-axe.spec.ts` (`7e61b63`); parent/student routes by G-904. Previously failing scans (landing, mobile shell, LMS new, institution detail) re-run on this tip: 5/5 (`/tmp/pw-fail2.log`)                                               |
| Dark mode parity                   | ☑    | Shell defect fixed (`9f7ade5`: body kept `bg-gray-50`/`text-gray-900` → 1.14:1 h1 contrast in dark mode); breadcrumbs tokenised; Wave 9 routes in `dark-mode-parity.spec.ts`                                                                                     |
| Touch targets ≥44px / ≥48px mobile | ☑    | `touch-target-minimum.spec.ts` "Wave 9 routes" block: every route, desktop 44px + mobile 48px — 42/42 locally (fixes: sidebar links, shared `Input`/`Select`, inline selects, breadcrumbs, Sign Out, admissions tabs, `body.touch-controls` for coarse pointers) |
| RTL smoke (if locale enabled)      | ☑    | Parent/student routes in `rtl-arabic.spec.ts`; new components use logical CSS (`me-`, `border-e`)                                                                                                                                                                |
| Keyboard / focus                   | ☑    | Radiogroups are real `role="radio"` buttons / native radios; dialogs use the shared `Dialog` (focus trap + Escape); primary CTAs are `<Button>`/`<Link>` — verified in captures (focus order follows DOM)                                                        |
| No inert primary CTA               | ☑    | `apps/web/src/app/(dashboard)/no-inert-primary-cta.test.ts` — zero `<Button disabled>` without a `title` reason under `(dashboard)`                                                                                                                              |
| Copy / brand                       | ☑    | Capture review: mobile header logo was a broken `<img>` (`/logo.svg` missing) → asset added; student home CTA "Open pal plan" → "Open PAL plan"                                                                                                                  |

---

## 4. Multidevice captures

Captured with `apps/web/scripts/capture-screens.mjs desktop tablet mobile` against the live stack (HS256 session via `JWT_SECRET`, seeded tenant A `…0001`, institution `a2e96cd1-…`), committed under `apps/web/screens/`:

| Module (role)             | Screens                                                                                                                   | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | ---------- | --------------------------------- |
| `wave9` (admin)           | fees structures/reports, admissions enquiries/seat matrix/merit, outcomes, report cards, institution gradebook/curriculum | ☑ 9          | ☑ 9        | ☑ 9        | `apps/web/screens/wave9/`         |
| `wave9-parent` (parent)   | attendance, grades, timetable, homework, calendar, notices                                                                | ☑ 6          | ☑ 6        | ☑ 6        | `apps/web/screens/wave9-parent/`  |
| `wave9-student` (student) | home, attendance, grades, timetable, homework, calendar, notices, PAL                                                     | ☑ 8          | ☑ 8        | ☑ 8        | `apps/web/screens/wave9-student/` |

Horizontal scroll / clipped CTA check: every full-page PNG is exactly its viewport width (390 / 834 / 1440) — no horizontal overflow on any of the 69 captures (checked programmatically from PNG headers). Seat-matrix and gradebook tables scroll inside the shared `Table` wrapper (`overflow-auto`); admissions enquiries mobile is 9,473px tall from accumulated E2E rows (list, not a layout defect). Viewed: fees structures (desktop + mobile), parent attendance (desktop), student home (mobile), seat matrix (mobile).

Not covered: `/examinations/[id]/ops` and `/students/[id]` need run-specific ids (covered by live specs 44/45 with screenshots on failure only); parent portal captured in its intentional "no linked children" state because the capture identity is not linked to a student.

---

## 5. Security

| Check                                  | Pass | Evidence                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthenticated redirect               | ☑    | Middleware unchanged for `(dashboard)`; G-904 adds role bounce (student-only off `/parent`, parent-only off `/student`) — `apps/web` middleware vitest 214 passed                                                                                                                                        |
| RBAC deny / hide                       | ☑    | `rbac-registry.ts` maps `scim → user`, `admissions → registration`, `curriculum`; parent read-only on parent-portal academic GETs; `rbac-enforcement.test.ts` 67 passed; `scim-mount.test.ts` teacher → 403                                                                                              |
| Cross-tenant IDOR blocked (API)        | ☑    | Tenant-B deny tests in each stream's vitest (fees, parent-portal linkage 404, registration, gradebook, examination, students-360, SCIM, workflow-engine store) — green on the merge tip                                                                                                                  |
| Cross-tenant IDOR blocked (UI + live)  | ☑    | Live tenant-B sections of specs 27, 34, 39–45 green locally; CI caught the infrastructure hierarchy leak under a superuser DB role (see §2) — fixed with explicit tenant predicates and covered by `e2e/27`                                                                                              |
| No secrets/PHI leaked in git artifacts | ☑    | Committed PNGs show synthetic E2E fixtures only (structure codes, "E2E Demo School", empty portals); `.cursor/hooks/state/*` gitignored                                                                                                                                                                  |
| Tenant isolation suite cited/run       | ☑    | `tools/tenant-isolation-tests` unit suite 24 passed; integration `auth-boundaries` 5/5 after asserting the parameterised `set_config` form. Catalog proof on `proctira_w9_check`: every table with `tenant_id` has `relrowsecurity` + `relforcerowsecurity` + ≥1 policy (0 offenders; 141 tables forced) |

Residual (security): other raw-`pg` stores that rely on RLS alone behave correctly under the production non-superuser role but would leak under a superuser connection; the infrastructure store is now defence-in-depth, the rest are tracked in §7. Since `de75315` CI itself connects as a `NOSUPERUSER NOBYPASSRLS` owner in both the Integration and live-E2E jobs, so every `*.live.test.ts` / `pg-*-repository.test.ts` RLS assertion is now enforced by the engine rather than vacuously true.

---

## 6. CI / production gates

| Gate                                                                                | Status on `7e61b63`                                                                                                                              | Fix on this branch                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Lint / Type Check / Unit Tests                                                      | ✅ / ✅ / ✅                                                                                                                                     | —                                                                                      |
| Build                                                                               | ❌ `(auth)/mfa-setup/page.tsx`: `ssr:false` `next/dynamic` in a Server Component (Next 15 rejects; Build is skipped on `main` so never surfaced) | dynamic import moved into `mfa-setup-loader.tsx` (Client Component)                    |
| Definition of Done (G-804 page matrix)                                              | ❌ `docs/testing/PAGE_REGRESSION_MATRIX.md` stale                                                                                                | regenerated (149 pages, 0 uncovered)                                                   |
| Tenant Isolation Verification                                                       | ❌ `auth-boundaries` expected the string-interpolated `set_config`; plugin binds `$1` for both GUCs since G-720                                  | test renders bound params and asserts both `app.current_tenant_id` and `app.tenant_id` |
| E2E backend-ready live gate                                                         | ❌ 9 failed / 10 flaky / 225 passed                                                                                                              | see §2 table                                                                           |
| Visual Regression, Supply Chain, Helm, promtool, actionlint, Charter, Restore Drill | ✅                                                                                                                                               | —                                                                                      |
| Lighthouse / Bundle / Integration                                                   | skipped by affected-modules filter                                                                                                               | —                                                                                      |

Second pass on `7e5fe4e` (after the fixes above): Build ✅, DoD ✅, Tenant Isolation ✅, Lint/Type/Unit ✅, Bundle ✅, Restore Drill / Supply Chain / Visual / Helm / Workflow Lint / Observability / PR Check ✅. **Integration Tests ❌** — the backend Postgres suites step, which had been skipped on every earlier run by the affected-modules filter:

| Failing suite                                                                                         | Root cause                                                                                                                                                                                                                  | Fix (`de75315`)                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attendance-audit-rls.live.test.ts` (2) — tenant B saw tenant A's audit row; RLS write never rejected | CI booted Postgres with `POSTGRES_USER: proctira`, i.e. the suites ran as a **superuser**, which bypasses RLS entirely. Reproduced locally by granting `SUPERUSER` to the local role (same 3 failures), reverted afterwards | `ci.yml` and `e2e-backend-ready.yml` boot the container with a bootstrap `postgres` superuser and provision `proctira` as `NOSUPERUSER NOBYPASSRLS` **owner** of `proctira_test` (FORCE RLS binds owners) — the production posture. The step asserts `NOT (rolsuper OR rolbypassrls)` for the test role and writes it to the step summary |
| `pg-hostel-repository.test.ts` — unscoped `SELECT` returned the row                                   | same superuser bypass                                                                                                                                                                                                       | same                                                                                                                                                                                                                                                                                                                                      |
| `ops-service.test.ts` "staff overlap across two examinations" → 409                                   | `examBody()` derived the exam code from `Date.now()`; `beforeEach` and the test created two exams in the same millisecond on the faster runner                                                                              | code suffix from `randomUUID()`                                                                                                                                                                                                                                                                                                           |
| `import-service.test.ts` "queue large imports" — 5s timeout                                           | building and parsing a 1001-row workbook while turbo runs every backend suite in parallel on 2 cores                                                                                                                        | 30s budget on that test                                                                                                                                                                                                                                                                                                                   |

First run under the app-role posture (`1a276a5`) immediately exposed a second superuser-masked defect: the G-408 multi-board certification seed (`db/seeds/002_multi_board_schools_500.sql`) inserted into `tenants` with no `app.platform_admin` binding and a random tenant id, so it had only ever "passed" because the superuser bypassed RLS. Fixed in the next commit: fixed cert tenant id `…ce27`, `BEGIN … COMMIT` with transaction-local `app.platform_admin` + `app.tenant_id` (teardown scoped to whichever id the previous run used), verify query bound the same way, and `summary.json` now asserts 1 tenant / 3 boards / 6 schools / 3000 students / 3000 enrollments instead of always writing `ok: true`. Rehearsed twice on `ci_sim` (idempotent; an unbound app-role session sees 0 tenants).

Rehearsed the new CI recipe locally before pushing: fresh `ci_sim` database owned by non-superuser `proctira` (extensions created by `postgres`) → `prisma migrate deploy` (all 41 migrations) → `apply-sql.sh` (41 files) → `turbo run test --filter='./packages/backend/*' --force --continue`: 51/52 tasks green, the four suites above included (`curriculum` fails only in the worktree for a missing `fastify-plugin` symlink and is green in CI). `actionlint` + bundled shellcheck: clean on both workflows.

Tip CI on `de75315`+ (seed fix included): **pending** at the time of writing — the `ci` pillar flips only when the run on the fixed tip is green (subscription active on the branch).

Local gate commands on this tip:

```bash
(cd apps/web && npx tsc --noEmit)
(cd packages/backend/institution && DATABASE_URL=… npx vitest run src/infrastructure)              # 37 passed, live pg-store RLS smoke included
(cd tools/tenant-isolation-tests && npx vitest run --config vitest.config.ts src/integration)      # 5 passed
node tools/scripts/page-regression-matrix.mjs --check                                              # up to date
/tmp/w9-pw.sh … e2e/27 e2e/35 e2e/44                                                               # 18 passed
/tmp/w9-pw.sh … e2e/34 e2e/35 e2e/39 e2e/40 e2e/44                                                 # 35 passed + exam chain 3/3 after test.slow()
/tmp/w9-pw.sh … e2e/a11y-axe.spec.ts -g "landing|mobile shell|lms/assignments|institutions/… is"   # 5 passed
node scripts/capture-screens.mjs desktop tablet mobile  (×3 roles)                                 # 69 captured, 0 failed
```

---

## 7. Residual risks / waivers

| Item                                                              | Risk                                                                                                         | Owner              | Waiver date / status                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip CI re-run after the fixes above                               | A remaining CI-only flake would keep the PR gate red                                                         | Wave 9 integration | **Open** — `ci` pillar stays false until the run on the fixed tip is green                                                                                             |
| `GET /library/loans` / `/holds` parent→child binding (G-916)      | Parent JWT could list loans for a crafted `studentId`; web filtered by linked child, API did not             | Library / portals  | **Closed 2026-09-09** — `patronBinding` in `libraryPlugin` (parents: linked child or 404; students: pinned to `sub`; staff unbound); `patron-binding.test.ts` 6 passed |
| Raw-`pg` stores beyond infrastructure that rely on RLS alone      | Leak only under a superuser / BYPASSRLS DB role (not the production posture; CI now runs as the app posture) | Platform           | 2026-09-09 — accepted for this slice; follow-up: sweep `withPgTenant` callers for explicit `tenant_id` predicates                                                      |
| Parent portal captures show the unlinked state                    | Linked-child rendering verified by `e2e/40` assertions, not by PNG                                           | Wave 9 integration | 2026-09-09 — accepted; live spec covers the linked path                                                                                                                |
| `/examinations/[id]/ops`, `/students/[id]` not in the capture set | Responsive regressions on id-scoped pages caught only by spec screenshots on failure                         | Wave 9 integration | 2026-09-09 — accepted; both pages exercised at desktop in specs 44/45                                                                                                  |
| Batch-3 gaps (G-909, G-915–G-922)                                 | Covered in §8 below                                                                                          | Wave 9 integration | **Merged 2026-09-09** (`fef8a78`…`e6f5591`); live e2e 46–54 57/57 locally; tip CI pending on `a022688`+                                                                |
| Custom-fields UI (part of G-924 scope)                            | Deferred by decision — `custom-field` package parked in the mount matrix with rationale                      | Platform           | Recorded in `GATEWAY_MOUNT_MATRIX.md`                                                                                                                                  |
| Live PSP / WhatsApp / IdP providers                               | Sandbox only                                                                                                 | Platform           | Existing waivers (G-202 etc.)                                                                                                                                          |

---

## 8. Batch 3 — G-909 · G-915 · G-916 · G-917 · G-918 · G-919 · G-920 · G-921 · G-922

Six parallel worktree streams (`cursor/w9-g909-reports`, `w9-g915-lms`, `w9-g916-library-hostel`, `w9-g917-timetable-attendance`, `w9-g918-hr-comms`, `w9-g920-transport`) merged into the integration branch as `fef8a78`, `2437b8f`, `7eb2180`, `fc7f385`, `c32f48b`, `e6f5591`. Conflicts were confined to `GATEWAY_MOUNT_MATRIX.md` rows, the append-only `raw-sql-rls.test.ts`, `rbac-registry.ts` (both new permissions kept), the student home import list and the generated page matrix.

### 8.1 Functionality / data

| Check                                                                                        | Result                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh Postgres, non-superuser app role: `prisma migrate deploy` → `apply-sql.sh` `001`–`045` | 206 tables. Catalog query: **199 `tenant_id` tables ENABLE + FORCE RLS with ≥1 policy, 0 offenders**                                                                                                                    |
| Schema collision found by the apply                                                          | `db/sql/043` declared `staff_attendance`, already owned by the Prisma attendance model → `CREATE TABLE IF NOT EXISTS` no-op, index on `attendance_date` aborted the apply. Renamed to `staff_hr_attendance` (`3549d8a`) |
| `tsc --noEmit`                                                                               | api-gateway ✅ · web (incl. e2e specs) ✅ · report / lms / library / hostel / timetable / attendance / staff / communication / transport ✅                                                                             |
| Backend suites vs CI-shaped DB (`turbo run test --filter='./packages/backend/*'`)            | 51 / 52 green — `backend-curriculum` `routes.test.ts` fails only in the worktree (symlinked `node_modules`), green in CI                                                                                                |
| Gateway: mount matrix · SCIM · workflow-engine store · RBAC enforcement · insights           | 86 passed                                                                                                                                                                                                               |
| Raw-SQL RLS contract (`tools/tenant-isolation-tests`)                                        | 41 passed across 21 `describe` blocks (`037`–`045` added)                                                                                                                                                               |
| Page regression matrix                                                                       | **184 pages · 82 specs · 0 uncovered** (8 new pages initially uncovered; specs 48 / 52 / 53 / 54 extended, `9d75499`)                                                                                                   |
| Repo-wide `prettier --check`, eslint on changed files                                        | ✅ after `cb398aa` + `a022688` (one file the worktrees left unformatted failed the Lint job once)                                                                                                                       |

### 8.2 E2E — first live execution of specs 46–54

Run locally with `tools/scripts/run-e2e-backend-ready.sh` (`E2E_BACKEND_READY=1`, api-gateway on :3000 against `ci_sim`, `next dev` on :3001). The streams had only type-checked these specs.

| Run                                        | Result                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1 — all 10 specs (57 tests)                | 47 passed / 10 failed                                                              |
| 2 — the 5 specs with failures, after fixes | 24 passed / 1 failed                                                               |
| 3 — spec 48 after the patron fix           | 7 passed                                                                           |
| **Net**                                    | **57 / 57 green**; specs 46–54 added to `PR_SPECS` and `NIGHTLY_SPECS` (`d36b831`) |

| Failure (run 1)                                                                         | Root cause                                                                                                                                               | Fix                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `51` regularisation approve → 500                                                       | G-919 wrote the raw JWT subject (`e2e-admin`) into `attendance_audit.changed_by` (UUID column) — a real defect, not a test issue                         | `createAuditEntry` maps `changedBy` through `actorUuid()` like `recorded_by` already did |
| `49` gate-pass approve → 500                                                            | `gate_passes.decided_by` / `requester_user_id` were `UUID`; JWT subjects are opaque                                                                      | columns `TEXT` in `db/sql/040` (matches `042`/`043`/`045` `decided_by` convention)       |
| `48` hold / barcode checkout → 500                                                      | Spec fabricated `patronUserId: 'patron-hold'`; `library_loans.patron_user_id` has been `UUID` since `009`, and `039` holds intentionally share the shape | spec files student holds (no patron id)                                                  |
| `48` `/library/holds`, `49` `/hostel/*`, `50` `/…/substitutions` strict-mode violations | `getByRole('heading', { name })` matched the `<h1>` and a card `<h3>`                                                                                    | locators pinned to `level: 1`                                                            |
| `51` cross-tenant test → 409 grade code exists                                          | Two live tests derived the grade code from a 4-char timestamp slice                                                                                      | `randomUUID()`-based tag                                                                 |
| `54` `/transport/routes/[id]/stops` heading not found (30 s test budget exceeded)       | First hit of a fresh dynamic route compiles under `next dev`; screenshot shows the streaming skeleton                                                    | `test.slow()` + 20 s expect on that step; the page rendered route name and stop on rerun |

### 8.3 Security (batch 3)

- Every new table (`037`–`045`) carries `tenant_isolation` `FOR ALL … USING/WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))`, `ENABLE` + `FORCE` — proven by the catalog query above under the app role, not by reading SQL.
- Cross-tenant denies executed live: `51` (tenant B cannot approve tenant A regularisation), `52` (tenant B cannot read tenant A contracts), `54` (tenant B cannot read tenant A live GPS), `48` / `49` / `50` / `53` tenant-B sections.
- New RBAC: parent / guardian / student `library:read` (OPAC); `report:read` for dashboards — `rbac-enforcement.test.ts` 55 passed.
- The stream shipped `GET /library/loans` / `/holds` with no parent→child binding at the API (web-tier filter only — an IDOR for a crafted `studentId`). Closed in this integration: `libraryPlugin.patronBinding` reuses the parent-portal `hasActiveLink`; parents get 404 for unlinked ids and 400 without `studentId`, students are pinned to their JWT subject, staff principals are unbound (`patron-binding.test.ts`, 6 tests).

### 8.4 Not done in this slice (honest)

- Batch-3 UX / multidevice captures were **not** re-taken; the §4 capture set predates the merge. Ungated heading smokes across all new pages ran headless on desktop viewport only.
- Open Library ISBN, WhatsApp, GPS device feeds are stub / sandbox / env-gated.
- Tip CI on the merged tip is pending at the time of writing (see §6 note).

## Done criteria

- [x] All pillars have evidence **or** dated waivers above (CI: open until the tip run is green)
- [x] Walkthrough artifacts committed (`apps/web/screens/wave9*/`)
- [ ] Session state set to `complete` via hooks helper — after tip CI

**Verdict:** ☐ Not ready · ☑ Ready with waivers (pending green tip CI) · ☐ Enterprise production-ready

Pillars flipped in the session state: `functionality`, `e2e`, `ux`, `multidevice`, `security`. `ci` flips when the re-run on the fixed tip reports green.
