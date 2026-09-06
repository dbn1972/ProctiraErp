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

| Journey                             | Spec file                                                                   | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                                  |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------- | ------- | ------ | ----------------------------------------- |
| Public login / forbidden / redirect | `apps/admin-console/e2e/01-platform-admin-smoke.spec.ts`                    | N/A public                   | ☐       | ☐      | Spec added                                |
| Inventory 200 + h1 (stub JWT)       | `apps/admin-console/e2e/02-platform-admin-inventory-smoke.spec.ts`          | N/A ungated                  | ☐       | ☐      | Always runs; fake `platform_admin` cookie |
| Tenant provision validation         | `apps/admin-console/e2e/03-tenant-write-validation-smoke.spec.ts`           | N/A ungated                  | ☐       | ☐      | Zod field errors                          |
| Break-glass / plugin validation     | `apps/admin-console/e2e/04-break-glass-plugin-write-validation-smoke.spec.ts` | N/A ungated                | ☐       | ☐      | Short justification / reason              |
| Authenticated live inventory        | `01-platform-admin-smoke.spec.ts`                                           | ☐ gated                      | ☐       | ☐      | Needs seeded operator + live gateway      |
| Negative / open-redirect            | unit + public e2e                                                           | ☑ unit                       | n/a     | n/a    | `return-to.test.ts`                       |

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

| Screen                                       | Desktop 1440   | Tablet 834 | Mobile 390 | Artifact path                                                                |
| -------------------------------------------- | -------------- | ---------- | ---------- | ---------------------------------------------------------------------------- |
| login / tenants / plans / health / audit / … | ☑ desktop pack | ☐          | ☐          | `/opt/cursor/artifacts/platform-admin-audit/` (13 PNGs; stub banner visible) |

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

| Gate                           | Pass | Link / SHA                                                                                                                                                                                              |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / unit        | ☑    | tip `e94ac2f` — [CI run 34010731801](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731801) (Lint/Typecheck/Unit/Build/Tenant/Bundle ✅)                                                      |
| Integration (if DB touched)    | N/A  | N/A — Integration skipped (no schema change on tip)                                                                                                                                                     |
| DoD / Lighthouse / tenant gate | ☑    | same tip — [DoD 34010731900](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731900) + Lighthouse on CI run ✅; [PR Check](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731742) ✅ |

---

## 7. Residual risks / waivers

1. **Live operator IdP / auth-service E2E** — live write journeys still gated on `E2E_BACKEND_READY`; ungated inventory smoke (`02-…`) covers 200+h1 with stub JWT; ungated tenant provision validation (`03-…`) + break-glass/plugin decision validation (`04-…`) cover zod field errors without claiming live ops.
2. **API stubs (residual)** — tenants/plans/plugins/themes/break-glass/support/health/audit clients still fall back to deterministic fixtures when the gateway is unreachable. UI shows **Stub / demo mode** banner when `source === 'stub'` (prefer real gateway source when reachable). Do not treat stub KPIs as production metrics.
3. **Write paths offline** — tenant provision, plugin/theme decisions, and break-glass create/approve can succeed against stubs without creating live schema, marketplace, or elevated sessions.
4. **Tablet/mobile + axe packs** — desktop pack filled; tablet/mobile/axe still thin.
5. **JWT signature** — middleware/session decode structure + expiry only; signature verified upstream.
6. **Deploy registry** — infra Build Images failures are not feature blockers.

**Verdict:** Ready with waivers — stub honesty + ungated inventory/`03`/`04` write-validation smokes + desktop shot pack; **live gateway wiring still required** before production claim. Module score campaign: **7.6 → ~8.1**.
