# Enterprise module test checklist

**Module:** <!-- e.g. Health / Scholarships -->  
**Branch / tip:**  
**Environment:** <!-- local | EC3 tunnel | CI -->  
**Tester / agent:**  
**Date (UTC):**  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copy this file to `docs/audits/<MODULE>_<SCREENS>.md` and complete every section. Hooks treat missing evidence as incomplete.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| | ☐ | ☐ | ☐ | |

Backend unit/property: ☐ pass — command/log:

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Smoke routes | | ☐ | ☐ | ☐ | |
| Happy path | | ☐ | ☐ | ☐ | |
| Negative / forbidden | | ☐ | ☐ | ☐ | |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ | |
| Dark mode parity | ☐ | |
| Touch targets ≥44px / ≥48px mobile | ☐ | |
| RTL smoke (if locale enabled) | ☐ | |
| Keyboard / focus | ☐ | |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| | ☐ | ☐ | ☐ | |

Horizontal scroll / clipped CTA issues: none / listed:

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☐ | |
| RBAC deny / hide | ☐ | |
| Cross-tenant IDOR blocked (API) | ☐ | |
| Cross-tenant IDOR blocked (UI) | ☐ | |
| No secrets/PHI leaked in git artifacts | ☐ | |
| Tenant isolation suite cited/run | ☐ | |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ | |
| Integration (if DB touched) | ☐ | |
| DoD / Lighthouse / tenant gate (as applicable) | ☐ | |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| | | | |

---

## Done criteria

- [ ] All pillars have evidence **or** dated waivers above  
- [ ] Walkthrough artifacts attached to PR  
- [ ] Session state set to `complete` via hooks helper  

**Verdict:** ☐ Not ready · ☐ Ready with waivers · ☐ Enterprise production-ready
