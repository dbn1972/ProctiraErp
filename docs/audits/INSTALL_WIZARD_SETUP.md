# Enterprise module test — Install Wizard

**Module:** Other Portals · Install wizard (`apps/install-wizard`)  
**Branch / tip:** `cursor/other-portals-enterprise-56c3`  
**Environment:** App Router first-run wizard (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-05  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label (redesign) | Route / step                         | Roles            | PII/PHI | Notes                                      |
| -------------------- | ------------------------------------ | ---------------- | ------- | ------------------------------------------ |
| Install wizard       | `/` (multi-step client)              | bootstrap / local | High   | Secrets + admin password in first-run UI   |
| Step · Database      | in-page                              | same             | High    | DB credentials                             |
| Step · Storage       | in-page                              | same             | High    | S3/MinIO keys                              |
| Step · Cache         | in-page                              | same             | Medium  | Redis                                      |
| Step · Queue         | in-page                              | same             | Medium  | Broker URLs                                |
| Step · CDN           | in-page                              | same             | Low     | CDN base URL                               |
| Step · Admin         | in-page                              | same             | High    | Admin email/password + tenant              |
| Step · Complete      | in-page when all done                | same             | Low     | CTA → web app login via env                |
| Health               | `/api/health`                        | public           | Low     | Docker HEALTHCHECK                         |

---

## 1. Functionality

| Screen / step   | Load OK | Empty/loading/error        | Write path or N/A                         | Evidence                         |
| --------------- | ------- | -------------------------- | ----------------------------------------- | -------------------------------- |
| Wizard home     | ☑       | ☑ Step 1 form              | Client validation + API client            | Playwright smoke                 |
| Admin validation| ☑       | ☑ field errors             | Shared `validateAdminAccount`             | Vitest                           |
| API client      | ☑       | ☑ non-OK → failed result   | `postConfig` / `finalize` harden          | Vitest                           |
| Footer / CTA    | ☑       | N/A                        | Docs/support + `getWebAppLoginUrl()`      | Smoke + site helpers             |

Backend unit/property: ☑ — `pnpm --filter @proctira/install-wizard test`

---

## 2. E2E (Playwright)

| Journey            | Spec file                             | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence             |
| ------------------ | ------------------------------------- | ---------------------------- | ------- | ------ | -------------------- |
| First-run smoke    | `e2e/01-install-wizard-smoke.spec.ts` | N/A                          | ☑       | ☐      | Local chromium smoke |
| Live install API   | same (gated)                          | ☐ not available              | ☐       | ☐      | Waived without stack |

---

## 3. UX / a11y

| Check            | Pass                    | Evidence                             |
| ---------------- | ----------------------- | ------------------------------------ |
| axe WCAG 2.1 AA  | ☐                       | Waiver: no axe suite in this app yet |
| Dark mode parity | ☐                       | Not wired                            |
| Touch targets    | ☐                       | Residual                             |
| Keyboard / focus | ☑ labeled Step 1 fields | Host / form labels                   |

---

## 4. Multidevice captures

| Screen          | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                                |
| --------------- | ------------ | ---------- | ---------- | -------------------------------------------- |
| Wizard Step 1   | ☑            | ☑          | ☑          | `/opt/cursor/artifacts/other-portals-audit/` |

---

## 5. Security

| Check                                      | Pass | Evidence                                           |
| ------------------------------------------ | ---- | -------------------------------------------------- |
| Shared admin validation                    | ☑    | `src/lib/admin-validation.ts`                      |
| Non-OK configure/finalize not treated OK   | ☑    | `api-client.ts`                                    |
| Complete CTA not dead `/login` on wizard   | ☑    | `getWebAppLoginUrl()` → docs fallback              |
| Footer not `#docs` / `#support` stubs      | ☑    | `getInstallDocsUrl` / `getInstallSupportUrl`       |
| Network exposure / bootstrap lock          | ☐    | Residual — must be localhost / one-time lock in prod |
| CSRF / install-token on Next app           | ☐    | Relies on backend; residual                        |
| No secrets in git                          | ☑    |                                                    |

---

## 6. CI / production gates

| Gate                    | Pass | Link / SHA             |
| ----------------------- | ---- | ---------------------- |
| Lint / typecheck / unit | ☑    | Local vitest/tsc green; tip CI after PR |
| Integration             | N/A  | no schema change       |
| DoD / Lighthouse        | ☐    | After PR push          |

---

## 7. Residual risks / waivers

1. First-run UI posts DB/S3/Redis/queue secrets + admin password — **must not** be exposed beyond localhost / one-time bootstrap lock.
2. No CSRF or install-token on the Next surface; depends on install API hardening.
3. Live configure/finalize E2E gated and not run without `E2E_BACKEND_READY` stack.
4. Password policy is length ≥8 only (no complexity).
5. No axe / dark suite in this app yet.
6. Dockerfile already creates empty `public/` at runtime (no COPY landmine).

**Verdict:** Ready with waivers above for the shipped first-run UI + validation + smoke.
