# Enterprise module test — Workflows

**Module:** Workflows  
**Branch / tip:** `cursor/workflows-enterprise-e2e-56c3`  
**Environment:** gateway in-process seed + App Router (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-05  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Workflows · definitions | `/workflows` | workflow UI roles | Low (process metadata) | Seeded list |
| Workflows · new definition | `/workflows/definitions/new` | workflow UI roles | Low | Write path wired |
| Workflows · definition detail | `/workflows/definitions/[id]` | workflow UI roles | Low | Seeded transfer def |
| Workflows · instances | `/workflows/instances` | workflow UI roles | Medium (subject ids) | Seeded pending + done |
| Workflows · my approvals | `/workflows/approvals` | workflow UI roles | Medium | Approve/reject wired |

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/workflows` | ☑ | ☑ empty state | N/A list | UI + seed |
| `/workflows/definitions/new` | ☑ | ☑ validation | Create definition | Server Action + POST |
| `/workflows/definitions/[id]` | ☑ | ☑ 404 via null | N/A read | Seeded UUID |
| `/workflows/instances` | ☑ | ☑ empty copy | N/A list | Seed |
| `/workflows/approvals` | ☑ | ☑ caught-up empty | Approve / Reject | Decision buttons |

Backend unit/property: ☑ pass — `pnpm exec vitest run src/workflow-ui-plugin.test.ts` (6/6) on api-gateway host.

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Inventory smoke (ungated) | `apps/web/e2e/18-workflows-inventory-smoke.spec.ts` | N/A — always runs | ☐ CI | ☐ | Unauthenticated → `/login` + body/heading |
| Smoke routes (authenticated) | `apps/web/e2e/12-workflows.spec.ts` | ☐ gated | ☐ | ☐ | Spec added; run when gateway+web up on same host |
| Authenticated inventory (optional) | `18-…` second describe | ☐ gated | ☐ | ☐ | Headings when backend ready |
| Happy path create | `12-…` (form fields) | ☐ | ☐ | ☐ | Form wired |
| Negative / forbidden | gateway Vitest 403/400 | ☑ | n/a | n/a | Unit inject tests |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ | Pending live axe with backend |
| Dark mode parity | ☑ routes listed | `dark-mode-parity.spec.ts` |
| Touch targets ≥44px / ≥48px mobile | ☑ routes listed | `touch-target-minimum.spec.ts` |
| RTL smoke (if locale enabled) | ☐ | Not extended this pass |
| Keyboard / focus | ☑ primary CTAs are buttons/links | Approval + create forms |

---

## 4. Multidevice captures

Screenshot pack path: `/opt/cursor/artifacts/workflows-audit/` (15 PNGs · authenticated 2026-09-06).

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| definitions | ☑ | ☑ | ☑ | `01-list(.tablet|.mobile).png` |
| new definition | ☑ | ☑ | ☑ | `02-definition-new*` |
| definition detail | ☑ | ☑ | ☑ | `03-definition-detail*` |
| instances | ☑ | ☑ | ☑ | `04-instances*` |
| approvals | ☑ | ☑ | ☑ | `05-approvals*` |

Horizontal scroll / clipped CTA: desktop pack reviewed — empty-state Create CTA fully visible.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☑ | Layout `requireSession` + ungated `18-…` |
| RBAC deny / hide | ☑ | Vitest 403 without workflow role |
| Cross-tenant IDOR blocked (API) | ☑ | Vitest empty list other tenant |
| Cross-tenant IDOR blocked (UI) | ☐ | Relies on API tenant filter |
| No secrets/PHI leaked in git artifacts | ☑ | Demo ids only |
| Tenant isolation suite cited/run | ☐ | Waiver: UI seed only, no Prisma workflow RLS yet |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ pending tip CI | gateway unit green locally |
| Integration (if DB touched) | N/A | in-memory UI seed |
| DoD / Lighthouse / tenant gate (as applicable) | ☐ | After PR push |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| UI aggregates are in-memory demo seed | Data resets on process restart; not Prisma | Platform | 2026-09-05 |
| Domain `@proctira/backend-workflow` engine not mounted | Federated SPA `/app/workflows` still separate contract | Platform | 2026-09-05 |
| Live Playwright gated on `E2E_BACKEND_READY` | Authenticated journeys may skip; ungated `18-…` inventory still asserts `/login` redirects | Agent | 2026-09-05 |
| In-memory demo seed only | Approvals/definitions reset on process restart | Platform | 2026-09-06 |

---

## Done criteria

- [x] Functionality + security unit evidence on server  
- [x] E2E spec + capture/dark/touch route lists updated  
- [x] Ungated inventory smoke (`18-workflows-inventory-smoke.spec.ts`)  
- [x] Walkthrough artifacts under `/opt/cursor/artifacts/workflows-audit/` (15 PNGs)  
- [ ] Tip CI green  

**Verdict:** ☑ Ready with waivers · ☐ Enterprise production-ready
