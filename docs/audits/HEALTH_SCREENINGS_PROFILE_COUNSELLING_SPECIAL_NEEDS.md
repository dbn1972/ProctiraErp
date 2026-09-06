# Enterprise module test — Health

**Module:** Health  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** gateway in-process seed + App Router  
**Date (UTC):** 2026-09-06

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label                | Route                       | Roles        | PII/PHI | Notes                          |
| ------------------------ | --------------------------- | ------------ | ------- | ------------------------------ |
| Health · records (hub)   | `/health`                   | health roles | PHI     | Aggregated list                |
| Health · screenings      | `/health/screenings`        | health roles | PHI     | New redesign screen            |
| Health · student profile | `/health/[studentId]`       | health roles | PHI     | Seeded student A               |
| Health · counselling     | `/health/counselling`       | health roles | PHI     | List + Schedule CTA            |
| Health · schedule session| `/health/counselling/new`   | health roles | PHI     | Create form → domain POST      |
| Health · special needs   | `/health/special-needs`     | health roles | PHI     |                                |

---

## 1. Functionality

| Screen                      | Load OK | Empty/loading/error | Write path or N/A                         | Evidence                          |
| --------------------------- | ------- | ------------------- | ----------------------------------------- | --------------------------------- |
| `/health`                   | ☐       | ☐                   | Read-only list by design                  | Gateway UI seed + page            |
| `/health/screenings`        | ☐       | ☐                   | Read-only list by design                  | New page                          |
| `/health/[studentId]`       | ☐       | ☐                   | Read-only by design                       | Seeded UUID                       |
| `/health/counselling`       | ☐       | ☐                   | CTA → create                              | Schedule session link             |
| `/health/counselling/new`   | ☑       | client validation   | **POST `/health/counselling/sessions`**   | Form + server action + API client |
| `/health/special-needs`     | ☐       | ☐                   | Read-only by design                       |                                   |

**Fixes shipped this branch**

- Wired `@proctira/backend-health` into api-gateway domain plugins
- Added redesign UI aggregates: `/health/records`, `/special-needs`, `/counselling`, `/screenings`
- JWT → `healthAccessContext` bridge for domain RBAC
- Aligned FE role allow-list with backend health roles
- Capture token includes `roleName: SUPER_ADMIN`
- Capture targets for all 5 screens
- **2026-09-06:** Counselling create UI at `/health/counselling/new` posting to existing domain `POST /health/counselling/sessions` via `createCounsellingSession` + server action; client UUID/date/required-field validation before submit

Backend unit/property: existing `packages/backend/health` tests (unchanged package surface).

---

## 2. E2E (Playwright)

| Journey                            | Spec file                                        | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                                  |
| ---------------------------------- | ------------------------------------------------ | ---------------------------- | ------- | ------ | ----------------------------------------- |
| Inventory smoke (ungated)          | `apps/web/e2e/17-health-inventory-smoke.spec.ts` | N/A — always runs            | ☐ CI    | ☐      | Unauthenticated → `/login` + body/heading |
| Create route in inventory          | `17-…` counselling-create path                   | N/A — always runs            | ☐ CI    | ☐      | `/health/counselling/new` → `/login`      |
| Smoke routes (authenticated)       | `apps/web/e2e/11-health.spec.ts`                 | ☐ gated                      | ☐       | ☐      | Skips without backend                     |
| Authenticated inventory (optional) | `17-…` second describe                           | ☐ gated                      | ☐       | ☐      | Headings when backend ready               |
| Authenticated create form fields   | `17-…` counselling create form test              | ☐ gated                      | ☐       | ☐      | Form labels + Schedule button             |
| Dark mode                          | `dark-mode-parity.spec.ts`                       | ☐                            | ☐       | —      | Routes extended                           |
| Touch targets                      | `touch-target-minimum.spec.ts`                   | ☐                            | ☐       | ☐      | Routes extended                           |

---

## 3. UX / a11y

