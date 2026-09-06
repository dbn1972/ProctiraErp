# Enterprise module test — Public Website

**Module:** Public Website (`apps/public-website`)  
**Branch / tip:** `cursor/public-website-enterprise-56c3`  
**Environment:** App Router marketing site (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-05  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label    | Route           | Roles  | PII/PHI | Notes                                      |
| ------------ | --------------- | ------ | ------- | ------------------------------------------ |
| Home         | `/`             | public | Low     | Marketing landing                          |
| Product      | `/product`      | public | Low     | Feature overview                           |
| Installation | `/installation` | public | Low     | Developer / self-host docs                 |
| Security     | `/security`     | public | Low     | Footer primary                             |
| Compliance   | `/compliance`   | public | Low     | Footer / legal group                       |
| Status       | `/status`       | public | Low     | Honest pre-launch or optional STATUS_PROBE_* |
| About        | `/about`        | public | Low     | Mission / values (no lucide `Github` icon) |
| Contact      | `/contact`      | public | Medium  | Write path via `/api/contact`              |
| Legal hub    | `/legal`        | public | Low     | Legal notices                              |
| Privacy      | `/privacy`      | public | Low     | Privacy policy                             |
| Terms        | `/terms`        | public | Low     | Terms of service                           |
| Cookies      | `/cookies`      | public | Low     | Cookie policy                              |

---

## 1. Functionality

| Screen               | Load OK | Empty/loading/error | Write path or N/A                         | Evidence                 |
| -------------------- | ------- | ------------------- | ----------------------------------------- | ------------------------ |
| All inventory routes | ☑       | ☑ static marketing  | N/A except contact                        | Playwright smoke         |
| Contact form + API   | ☑       | ☑ validation errors | Shared validation + honeypot + optional webhook | Vitest + API route       |
| Header Login CTA     | ☑       | N/A                 | Points to `NEXT_PUBLIC_WEB_APP_URL/login` | Falls back to `/contact` |

Backend unit/property: ☑ — `pnpm --filter @proctira/public-website test`

---

## 2. E2E (Playwright)

| Journey          | Spec file                             | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence              |
| ---------------- | ------------------------------------- | ---------------------------- | ------- | ------ | --------------------- |
| Public inventory | `e2e/01-public-website-smoke.spec.ts` | N/A                          | ☑ 16/16 | ☐      | Local chromium smoke  |
| Contact API      | same                                  | ☑ local with env             | ☑       | ☐      | Accept + reject cases |

---

## 3. UX / a11y

| Check            | Pass                           | Evidence                               |
| ---------------- | ------------------------------ | -------------------------------------- |
| axe WCAG 2.1 AA  | ☐                              | Waiver: no axe suite in this app yet   |
| Dark mode parity | ☐                              | Not wired                              |
| Touch targets    | ☐                              | Residual — marketing CTAs mostly ≥40px |
| Keyboard / focus | ☑ primary nav + contact labels | Disclosure menu + labeled fields       |

---

## 4. Multidevice captures

| Screen          | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path        |
| --------------- | ------------ | ---------- | ---------- | -------------------- |
| marketing pages | ☐            | ☐          | ☐          | Pending host capture |

---

## 5. Security

| Check                                   | Pass | Evidence                                            |
| --------------------------------------- | ---- | --------------------------------------------------- |
| Contact validation shared client/server | ☑    | `src/lib/contact-validation.ts`                     |
| Honeypot + max lengths                  | ☑    | Form + API                                          |
| Process-local rate limit                | ☑    | `contact-rate-limit.ts` (not multi-replica durable) |
| No message body in logs                 | ☑    | Logs `messageLength` only                           |
| Dead `/login` removed from header       | ☑    | `getWebAppLoginUrl()`                               |
| Cross-tenant IDOR                       | N/A  | Public marketing surface                            |
| No secrets in git                       | ☑    |                                                     |

---

## 6. CI / production gates

| Gate                    | Pass | Link / SHA                                                                                                                                                                                              |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / unit | ☑    | tip `e94ac2f` — [CI run 34010731801](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731801) (Lint/Typecheck/Unit/Build/Tenant/Bundle ✅)                                                      |
| Integration             | N/A  | N/A — Integration skipped (no schema change on tip)                                                                                                                                                     |
| DoD / Lighthouse        | ☑    | same tip — [DoD 34010731900](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731900) + Lighthouse on CI run ✅; [PR Check](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731742) ✅ |

---

## 7. Residual risks / waivers

1. In-memory contact rate limit is not durable across replicas — use edge/WAF in production.
2. Contact API optionally forwards to `CONTACT_WEBHOOK_URL` (CRM/ticketing); without that env var it still accepts + stores locally (no invented CRM).
3. Status page uses honest pre-launch / local health-probe copy (not a fake “all green” provider).
4. No CSP headers / axe suite in this app yet.
5. Multidevice screenshot pack deferred to host capture.
6. Deploy registry infra failures are not feature blockers.

**Verdict:** Ready with waivers above. Module score campaign: **9.0 → ~9.3**.

## Screenshot pack (2026-09-06)

Filled `/opt/cursor/artifacts/public-website-audit/` (12 PNGs). Multidevice tablet/mobile still thin for this portal.
