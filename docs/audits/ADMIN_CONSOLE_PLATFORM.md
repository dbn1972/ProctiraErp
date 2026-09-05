# Enterprise module test — Platform Admin Console

**Module:** Platform Admin Console (`apps/admin-console`)  
**Branch / tip:** `cursor/platform-admin-enterprise-56c3`  
**Environment:** App Router + auth cookies (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-05  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label            | Route                       | Roles                                | PII/PHI              | Notes                            |
| -------------------- | --------------------------- | ------------------------------------ | -------------------- | -------------------------------- |
| Operator login       | `/login`                    | public                               | Medium (credentials) | `sanitizeReturnTo` on post-login |
| 403 Forbidden        | `/forbidden`                | public                               | Low                  | Role-denied surface              |
| Platform overview    | `/`                         | any platform role                    | Low                  | Hub                              |
| Tenants              | `/tenants`                  | billing / platform_admin             | High                 | Lifecycle list                   |
| Provision tenant     | `/tenants/new`              | billing / platform_admin             | High                 | Write scaffold                   |
| Tenant detail        | `/tenants/[id]`             | billing / platform_admin             | High                 |                                  |
| Plans                | `/plans`, `/plans/[id]`     | billing / platform_admin             | Low                  |                                  |
| Plugins              | `/plugins`, `/plugins/[id]` | security / platform_admin            | Low                  |                                  |
| Themes               | `/themes`, `/themes/[id]`   | security / platform_admin            | Low                  |                                  |
| Break-glass          | `/break-glass`              | security / engineering / ops_support | Medium               | Request                          |
| Break-glass requests | `/break-glass/requests`     | security                             | Medium               | Approve queue                    |
| Support              | `/support`                  | ops_support                          | High (masquerade)    | BG-gated tooling                 |
| System health        | `/health`                   | ops / eng / security / billing       | Low                  |                                  |
| Audit log            | `/audit`                    | ops / eng / security / billing       | Medium               |                                  |

---

## 1. Functionality

| Screen             | Load OK   | Empty/loading/error | Write path or N/A          | Evidence                        |
| ------------------ | --------- | ------------------- | -------------------------- | ------------------------------- |
| `/login`           | ☑         | ☑ validation errors | Sign-in POST               | Form + route handler            |
| `/forbidden`       | ☑         | N/A                 | N/A                        | 403 copy                        |
| Inventory routes   | ☑ present | stub/empty states   | Many APIs `source: 'stub'` | App Router pages                |
| returnTo hardening | ☑         | N/A                 | N/A                        | `sanitizeReturnTo` + middleware |

Backend unit/property: ☑ pass — `pnpm --filter @proctira/admin-console test` (18/18 auth unit).

---

## 2. E2E (Playwright)

| Journey                             | Spec file                                                | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                      |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------- | ------- | ------ | ----------------------------- |
| Public login / forbidden / redirect | `apps/admin-console/e2e/01-platform-admin-smoke.spec.ts` | N/A public                   | ☐       | ☐      | Spec added                    |
| Authenticated inventory             | same                                                     | ☐ gated                      | ☐       | ☐      | Needs seeded operator session |
| Negative / open-redirect            | unit + public e2e                                        | ☑ unit                       | n/a     | n/a    | `return-to.test.ts`           |

---

## 3. UX / a11y

| Check                              | Pass                             | Evidence                                         |
| ---------------------------------- | -------------------------------- | ------------------------------------------------ |
| axe WCAG 2.1 AA on module routes   | ☐                                | Waiver: no axe suite wired this pass             |
| Dark mode parity                   | ☐                                | Tokens exist; no theme toggle / capture list yet |
| Touch targets ≥44px / ≥48px mobile | ☐                                | Buttons often 48px; nav links not audited        |
| RTL smoke                          | ☐                                | Not extended                                     |
| Keyboard / focus                   | ☑ primary login controls labeled | Login form                                       |

---

## 4. Multidevice captures

| Screen                  | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path        |
| ----------------------- | ------------ | ---------- | ---------- | -------------------- |
| login / forbidden / hub | ☐            | ☐          | ☐          | Pending host capture |

Horizontal scroll / clipped CTA: not visually verified this pass.

---

## 5. Security

| Check                            | Pass   | Evidence                                          |
| -------------------------------- | ------ | ------------------------------------------------- |
| Unauthenticated redirect         | ☑      | Middleware → `/login?returnTo=…`                  |
| Open-redirect blocked            | ☑      | `sanitizeReturnTo` on login + middleware + logout |
| RBAC deny / hide                 | ☑ unit | `hasRole` matrix tests; `/forbidden` UI           |
| Cross-tenant IDOR blocked (API)  | ☐      | Waiver: stub APIs; live gateway not exercised     |
| No secrets/PHI in git artifacts  | ☑      | Demo-only                                         |
| Tenant isolation suite cited/run | ☐      | N/A platform console (not tenant SIS)             |

---

## 6. CI / production gates

| Gate                           | Pass             | Link / SHA         |
| ------------------------------ | ---------------- | ------------------ |
| Lint / typecheck / unit        | ☐ pending tip CI | Local vitest 18/18 |
| Integration (if DB touched)    | N/A              | no schema change   |
| DoD / Lighthouse / tenant gate | ☐                | After PR push      |

---

## 7. Residual risks / waivers

1. **Live operator IdP / auth-service E2E** — authenticated inventory gated; public smokes always runnable once Playwright deps installed.
2. **API stubs** — many list/detail pages still use stub data (`source: 'stub'`).
3. **Dark / axe / mobile capture packs** — not wired for admin-console this pass.
4. **JWT signature** — middleware/session decode structure + expiry only; signature verified upstream.
5. **Deploy registry** — infra Build Images failures are not feature blockers.

**Verdict:** Auth harden + enterprise evidence hooks **Ready with waivers** above.
