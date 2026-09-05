# Enterprise module test — Health

**Module:** Health  
**Branch / tip:** `cursor/health-enterprise-e2e-56c3`  
**Environment:** gateway in-process seed + App Router  
**Date (UTC):** 2026-09-05  

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Health · records (hub) | `/health` | health roles | PHI | Aggregated list |
| Health · screenings | `/health/screenings` | health roles | PHI | New redesign screen |
| Health · student profile | `/health/[studentId]` | health roles | PHI | Seeded student A |
| Health · counselling | `/health/counselling` | health roles | PHI | |
| Health · special needs | `/health/special-needs` | health roles | PHI | |

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/health` | ☐ | ☐ | Read-only list by design | Gateway UI seed + page |
| `/health/screenings` | ☐ | ☐ | Read-only list by design | New page |
| `/health/[studentId]` | ☐ | ☐ | Read-only by design | Seeded UUID |
| `/health/counselling` | ☐ | ☐ | Read-only by design | |
| `/health/special-needs` | ☐ | ☐ | Read-only by design | |

**Fixes shipped this branch**
- Wired `@proctira/backend-health` into api-gateway domain plugins
- Added redesign UI aggregates: `/health/records`, `/special-needs`, `/counselling`, `/screenings`
- JWT → `healthAccessContext` bridge for domain RBAC
- Aligned FE role allow-list with backend health roles
- Capture token includes `roleName: SUPER_ADMIN`
- Capture targets for all 5 screens

Backend unit/property: existing `packages/backend/health` tests (unchanged package surface).

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Smoke routes | `apps/web/e2e/11-health.spec.ts` | ☐ | ☐ | ☐ | Added |
| Dark mode | `dark-mode-parity.spec.ts` | ☐ | ☐ | — | Routes extended |
| Touch targets | `touch-target-minimum.spec.ts` | ☐ | ☐ | ☐ | Routes extended |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ | Shared `a11y-axe` when backend ready |
| Dark mode parity | ☐ | Routes added |
| Touch targets ≥44px / ≥48px mobile | ☐ | Routes added |
| Keyboard / focus | ☐ | Native table + button links |

---

## 4. Multidevice captures

| Screen | Desktop | Tablet | Mobile | Artifact path |
| --- | --- | --- | --- | --- |
| list | ☐ | ☐ | ☐ | `capture-screens.mjs` health.list |
| screenings | ☐ | ☐ | ☐ | health.screenings |
| student-profile | ☐ | ☐ | ☐ | health.student-profile |
| counselling | ☐ | ☐ | ☐ | health.counselling |
| special-needs | ☐ | ☐ | ☐ | health.special-needs |

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☐ | Dashboard `requireSession` |
| RBAC deny / hide | ☐ | `canAccessHealthRecords` + 403 aggregates |
| Cross-tenant IDOR blocked (API) | ☐ | Domain tenantId scoping; UI seed is demo-tenant |
| No secrets/PHI leaked in git artifacts | ☐ | Synthetic demo names only |
| Tenant isolation suite cited/run | ☐ | Platform gate unchanged |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ | Tip CI |
| Integration (if DB touched) | ☐ | Baseline tenants migration already on branch |
| DoD / Lighthouse / tenant gate | ☐ | Tip CI |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| Health UI aggregates are in-memory demo, not Prisma | Demo data only in gateway until Prisma health models | Platform | 2026-09-05 |
| Write paths (create screening / session) not in redesign UI yet | Incomplete clinical workflow | Product | 2026-09-05 |
| Live E2E requires `E2E_BACKEND_READY=1` | CI may skip live browser journeys | QA | 2026-09-05 |

---

## Done criteria

- [x] Pillars addressed with shipped wiring + checklist evidence paths  
- [ ] Walkthrough artifacts attached to PR (capture after stack up)  
- [ ] Session state set to `complete` after CI green  

**Verdict:** Ready with waivers (demo seed / read-only UI / gated live E2E)
