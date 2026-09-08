# Enterprise module test — Platform Admin Console

**Module:** Platform Admin Console (`apps/admin-console`)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router + live gateway platform-admin UI plugin  
**Date (UTC):** 2026-09-06  
**Module score:** **9.5 / 10**

---

## 0. Screen inventory

Operator login, overview, tenants (+ provision/detail), plans, plugins, themes, break-glass (+ requests), support, health, audit, forbidden — as prior inventory.

---

## 1. Functionality

- Clients **prefer live gateway**: when `response.status > 0`, do **not** invent stub rows (empty + `source: 'gateway'`).
- Stub fixtures only when gateway is unreachable (`status === 0`).
- In-process gateway plugin: `apps/api-gateway/src/platform-admin-ui-plugin.ts` serves tenants / plugins / break-glass / plans / themes / `/health/system` / `/audit` with write endpoints.

---

## 2. E2E

| Journey                         | Spec                                               | Gate                  |
| ------------------------------- | -------------------------------------------------- | --------------------- |
| Public smoke                    | `01-platform-admin-smoke.spec.ts`                  | public                |
| Inventory                       | `02-…`                                             | ungated               |
| Tenant write validation         | `03-…`                                             | ungated               |
| Break-glass / plugin validation | `04-…`                                             | ungated               |
| Expanded tenant/BG/plugin       | `05-tenant-breakglass-plugin-expand-smoke.spec.ts` | ungated + live prefer |

---

## 7. Residuals

1. Live operator IdP (signature-verified JWT) still residual — smokes use structured cookies.
2. Tablet/mobile + axe packs still thin vs desktop.
3. Support masquerade elevated sessions not fully exercised end-to-end.

**Verdict:** **9.5** with waivers — live gateway preferred + expanded smokes; residuals IdP / multidevice axe.