| Check                              | Pass | Evidence                             |
| ---------------------------------- | ---- | ------------------------------------ |
| axe WCAG 2.1 AA on module routes   | ☐    | Shared `a11y-axe` when backend ready |
| Dark mode parity                   | ☐    | Routes added                         |
| Touch targets ≥44px / ≥48px mobile | ☐    | Routes added                         |
| Keyboard / focus                   | ☐    | Native table + button links          |
| Create form labelled fields        | ☑    | `aria-label` on form + FormField ids |

---

## 4. Multidevice captures

Screenshot pack path: `/opt/cursor/artifacts/health-audit/` (15 PNGs · authenticated 2026-09-06).

| Screen          | Desktop | Tablet | Mobile | Artifact path         |
| --------------- | ------- | ------ | ------ | --------------------- |
| list            | ☑       | ☑      | ☑      | `01-list*`            |
| counselling     | ☑       | ☑      | ☑      | `02-counselling*`     |
| special-needs   | ☑       | ☑      | ☑      | `03-special-needs*`   |
| screenings      | ☑       | ☑      | ☑      | `04-screenings*`      |
| student-profile | ☑       | ☑      | ☑      | `05-student-profile*` |

Residual: create (`/health/counselling/new`) not yet in capture-screens TARGETS pack.

---

## 5. Security

| Check                                  | Pass | Evidence                                        |
| -------------------------------------- | ---- | ----------------------------------------------- |
| Unauthenticated redirect               | ☑    | Dashboard `requireSession` + ungated `17-…`     |
| RBAC deny / hide                       | ☐    | `canAccessHealthRecords` + 403 aggregates       |
| Cross-tenant IDOR blocked (API)        | ☐    | Domain tenantId scoping; UI seed is demo-tenant |
| No secrets/PHI leaked in git artifacts | ☑    | Synthetic demo names only in PNG pack           |
| Tenant isolation suite cited/run       | ☐    | Platform gate unchanged                         |

---

## 6. CI / production gates

| Gate                           | Pass | Link / SHA                                                                                                                                                                                              |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / unit        | ☑    | tip `e94ac2f` — [CI run 34010731801](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731801) (Lint/Typecheck/Unit/Build/Tenant/Bundle ✅)                                                      |
| Integration (if DB touched)    | N/A  | N/A — Integration skipped (no schema change on tip)                                                                                                                                                     |
| DoD / Lighthouse / tenant gate | ☑    | same tip — [DoD 34010731900](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731900) + Lighthouse on CI run ✅; [PR Check](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731742) ✅ |

---

## 7. Residual risks / waivers

| Item                                                            | Risk                                                                                       | Owner    | Waiver date |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- | ----------- |
| Health UI aggregates are in-memory demo, not Prisma             | Demo data only in gateway until Prisma health models                                       | Platform | 2026-09-05  |
| Create session list refresh vs UI seed mismatch                 | Domain POST writes in-memory repo; list still reads UI seed aggregate                      | Product  | 2026-09-06  |
| Live E2E requires `E2E_BACKEND_READY=1`                         | Authenticated journeys may skip; ungated `17-…` inventory still asserts `/login` redirects | QA       | 2026-09-05  |
| Create form capture pack incomplete                             | Multidevice PNGs for `/health/counselling/new` not yet in health-audit pack                | QA       | 2026-09-06  |

---

## Done criteria

- [x] Pillars addressed with shipped wiring + checklist evidence paths
- [x] Ungated inventory smoke (`17-health-inventory-smoke.spec.ts`) including create route
- [x] Counselling create form posts to existing health API
- [x] Walkthrough artifacts under `/opt/cursor/artifacts/health-audit/` (15 PNGs)
- [ ] Session state set to `complete` after CI green

**Verdict:** Ready with waivers (demo seed / list-vs-write residual / gated live E2E; ungated inventory + create UI + multidevice list pack)

## 2026-09-06 counselling uplift

- Create UI + API client + server action shipped
- Honest counselling screen score ~**8.5** (write path present; live authenticated create journey still gated; UI list seed not yet synced to domain writes)
