# Enterprise module test — Insights & System

**Module:** Insights & System (Reports / Data warehouse / Admin / Public track)  
**Branch / tip:** `cursor/insights-system-enterprise-56c3`  
**Environment:** App Router + gateway (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-05  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label                      | Route                           | Roles           | PII/PHI              | Notes                    |
| ------------------------------ | ------------------------------- | --------------- | -------------------- | ------------------------ |
| Reports · catalog              | `/reports`                      | report UI roles | Medium (aggregates)  | List templates           |
| Reports · builder              | `/reports/new`                  | report UI roles | Low                  | Write scaffold           |
| Reports · result               | `/reports/[id]/results`         | report UI roles | Medium               | Seeded id in e2e         |
| Data warehouse · overview      | `/data-warehouse`               | DW roles        | Low                  | Indicators + CTAs        |
| Data warehouse · import        | `/data-warehouse/import`        | DW roles        | Medium               | Source + history         |
| Data warehouse · field mapping | `/data-warehouse/field-mapping` | DW roles        | Medium               | Column → field (not GIS) |
| Data warehouse · GIS map       | `/data-warehouse/map`           | DW roles        | Low                  | Geo features             |
| Admin · overview               | `/admin`                        | tenant admin    | Medium               | Hub cards                |
| Admin · users                  | `/admin/users`                  | tenant admin    | High (accounts)      |                          |
| Admin · roles                  | `/admin/roles`                  | tenant admin    | Low                  |                          |
| Admin · permissions            | `/admin/permissions`            | tenant admin    | Low                  | Matrix                   |
| Admin · tenant                 | `/admin/tenant`                 | tenant admin    | Medium               | Settings                 |
| Public · track                 | `/track`                        | public          | Medium (application) | Unauthenticated          |

---

## 1. Functionality

| Screen                          | Load OK        | Empty/loading/error | Write path or N/A                        | Evidence                  |
| ------------------------------- | -------------- | ------------------- | ---------------------------------------- | ------------------------- |
| `/reports*`                     | ☑ routes exist | ☑ empty catalog     | Builder form                             | App Router pages          |
| `/data-warehouse`               | ☑              | ☑ empty indicators  | N/A list                                 | Page + KPI placeholders   |
| `/data-warehouse/import`        | ☑              | ☑ empty jobs        | Upload UI (scaffold)                     | Continue to mapping CTA   |
| `/data-warehouse/field-mapping` | ☑              | ☑ demo columns      | Mapping form scaffold; validate disabled | New route                 |
| `/data-warehouse/map`           | ☑              | ☑ empty geo         | N/A read                                 | GIS distinct from mapping |
| `/admin*`                       | ☑              | ☑                   | N/A / settings forms                     | Nested under `/admin`     |
| `/track`                        | ☑              | ☑ empty form        | Lookup                                   | Existing `08` + a11y      |

Backend unit/property: ☑ pass — `packages/backend/data-warehouse` vitest (local).

---

## 2. E2E (Playwright)

| Journey              | Spec file                                 | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                           |
| -------------------- | ----------------------------------------- | ---------------------------- | ------- | ------ | ---------------------------------- |
| Smoke routes         | `apps/web/e2e/13-insights-system.spec.ts` | ☐ gated                      | ☐       | ☐      | Spec added                         |
| Public track         | same (no backend describe)                | N/A                          | ☐       | ☐      | Always runnable                    |
| Negative / forbidden | deferred                                  | ☐                            | n/a     | n/a    | Waiver: permission matrix write UI |

---

## 3. UX / a11y

| Check                              | Pass                             | Evidence                                         |
| ---------------------------------- | -------------------------------- | ------------------------------------------------ |
| axe WCAG 2.1 AA on module routes   | ☐                                | Pending live axe; `/track` covered in `a11y-axe` |
| Dark mode parity                   | ☑ routes listed                  | Extended `dark-mode-parity.spec.ts`              |
| Touch targets ≥44px / ≥48px mobile | ☑ routes listed                  | Extended `touch-target-minimum.spec.ts`          |
| RTL smoke (if locale enabled)      | ☐                                | Not extended this pass                           |
| Keyboard / focus                   | ☑ primary CTAs are links/buttons | Mapping selects labeled                          |

---

## 4. Multidevice captures

| Screen                       | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                         |
| ---------------------------- | ------------ | ---------- | ---------- | ------------------------------------- |
| reports / DW / admin / track | ☐            | ☐          | ☐          | `capture-screens.mjs` TARGETS updated |

Horizontal scroll / clipped CTA issues: not yet visually verified (capture pending host run).

---

## 5. Security

| Check                                  | Pass               | Evidence                                   |
| -------------------------------------- | ------------------ | ------------------------------------------ |
| Unauthenticated redirect               | ☑ dashboard layout | `requireSession` on `(dashboard)`          |
| RBAC deny / hide                       | ☐                  | Waiver: full permission matrix UI deferred |
| Cross-tenant IDOR blocked (API)        | ☐                  | Cite DW/reports package tests when live    |
| Cross-tenant IDOR blocked (UI)         | ☐                  | Relies on API tenant filter                |
| No secrets/PHI leaked in git artifacts | ☑                  | Demo column samples only                   |
| Tenant isolation suite cited/run       | ☐                  | Waiver: UI scaffolding only this PR        |

---

## 6. CI / production gates

| Gate                                           | Pass             | Link / SHA                      |
| ---------------------------------------------- | ---------------- | ------------------------------- |
| Lint / typecheck / unit                        | ☐ pending tip CI | Prettier tip files before merge |
| Integration (if DB touched)                    | N/A              | no schema change                |
| DoD / Lighthouse / tenant gate (as applicable) | ☐                | After PR push                   |

---

## 7. Residual risks / waivers

1. **Live IdP / backend E2E** — gated on `E2E_BACKEND_READY`; smoke spec present.
2. **Import write path** — upload + validate + run not wired to Server Actions yet.
3. **Permission matrix mutations** — read/inspect UI only this pass.
4. **Deploy registry** — infra failure when Build Images runs; not a feature blocker.
5. **Multidevice PNG pack** — TARGETS ready; capture when web+auth token host available.

**Verdict:** Scaffolding + route fix (field mapping ≠ GIS) + enterprise evidence hooks Ready with waivers above.
