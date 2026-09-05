---
name: enterprise-module-production-ready
description: >-
  Run world-class enterprise production-ready testing for a ProctiraERP redesign
  module (E2E, UX, multidevice, functionality, security). Use when the user asks
  to fully test, E2E, production-ready, enterprise label, audit a nav module
  (Scholarships, Health, Academics, etc.), or when hooks mark an enterprise-test
  session. Also use before claiming a module PR is merge-ready.
---

# Enterprise Module Production-Ready Testing

This skill is the **Definition of Done** for any redesign nav module (e.g. Scholarships, Health). Hooks in `.cursor/hooks.json` activate an enterprise-test session when the user asks for full/E2E/production-ready testing; the `stop` hook follows up until the bar below is met or explicitly waived.

## Honest coverage map (do not overclaim)

| Pillar            | What exists today                                                                                                                                                                                                             | What agents must still prove per module                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **E2E journeys**  | Playwright under `apps/web/e2e/` (01–13 + auth + UX properties). Many specs **skip** unless `E2E_BACKEND_READY=1`. Scholarships/Health/Workflows/Insights = dedicated smokes; live write paths still need backend-ready runs. | Live authenticated journey per screen + critical write path                      |
| **UX / a11y**     | `a11y-axe`, dark-mode, RTL, touch-target, CLS, loading-skeleton specs; ESLint a11y + contrast gate                                                                                                                            | Module routes included in axe/dark/touch lists; no critical axe violations       |
| **Multidevice**   | Playwright projects: Chromium/Firefox/WebKit + Pixel 5 + iPhone 13 + iPad. `apps/web/scripts/capture-screens.mjs` desktop/tablet/mobile PNGs. **No visual-diff CI**.                                                          | Capture **desktop + tablet + mobile** for every screen; spot-check touch targets |
| **Functionality** | Backend unit/property tests for many domains                                                                                                                                                                                  | UI create/update/list/detail/error states against real or seeded API             |
| **Security**      | Tenant-isolation release gate (`tools/tenant-isolation-tests/`); web `07-tenant-isolation` (students); `09-route-permission-coupling` (core SIS only)                                                                         | Cross-tenant deny + RBAC deny for **this** module’s sensitive routes             |
| **CI gates**      | Lint, typecheck, unit, integration, DoD, Lighthouse, tenant isolation, bundle                                                                                                                                                 | Tip CI green; do not merge on skipped E2E alone                                  |

## When this skill applies

Trigger on prompts containing: full test, E2E, production ready, enterprise, audit, redesign screens, Health, Scholarships, multidevice, UX, security test — or when `.cursor/hooks/state/enterprise-test-session.json` exists with `"active": true`.

## Required workflow (do not skip pillars)

Copy the checklist template:

`docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`

→ `docs/audits/<MODULE>_<SCREENS>.md`

Work the pillars **in order**. Mark each checkbox only with evidence (path, run URL, or artifact).

### 0. Scope lock

1. List every redesign nav label for the module (exact strings from the sidebar).
2. Map each label → route(s) under `apps/web/src/app/(dashboard)/` and any federated `features/` router.
3. Map API surface (`apps/web/src/lib/api/*`, gateway plugin, `packages/backend/<domain>/`).
4. Write the screen inventory table in the audit doc (label, route, role, PII/PHI flag).

**Health (from redesign nav)** — minimum screens:

| Nav label                | Primary route(s)                                                |
| ------------------------ | --------------------------------------------------------------- |
| Health · screenings      | `/health/[studentId]` (Screenings tab) + screening-programs API |
| Health · student profile | `/health/[studentId]`                                           |
| Health · counselling     | `/health/counselling`                                           |
| Health · special needs   | `/health/special-needs`                                         |
| Health · list (hub)      | `/health`                                                       |

**Scholarships** — minimum screens:

| Nav label          | Primary route                     |
| ------------------ | --------------------------------- |
| programs           | `/scholarships`                   |
| program detail     | `/scholarships/programs/[id]`     |
| new program        | `/scholarships/programs/new`      |
| applications       | `/scholarships/applications`      |
| application detail | `/scholarships/applications/[id]` |
| disbursements      | `/scholarships/disbursements`     |

**Workflows** — minimum screens:

