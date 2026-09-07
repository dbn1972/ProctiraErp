# SIS Timetable — enterprise test checklist notes (WS1)

**Module:** Academics · Timetable / Bell / Substitutions  
**Branch / tip:** `cursor/sis-timetable-harden-56c3`  
**Environment:** cloud agent / local gateway  
**Tester / agent:** cloud SERVER agent  
**Date (UTC):** 2026-09-07  
**Paired DEV audit:** `docs/audits/DEV_SIS_TIMETABLE.md`  
**Harden:** `PRODUCT_SIS_TIMETABLE_HARDEN.md` · `SEC_SIS_TIMETABLE.md`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md` — started for WS1 smoke hand-off. Full 9.5 screen audit remains open until live write + multidevice evidence land.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Academic periods · Bell schedules | `/academic-periods/[id]/bell-schedules` | Registrar | No | Linked from periods list |
| Institutions · Timetable | `/institutions/[id]/timetable` | Registrar / Scheduler | Staff IDs | New institution tab |
| Staff · Substitutions | `/staff/substitutions` | Registrar | Staff IDs | |

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| Bell schedules | ☐ live | ☑ UI honesty | Create schedule/period actions | DEV audit §3 |
| Institution timetable | ☐ live | ☑ UI honesty | Create meeting → 409 on clash | Unit: clash helper |
| Substitutions | ☐ live | ☑ UI honesty | Create substitution → 409 | Unit: service test |

Backend unit/property: clash helper + service tests under `@proctira/backend-timetable`.

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Smoke routes → /login | `e2e/22-timetable-inventory-smoke.spec.ts` | ☐ gated suite | ☐ | ☐ | Ungated always |
| Happy path create | — | ☐ | ☐ | ☐ | Residual |
| Negative clash 409 | — | ☐ | ☐ | ☐ | Residual (unit covers domain) |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ | Residual |
| Dark mode parity | ☐ | Residual |
| Touch targets ≥44px | ☐ | Residual |
| RTL smoke | ☐ | Residual |
| Keyboard / focus | ☐ | Residual |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| Bell / Timetable / Subs | ☑ | ☑ | ☑ | `/opt/cursor/artifacts/sis-timetable-audit/*_{desktop,tablet,mobile}_*.png` |

Horizontal scroll / clipped CTA issues: TBD after capture run.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☑ ungated smoke | `22-timetable-inventory-smoke.spec.ts` |
| RBAC deny / hide | ☑ unit | `timetable-access` tests; live IdP residual |
| Cross-tenant IDOR blocked (API) | ☑ unit | bells/subs isolation service test |
| Cross-tenant IDOR blocked (UI) | ☐ | Residual (live) |
| No secrets/PHI leaked in git artifacts | ☑ | Staff IDs only in UI |
| Tenant isolation suite cited/run | ☑ unit | `timetable-service.test.ts` |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Tip unit (clash helper) | See agent run | `@proctira/backend-timetable` vitest |
| Tip e2e ungated smoke | See agent run | Playwright `22-*` |
| Live write gate | ☐ | Requires `E2E_BACKEND_READY=1` |

---

## Residuals

- Authenticated inventory + live write E2E (unit covers clash/RBAC/isolation/audit).  
- Axe/dark/touch route inclusion.  
- **Waived:** iCal federation · live IdP.
