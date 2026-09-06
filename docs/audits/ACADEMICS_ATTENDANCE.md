# Enterprise module test — Academics · Attendance

**Module:** Academics — Attendance  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router `(dashboard)/attendance*` + gateway attendance API (`packages/backend/attendance`)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Attendance · mark | `/attendance` | `attendance.read` / `attendance.write` | Medium (student roster + status) | Marking grid + draft autosave |
| Attendance · reports | `/attendance/reports` | `attendance.read` | Medium (percentages by student/class) | Filters; CSV export CTA disabled until wired |

API surface: `apps/web/src/lib/api/attendance.ts`, `apps/web/src/app/(dashboard)/attendance/actions.ts`, gateway attendance plugin → `packages/backend/attendance`.

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/attendance` | ☑ code path | empty roster until institution/class/period selected | `markAttendanceAction` bulk save | `attendance-marking-form.tsx` + `actions.ts` |
| `/attendance/reports` | ☑ code path | filters required | N/A read (CSV button disabled) | `attendance-report-filters.tsx` |

Backend unit/property: ☐ cite `packages/backend/attendance` Vitest when re-run this tip — domain package present; not re-executed in this uplift pass.

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Inventory smoke (ungated) | `apps/web/e2e/20-attendance-inventory-smoke.spec.ts` | N/A — always runs | ☐ CI | ☐ | Unauthenticated → `/login` |
| Mark + report journeys | `02-attendance.spec.ts` | ☐ gated | ☐ | ☐ | Requires seeded backend |
| Authenticated inventory | `20-…` second describe | ☐ gated | ☐ | ☐ | Headings when backend ready |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ gated | Not yet in dedicated axe route list for `/attendance*` |
| Dark mode parity | ☐ | Hub not confirmed in `dark-mode-parity.spec.ts` this pass |
| Touch targets ≥44px / ≥48px mobile | ☐ | Not confirmed in touch-target list this pass |
| RTL smoke (if locale enabled) | ☐ | Not attendance-specific |
| Keyboard / focus | ☐ | Pending live pass on marking grid |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| mark | ☐ | ☐ | ☐ | **No PNG pack invented** — capture not run this pass |
| reports | ☐ | ☐ | ☐ | **No PNG pack invented** |

Horizontal scroll / clipped CTA issues: unknown without captures.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☑ | Middleware + ungated `20-attendance-inventory-smoke.spec.ts` |
| RBAC deny / hide | ☐ gated | Not attendance-specific in `09-route-permission-coupling` |
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
| Live mark/report E2E gated | CI default-skip without `E2E_BACKEND_READY` | QA | 2026-09-06 |
| Multidevice PNG pack missing | No visual evidence for attendance screens | QA | 2026-09-06 |
| CSV export disabled | Reports export not live | Product | 2026-09-06 |
| Draft autosave localStorage | Offline resume is client-only; no server draft | Platform | 2026-09-06 |

---

## Done criteria

- [x] Screen inventory for mark + reports  
- [x] Ungated inventory smoke (`20-attendance-inventory-smoke.spec.ts`)  
- [ ] Multidevice PNGs  
- [ ] Live write journey with `E2E_BACKEND_READY=1`  
- [ ] Session state `complete` after tip CI  

**Verdict:** ☐ Not ready · ☑ Ready with waivers (formal audit + ungated auth redirect smoke; live write/multidevice residual) · ☐ Enterprise production-ready