| Nav label                     | Primary route                 |
| ----------------------------- | ----------------------------- |
| Workflows · definitions       | `/workflows`                  |
| Workflows · new definition    | `/workflows/definitions/new`  |
| Workflows · definition detail | `/workflows/definitions/[id]` |
| Workflows · instances         | `/workflows/instances`        |
| Workflows · my approvals      | `/workflows/approvals`        |

**Auth (public identity)** — minimum screens:

| Nav label       | Primary route      |
| --------------- | ------------------ |
| Login / sign-in | `/login`           |
| Sign up         | `/signup`          |
| Forgot password | `/forgot-password` |
| Reset password  | `/reset-password`  |
| MFA verify      | `/mfa`             |
| Logout          | `/logout`          |
| OAuth callback  | `/oauth/callback`  |

Auth security extras (mandatory for Auth enterprise claim): sanitize `returnTo` / open-redirect; `/signup` in middleware `PUBLIC_PATHS`; httpOnly session cookies; unauthenticated dashboard → `/login`.

**Auth tip carve-out lesson:** Prefer tip-`main` Auth UI PRs over mega Phase-2 branches (e.g. conflicted PR #1). Equivalent Auth path: #8–#11. Always Prettier tip-commit `.md`/`.ts` files — Lint checks **tip commit only**.

**Insights & System (web app)** — minimum screens:

| Nav label                      | Primary route(s)                                                        |
| ------------------------------ | ----------------------------------------------------------------------- |
| Reports · catalog              | `/reports`                                                              |
| Reports · builder              | `/reports/new`                                                          |
| Reports · result               | `/reports/[id]/results`                                                 |
| Data warehouse · overview      | `/data-warehouse`                                                       |
| Data warehouse · import        | `/data-warehouse/import`                                                |
| Data warehouse · field mapping | `/data-warehouse/field-mapping` (column → warehouse field; **not** GIS) |
| Data warehouse · GIS map       | `/data-warehouse/map`                                                   |
| Admin · overview               | `/admin`                                                                |
| Admin · users                  | `/admin/users`                                                          |
| Admin · roles                  | `/admin/roles`                                                          |
| Admin · permission matrix      | `/admin/permissions`                                                    |
| Admin · tenant settings        | `/admin/tenant`                                                         |
| Public · track application     | `/track`                                                                |

Insights skill notes: redesign “map” ≠ GIS. Keep GIS at `/data-warehouse/map`. Field mapping must be a distinct route with Import “Continue to mapping” CTA. Gate live E2E on `E2E_BACKEND_READY`; extend dark/touch/axe/capture lists for `/reports*`, `/data-warehouse*`, `/admin*`, `/track`.

**Platform Admin Console** (`apps/admin-console`) — minimum screens:

| Nav label                           | Primary route(s)                                   | Notes                      |
| ----------------------------------- | -------------------------------------------------- | -------------------------- |
| Operator login                      | `/login`                                           | Platform operator auth     |
| Platform overview                   | `/`                                                | Hub                        |
| Tenants / Provision tenant          | `/tenants`, `/tenants/new`, `/tenants/[id]`        | Tenant lifecycle           |
| Plans / Plugins / Themes            | `/plans`, `/plugins`, `/themes` (+ `[id]` details) | Commercial + extensibility |
| Break-glass / Break-glass requests  | `/break-glass`, `/break-glass/requests`            | Emergency access           |
| Support / System health / Audit log | `/support`, `/health`, `/audit`                    | Ops                        |
| 403 Forbidden                       | `/forbidden`                                       | Explicit forbidden surface |

Platform Admin skill notes: always `sanitizeReturnTo` on login `returnTo` (and middleware redirect query). Prefer Vitest auth matrix + `e2e/01-platform-admin-smoke.spec.ts` (gate live inventory on `E2E_BACKEND_READY`). Audit: `docs/audits/ADMIN_CONSOLE_PLATFORM.md`.

**Registration Portal** (`apps/registration-portal`) — minimum screens:

| Nav label             | Primary route(s)                                   |
| --------------------- | -------------------------------------------------- |
| Home                  | `/`                                                |
| Find schools          | `/schools` (Apply CTA must set `institutionId`)    |
| Apply · personal info | `/apply/[type]`                                    |
| Apply · documents     | `/apply/[type]/documents`                          |
| Apply · review        | `/apply/[type]/review` (block submit without UUID) |
| Apply · success       | `/apply/success`                                   |
| Track application     | `/track`, `/track/[n]?dob=` (backend DOB required) |

Registration skill notes: wire school → apply `institutionId`; require DOB on status API; prefer Vitest validation + `e2e/01-registration-portal-smoke.spec.ts` (gate live on `E2E_BACKEND_READY`). Audit: `docs/audits/REGISTRATION_PORTAL_HOME_SCHOOLS_APPLY_TRACK.md`.

**Public Website** (`apps/public-website`) — minimum screens:

| Nav label                                                                        |
| -------------------------------------------------------------------------------- |
| Home / Product / Installation / Security / Compliance / Status / About / Contact |
| Legal hub / Privacy / Terms / Cookies                                            |

Public Website skill notes: keep Login CTA on `NEXT_PUBLIC_WEB_APP_URL/login` (fallback `/contact` — never a dead in-app `/login`). Prefer shared Vitest contact validation + honeypot/rate-limit on `POST /api/contact`. Smoke: `e2e/01-public-website-smoke.spec.ts` (gate live contact on `E2E_BACKEND_READY`). Avoid lucide `Github` under Next `optimizePackageImports` (use `Code2` or a direct icon import). Audit: `docs/audits/PUBLIC_WEBSITE_HOME_PRODUCT_LEGAL_CONTACT.md`.

### Execution environment (cloud agents)

- Run **all** verification on the cloud agent / CI host in **headless** mode.
- Do **not** depend on a user laptop browser, local tunnel, or interactive GUI.
- Prefer gateway Vitest inject tests + Playwright `--project=chromium` headless against a server-local stack (`E2E_BACKEND_READY=1` only when that stack is up on the same host).

### 1. Functionality (must pass)

For each screen:

- [ ] Loads authenticated (HTTP 200, primary heading visible, no error boundary)
- [ ] Empty / loading / error states are intentional (not blank crash)
- [ ] At least one **write** path if the screen has forms (create/update/retry) OR document “read-only by design”
- [ ] List → detail navigation works with real IDs (seed via API if needed)
- [ ] Backend unit/property tests for the domain still pass

### 2. E2E (Playwright, live backend)

- [ ] Add or extend `apps/web/e2e/<nn>-<module>.spec.ts`
- [ ] Gate live steps with `test.skip(!process.env.E2E_BACKEND_READY, ...)` only for live calls; keep a **smoke** that always asserts route wiring in CI when possible
- [ ] Run with `E2E_BACKEND_READY=1` against seeded tenant (EC3 tunnel or local stack)
- [ ] Cover: happy path + one negative path (validation or forbidden)
- [ ] Prefer projects: Desktop Chrome + one mobile project minimum

```bash
cd apps/web
E2E_BACKEND_READY=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3201 \
  pnpm exec playwright test e2e/<spec>.spec.ts --project=chromium
```

### 3. UX / accessibility

- [ ] Include module routes in `a11y-axe.spec.ts` authenticated set when backend ready
- [ ] Dark-mode parity route list includes module hub
- [ ] Touch targets: module hub in touch-target specs (≥44px desktop / ≥48px mobile)
- [ ] No new brand-string / contrast / icon-only-button lint failures
- [ ] Keyboard: primary CTA reachable; focus not trapped in dialogs

### 4. Multidevice / responsive screens

- [ ] Extend `apps/web/scripts/capture-screens.mjs` module targets for every screen
- [ ] Capture **desktop (1440)**, **tablet (834)**, **mobile (390)**
- [ ] Store under `/opt/cursor/artifacts/<module>-audit/` (or `apps/web/screens/`)
- [ ] Visually verify: no horizontal scroll on mobile for primary content; tables scroll or stack; CTAs not clipped
- [ ] Embed key PNGs in the PR walkthrough

```bash
cd apps/web
node scripts/capture-screens.mjs desktop tablet mobile
# limit to a module by editing TARGETS / env if the script supports it
```

### 5. Security / tenancy / privacy

**Mandatory for Health (PHI) and Scholarships (financial PII):**

- [ ] Unauthenticated visit → redirect to sign-in
- [ ] Role without permission → forbidden / empty per product rules (`09-route-permission-coupling` pattern)
- [ ] Cross-tenant IDOR: Tenant B cannot read Tenant A resource by UUID (API + UI)
- [ ] Confirm tenant header / RLS / service scoping for list endpoints
- [ ] No secrets, tokens, or raw PHI in client logs, screenshots committed to git, or PR text beyond redacted evidence
- [ ] Run or cite tenant isolation gate when backend touched: `tools/tenant-isolation-tests`

### 6. Performance / CI production gates

- [ ] Tip CI green (lint, typecheck, unit, integration if shared/db, DoD, Lighthouse when triggered)
- [ ] Lighthouse: do not regress a11y ≥ 0.95 on gated routes; mobile perf may be advisory per project policy
- [ ] No committed build caches or secrets

### 7. Evidence pack (required before “done”)

- [ ] Audit markdown filled with pass/fail + links
- [ ] Screenshots (all screens × ≥1 viewport; ideally 3 viewports)
- [ ] Playwright report or log excerpt for live E2E
- [ ] PR updated with walkthrough images
- [ ] Explicit residual risks section (what was **not** tested)
- [ ] Update `.cursor/hooks/state/enterprise-test-session.json`: set each `pillars.*` to `true` as evidence lands; set `"status": "complete"` when done or waived

## Stop / done criteria

You may claim **enterprise production-ready** for a module only when:

1. All pillars above are checked with evidence, **or**
2. Any skipped pillar has a dated waiver in the audit doc with owner + risk, **and**
3. Hooks state file is `"status": "complete"`.

Do **not** equate “pages render” or “CI green with E2E skipped” with enterprise production-ready.

## Flutter / mobile (apps/mobile)

When enterprise-testing the Flutter client (not web viewports):

| Pillar             | Mobile bar                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**           | Real `POST /api/v1/auth/login` via `AuthApi`; no `pending-*-token` fakes; Dio injects `Authorization: Bearer` + `X-Tenant-ID`; refresh-on-401 best effort |
| **DI**             | GetIt registers Student/Attendance/Scholarship/Health/Examination/Assessment repos; `MultiRepositoryProvider` in `OpenEmisApp` for `context.read` screens |
| **Analyze / unit** | `flutter analyze` clean on `apps/mobile` + `packages/flutter-core/api-client`; package unit tests for auth token parsing                                  |
| **Integration**    | `integration_test/` journeys for login redirect, tenant isolation, attendance offline sync (device/emulator or waived with dated note)                    |
| **Security**       | No hardcoded tokens; logout clears secure storage (+ best-effort `AuthApi.logout`); biometric only unlocks _existing_ stored tokens                       |
| **Audit**          | `docs/audits/MOBILE_FLUTTER_ENTERPRISE.md`                                                                                                                |

Default API base: `--dart-define=API_BASE_URL=...` (see `kDefaultApiBaseUrl` in `injector.dart`).

## Multi-app surfaces (beyond `apps/web`)

Enterprise claims for **Platform Admin**, **Registration Portal**, and **Public Website** use the same pillars, but scope routes under `apps/admin-console`, `apps/registration-portal`, and `apps/public-website` respectively. Prefer each app’s Playwright/Vitest layout when present; do not invent web-dashboard routes for those products.

## Related paths

- Playwright: `apps/web/e2e/`, `apps/web/playwright.config.ts`; admin-console: `apps/admin-console/e2e/`, `apps/admin-console/playwright.config.ts`
- Captures: `apps/web/scripts/capture-screens.mjs`
- Tenant gate: `tools/tenant-isolation-tests/`
- DoD: `tools/dod-checks/`
- Lighthouse: `tools/scripts/check-lighthouse.mjs`, `apps/web/lighthouserc.cjs`
- Checklist template: `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`
- Hooks: `.cursor/hooks.json`, `.cursor/hooks/enterprise-test-gate.cjs`
- Flutter audit: `docs/audits/MOBILE_FLUTTER_ENTERPRISE.md`
- Auth audit: `docs/audits/AUTH_LOGIN_SIGNUP_MFA_RESET.md`
- Insights audit: `docs/audits/INSIGHTS_SYSTEM_REPORTS_WAREHOUSE_ADMIN_TRACK.md`
- Platform Admin audit: `docs/audits/ADMIN_CONSOLE_PLATFORM.md`
- Registration Portal audit: `docs/audits/REGISTRATION_PORTAL_HOME_SCHOOLS_APPLY_TRACK.md`
- Public Website audit: `docs/audits/PUBLIC_WEBSITE_HOME_PRODUCT_LEGAL_CONTACT.md`
- Workflows audit: `docs/audits/WORKFLOWS_DEFINITIONS_INSTANCES_APPROVALS.md`
