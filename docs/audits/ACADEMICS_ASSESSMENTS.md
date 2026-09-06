# Enterprise module test — Academics · Assessments

**Module:** Academics — Assessments  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router `(dashboard)/assessments*` + gateway assessment API (`packages/backend/assessment`)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Assessments · schemes list | `/assessments` | `assessment.read` | Low | Grading scheme table |
| Assessments · new scheme | `/assessments/schemes/new` | `assessment.write` | Low | Create form → server action |
| Assessments · edit scheme | `/assessments/schemes/[id]/edit` | `assessment.write` | Low | Needs real scheme id |
| Assessments · items | `/assessments/items` | `assessment.read/write` | Low | Weights must sum to 100% |
| Assessments · results | `/assessments/results` | `assessment.write` | Medium (scores) | Bulk grid + Excel import |

API surface: `apps/web/src/lib/api/assessments.ts`, `apps/web/src/app/(dashboard)/assessments/actions.ts`, `apps/web/src/lib/validation/assessment-schema.ts`.

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/assessments` | ☑ code path | empty table CTA | N/A list | `listGradingSchemes` |
| `/assessments/schemes/new` | ☑ | zod field errors | `createGradingSchemeAction` | `grading-scheme-form.tsx` |
| `/assessments/schemes/[id]/edit` | ☑ when id exists | 404 / empty on bad id | `updateGradingSchemeAction` | edit page |
| `/assessments/items` | ☑ | empty until subject/period | `defineAssessmentItems` action | items form |
| `/assessments/results` | ☑ | empty until selectors | bulk entry + Excel import | `results-entry-grid.tsx` |

Backend unit/property: ☐ cite `packages/backend/assessment` Vitest when re-run — package present; not re-executed in this uplift pass.

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Inventory smoke (ungated) | `apps/web/e2e/21-assessments-inventory-smoke.spec.ts` | N/A — always runs | ☑ chromium | ☐ | Unauthenticated → `/login` (pass 2026-09-06) |
| Assessment + report card | `03-assessment-and-report-card.spec.ts` | ☐ gated | ☐ | ☐ | Live create/enter results |
| Authenticated inventory | `21-…` second describe | ☐ gated | ☐ | ☐ | Headings; edit may 404 without seed |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ gated | Hub not confirmed in axe authenticated set this pass |
| Dark mode parity | ☐ | Not confirmed for `/assessments*` this pass |
| Touch targets ≥44px / ≥48px mobile | ☐ | Not confirmed this pass |
| RTL smoke (if locale enabled) | ☐ | Not assessment-specific |
| Keyboard / focus | ☐ | Pending live pass on scheme/results forms |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| schemes list / new / items / results | ☐ | ☐ | ☐ | **No PNG pack invented** — capture not run this pass |
| schemes edit | ☐ | ☐ | ☐ | Needs seeded scheme id |

Horizontal scroll / clipped CTA issues: unknown without captures.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☑ | Middleware + ungated `21-assessments-inventory-smoke.spec.ts` |
| RBAC deny / hide | ☐ gated | Not assessment-specific in `09` matrix this pass |
| Cross-tenant IDOR blocked (API) | ☐ | Domain tenant scoping — cite when live |
| Cross-tenant IDOR blocked (UI) | ☐ | Relies on API |
| No secrets/PHI leaked in git artifacts | ☑ | No screenshots committed this pass |
| Tenant isolation suite cited/run | ☐ | Not re-run this pass |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ tip CI | After push |
| Integration (if DB touched) | N/A | Docs + ungated smoke |
| DoD / Lighthouse / tenant gate | ☐ | Tip CI |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| Live scheme/items/results E2E gated | Default CI skips without backend | QA | 2026-09-06 |
| Multidevice PNG pack missing | No visual evidence | QA | 2026-09-06 |
| Scheme edit inventory needs seed | Fake UUID may 404 when authenticated | QA | 2026-09-06 |
| Excel import size limits | 5000-row cap — not load-tested here | Platform | 2026-09-06 |

---

## Done criteria

- [x] Screen inventory for five assessment routes  
- [x] Ungated inventory smoke (`21-assessments-inventory-smoke.spec.ts`)  
- [ ] Multidevice PNGs  
- [ ] Live write journeys with `E2E_BACKEND_READY=1`  
- [ ] Session state `complete` after tip CI  

**Verdict:** ☐ Not ready · ☑ Ready with waivers (formal audit + ungated auth redirect smoke; live write/multidevice residual) · ☐ Enterprise production-ready
