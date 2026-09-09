# Enterprise module test checklist — Wave 9 gap-closure slice

**Module:** Wave 9 gap closure (G-903 fees · G-904 parent/student portals · G-906 admissions CRM · G-907 gradebook · G-908 exam ops · G-914 students 360 · G-923 curriculum · G-924 platform long-tail · G-925 inert CTAs). The hooks session was opened with `modules: scholarships, academics` from keyword matches in stream briefs ("scholarship netting", "academics"); the scholarships and institutions modules themselves were certified earlier (`SCHOLARSHIPS_*.md`, `ACADEMICS_INSTITUTIONS.md`). This document records the **Wave 9 slice** that this session builds and tests.  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` (PR #41) — evidence below names the commit it was gathered on.  
**Environment:** cloud agent VM (headless), local Postgres 16 (`proctira`, non-superuser, RLS forced) + GitHub Actions CI.  
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

| Screen                              | Load OK | Empty/loading/error | Write path or N/A | Evidence                                                                                                                               |
| ----------------------------------- | ------- | ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| All rows above (authenticated load) | ☐       | ☐                   | ☐                 | **Pending** — live harness run (`tools/scripts/run-e2e-backend-ready.sh`, specs 39–45) scheduled after the batch-3 streams free the VM |

Backend unit/property: ☑ pass on merge tip `ee0959c` (see §6 for the exact commands). Static gates: `tsc --noEmit` clean for `apps/api-gateway`, `apps/web`, `packages/backend/{student,examination,institution}`; per-stream vitest suites reported green by each stream (fees 17, parent-portal 19, registration 37, gradebook 30 + curriculum 3, examination 10, student 11 + 57).

Schema: full `db/sql` sequence `001`→`036` applied from scratch into a clean database (`proctira_w9_check`, 146 tables) via `tools/scripts/apply-sql.sh` with `ON_ERROR_STOP=1` — exit 0.

---

## 2. E2E (Playwright)

| Journey              | Spec file                                                                                                                                                                                            | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- | ------ | ----------------------------------------------------- |
| Smoke routes         | `apps/web/e2e/{39-fees-structures,40-portals-academic-visibility,41-admissions-crm,42-gradebook-workflow,43-curriculum-coverage,44-students-360,45-exam-ops}-write-smoke.spec.ts` (ungated sections) | n/a                          | ☐       | ☐      | Specs typecheck and `--list` (15/48/21/27/12/9 tests) |
| Happy path           | same specs — live chain sections                                                                                                                                                                     | ☐                            | ☐       | ☐      | **Pending** live harness run                          |
| Negative / forbidden | same specs — tenant-B sections                                                                                                                                                                       | ☐                            | ☐       | ☐      | **Pending** live harness run                          |

Registration in `.github/workflows/e2e-backend-ready.yml` (`PR_SPECS` / `NIGHTLY_SPECS`) is deliberately deferred until the specs pass live on this host — registering unverified specs would turn the PR gate red for reasons unrelated to product behaviour.

---

## 3. UX / a11y

| Check                              | Pass | Evidence                                                                                                                                                    |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe WCAG 2.1 AA on module routes   | ☐    | Parent/student routes added to `a11y-axe.spec.ts` by G-904; other new routes **not yet** in the authenticated axe list — pending                            |
| Dark mode parity                   | ☐    | Parent/student routes added to `dark-mode-parity.spec.ts`; others pending                                                                                   |
| Touch targets ≥44px / ≥48px mobile | ☐    | Parent/student routes added to `touch-target-minimum.spec.ts`; others pending                                                                               |
| RTL smoke (if locale enabled)      | ☐    | Parent/student routes added to `rtl-arabic.spec.ts`; logical CSS (`me-`, `border-e`) used in new components                                                 |
| Keyboard / focus                   | ☐    | Not exercised in a browser this session                                                                                                                     |
| No inert primary CTA               | ☑    | `apps/web/src/app/(dashboard)/no-inert-primary-cta.test.ts` — 1 passed on `ee0959c` (zero `<Button disabled>` without a `title` reason under `(dashboard)`) |

---

## 4. Multidevice captures

| Screen         | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                                                          |
| -------------- | ------------ | ---------- | ---------- | ---------------------------------------------------------------------- |
| All rows in §0 | ☐            | ☐          | ☐          | **Not captured** — requires a built Next app on this VM; see §7 waiver |

Horizontal scroll / clipped CTA issues: not assessed (no captures).

---

## 5. Security

| Check                                  | Pass | Evidence                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthenticated redirect               | ☑    | Middleware unchanged for `(dashboard)`; G-904 adds role bounce (student-only off `/parent`, parent-only off `/student`) — `apps/web` middleware vitest 214 passed (stream report)                                                                                                                                                |
| RBAC deny / hide                       | ☑    | `rbac-registry.ts` maps `scim → user`, `admissions → registration`, `curriculum`; parent read-only on parent-portal academic GETs; `rbac-enforcement.test.ts` 67 passed (G-904 stream); `scim-mount.test.ts` teacher → 403                                                                                                       |
| Cross-tenant IDOR blocked (API)        | ☑    | Tenant-B deny tests in each stream's vitest (fees, parent-portal linkage 404, registration, gradebook, examination, students-360, SCIM, workflow-engine store) — all green on the merge tip                                                                                                                                      |
| Cross-tenant IDOR blocked (UI)         | ☐    | Tenant-B sections exist in specs 39–45 — **pending** live run                                                                                                                                                                                                                                                                    |
| No secrets/PHI leaked in git artifacts | ☑    | No PNG/PDF artifacts committed; `.cursor/hooks/state/*` gitignored; seed data synthetic                                                                                                                                                                                                                                          |
| Tenant isolation suite cited/run       | ☑    | `tools/tenant-isolation-tests` unit suite — 3 files / **24 passed** on `ee0959c` (raw-SQL RLS blocks for `027`–`036`, query scoping). Catalog proof on `proctira_w9_check`: every table with `tenant_id` has `relrowsecurity = true`, `relforcerowsecurity = true` and ≥1 policy (query returned 0 offenders; 141 tables forced) |

---

## 6. CI / production gates

| Gate                                           | Pass | Link / SHA                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / unit                        | ☐    | `ee0959c`: Type Check ✅; **Lint ❌** (109 unformatted files from streams) → fixed in `01ac4b2` (`prettier --write`, repo-wide check clean locally). Awaiting CI on the new tip                                                                                        |
| Integration (if DB touched)                    | ☐    | `ee0959c`: **E2E backend-ready ❌** and **Restore Drill ❌** — same root cause: Prisma migration `20260909_academic_period_hierarchy` altered `academic_periods` before `apply-sql.sh` created it → guarded in `ae5404c` (proved on empty + populated DB). Awaiting CI |
| DoD / Lighthouse / tenant gate (as applicable) | ☑/☐  | `ee0959c`: Definition of Done ✅, Visual Regression ✅, Supply Chain ✅, Helm ✅, PR Check ✅; Tenant Isolation Verification job **skipped** by affected-modules filter (unit suite run locally instead, §5)                                                           |

Local gate commands on `ee0959c`:

```bash
(cd apps/api-gateway && npx tsc --noEmit && npx vitest run src/gateway-mount-matrix.test.ts src/scim-mount.test.ts src/workflow-ui-engine-store.test.ts)   # 3 files, 24 passed
(cd apps/web && npx tsc --noEmit && npx vitest run "src/app/(dashboard)/no-inert-primary-cta.test.ts" src/lib/institutions/exports.test.ts)               # 2 files, 5 passed
(cd tools/tenant-isolation-tests && npx vitest run src/unit)                                                                                               # 3 files, 24 passed
DATABASE_URL=.../proctira_w9_check bash tools/scripts/apply-sql.sh                                                                                          # exit 0, 146 tables
```

---

## 7. Residual risks / waivers

| Item                                                                                            | Risk                                                                                    | Owner              | Waiver date / status                                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Live e2e 39–45 not yet executed                                                                 | UI write paths and UI-level IDOR unproven until run                                     | Wave 9 integration | **Open** — scheduled in this session after batch-3 streams release the VM                                                   |
| Multidevice PNG captures for §0 screens                                                         | Responsive regressions (clipped CTAs, horizontal scroll) undetected                     | Wave 9 integration | **Open** — to run with the live stack; if VM budget prevents it, this row becomes a dated waiver before PR ready-for-review |
| Authenticated axe list not extended for fees/admissions/exam ops/curriculum/students-360 routes | a11y regressions on new pages undetected by CI                                          | Wave 9 integration | **Open**                                                                                                                    |
| Batch-3 gaps (G-909, G-915–G-922) not yet merged                                                | This document covers the merged slice only                                              | Wave 9 integration | Streams in progress; evidence rows to be appended per merge                                                                 |
| Custom-fields UI (part of G-924 scope)                                                          | Deferred by decision — `custom-field` package parked in the mount matrix with rationale | Platform           | Recorded in `GATEWAY_MOUNT_MATRIX.md`                                                                                       |
| Live PSP / WhatsApp / IdP providers                                                             | Sandbox only                                                                            | Platform           | Existing waivers (G-202 etc.)                                                                                               |

---

## Done criteria

- [ ] All pillars have evidence **or** dated waivers above
- [ ] Walkthrough artifacts attached to PR
- [ ] Session state set to `complete` via hooks helper

**Verdict:** ☑ Not ready · ☐ Ready with waivers · ☐ Enterprise production-ready

Pillars flipped in the session state so far: `security` (API-level cross-tenant + RBAC + catalog RLS evidence above). `functionality`, `e2e`, `ux`, `multidevice`, `ci` remain false until the live run, captures and green tip CI exist.
