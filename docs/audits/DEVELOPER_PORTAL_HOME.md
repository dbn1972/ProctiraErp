# Enterprise module test — Developer Portal

**Module:** Other Portals · Developer portal (`apps/developer-portal`)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router marketing + real docs/dashboard/marketplace surfaces (honesty demo for key mint / install)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label (redesign) | Route          | Roles  | PII/PHI | Notes                                        |
| -------------------- | -------------- | ------ | ------- | -------------------------------------------- |
| Developer portal     | `/`            | public | Low     | Marketing landing + brand hero               |
| Docs (linked)        | `/docs`        | public | Low     | Real docs hub (no ComingSoon)                |
| Dashboard (linked)   | `/dashboard`   | public | Low     | Client API-key demo; live mint not connected |
| Marketplace (linked) | `/marketplace` | public | Low     | Static catalog; install/publish honesty-demo |
| Health               | `/api/health`  | public | Low     | Docker HEALTHCHECK JSON                      |

---

## 1. Functionality

| Screen      | Load OK | Empty/loading/error | Write path or N/A                       | Evidence              |
| ----------- | ------- | ------------------- | --------------------------------------- | --------------------- |
| Home        | ☑       | ☑ marketing         | N/A                                     | Playwright smoke      |
| Docs        | ☑       | ☑ docs hub          | N/A                                     | Destub page + smoke   |
| Dashboard   | ☑       | ☑ honesty banner    | Client validation + demo ack (not live) | `api-key-demo-form`   |
| Marketplace | ☑       | ☑ static catalog    | Install CTAs honesty-demo               | `marketplace-catalog` |
| Health      | ☑       | N/A                 | N/A                                     | `/api/health` smoke   |

Backend unit/property: ☑ — `pnpm --filter @proctira/developer-portal test` (health contract)

---

## 2. E2E (Playwright)

| Journey         | Spec file                               | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence             |
| --------------- | --------------------------------------- | ---------------------------- | ------- | ------ | -------------------- |
| Route inventory | `e2e/01-developer-portal-smoke.spec.ts` | N/A                          | ☑       | ☐      | Local chromium smoke |
| Live API keys   | same (gated)                            | ☐ not available              | ☐       | ☐      | Waived — no IdP      |

---

## 3. UX / a11y

| Check            | Pass                          | Evidence                             |
| ---------------- | ----------------------------- | ------------------------------------ |
| axe WCAG 2.1 AA  | ☐                             | Waiver: no axe suite in this app yet |
| Dark mode parity | ☐                             | Not wired                            |
| Touch targets    | ☐                             | Residual — primary CTAs mostly ≥40px |
| Keyboard / focus | ☑ primary nav + form controls | Semantic links + h1 on every route   |

---

## 4. Multidevice captures

| Screen      | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                                |
| ----------- | ------------ | ---------- | ---------- | -------------------------------------------- |
| Home        | ☑            | ☑          | ☑          | `/opt/cursor/artifacts/other-portals-audit/` |
| Docs        | ☑            | ☑          | ☑          | same                                         |
| Dashboard   | ☑            | ☑          | ☑          | same                                         |
| Marketplace | ☑            | ☑          | ☑          | same                                         |

---

## 5. Security

| Check                         | Pass | Evidence                                   |
| ----------------------------- | ---- | ------------------------------------------ |
| No fake login / open redirect | ☑    | No auth middleware; public surfaces only   |
| Health is public (expected)   | ☑    | Docker HEALTHCHECK                         |
| Docker `public/` present      | ☑    | `apps/developer-portal/public/.gitkeep`    |
| Dev port aligns with Docker   | ☑    | `next dev --port 3005` matches `PORT=3005` |
| Cross-tenant IDOR             | N/A  | No keyed resources yet                     |
| No secrets in git             | ☑    |                                            |

---

## 6. CI / production gates

| Gate                    | Pass | Link / SHA              |
| ----------------------- | ---- | ----------------------- |
| Lint / typecheck / unit | ☑    | Tip CI on uplift branch |
| Integration             | N/A  | no schema change        |
| DoD / Lighthouse        | ☐    | After PR push           |

---

## 7. Residual risks / waivers

1. Dashboard API-key flow is a **client demo** — live developer IdP / key minting is not connected.
2. Marketplace catalog is **static** — install/publish is honesty-demo only.
3. No axe / dark-mode suite in this app yet.
4. Live `E2E_BACKEND_READY` API-key journeys cannot run until developer auth ships.
5. Deploy registry empty `REGISTRY` infra failures are not feature blockers.

**Verdict:** Ready with waivers for shipped surface (home + docs + dashboard demo + marketplace catalog + health + Docker public).
