# Enterprise module test — Overview & People (Dashboard / Students / Staff)

**Module:** Overview & People  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router `(dashboard)` + middleware session gate; live captures under `/opt/cursor/artifacts/overview-people-audit/`  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label            | Route                         | Roles                      | PII/PHI          | Notes                                |
| -------------------- | ----------------------------- | -------------------------- | ---------------- | ------------------------------------ |
| Dashboard · overview | `/`                           | authenticated              | Low (aggregates) | KPI cards + quick actions            |
| Students · list      | `/students`                   | `student.read`             | High (PII)       | Search / filters / add+import CTAs   |
| Students · profile   | `/students/[id]`              | `student.read`             | High (PII)       | Enrollments, transfers, health links |
| Students · add       | `/students/new`               | `student.write`            | High (PII)       | Create form                          |
| Students · edit      | `/students/[id]/edit`         | `student.write`            | High (PII)       | Edit identity                        |
| Students · import    | `/students/import`            | `student.write`            | High (PII)       | Bulk Excel import stepper            |
| Students · transfer  | `/students/[id]/transfer`     | `student.write` + workflow | High (PII)       | Transfer request write path          |
| Staff · list         | `/staff`                      | `staff.read`               | High (PII)       | Type tabs + table                    |
| Staff · profile      | `/staff/[id]`                 | `staff.read`               | High (PII)       | Assignments + appraisals panels      |
| Staff · add          | `/staff/new`                  | `staff.write`              | High (PII)       | Create form                          |
| Staff · edit         | `/staff/[id]/edit`            | `staff.write`              | High (PII)       | Edit form                            |
| Staff · assignment   | `/staff/[id]/assignments/new` | `staff.write`              | Medium           | New teaching assignment              |
| Staff · appraisal    | `/staff/[id]/appraisals/new`  | `staff.write`              | Medium           | New appraisal                        |

---

## 1. Functionality

| Screen                        | Load OK           | Empty/loading/error          | Write path or N/A | Evidence                                                       |
| ----------------------------- | ----------------- | ---------------------------- | ----------------- | -------------------------------------------------------------- |
| `/` Dashboard                 | ☑ live PNG        | KPI fallbacks on API fail    | N/A (read)        | `09-live-dashboard.png`                                        |
| `/students`                   | ☑ live PNG        | empty table copy             | N/A list          | `10-live-students-list.png`                                    |
| `/students/[id]`              | ☑ live PNG        | 404 / not found              | N/A read          | `15-live-students-profile.png`                                 |
| `/students/new`               | ☑ live PNG        | validation on submit         | Create student    | `11-live-students-add.png` + `01-*.spec.ts` (gated)            |
| `/students/[id]/edit`         | ☑ live PNG        | validation                   | Update            | `22-live-students-edit-fixed.png`                              |
| `/students/import`            | ☑ live PNG        | preview errors               | Bulk import       | `12-live-students-import.png` + `05-*.spec.ts` (gated)         |
| `/students/[id]/transfer`     | ☑ live PNG        | checklist / pending          | Transfer request  | `23-live-students-transfer-fixed.png` + `04-*.spec.ts` (gated) |
| `/staff`                      | ☑ live PNG        | empty table                  | N/A list          | `13-live-staff-list.png`                                       |
| `/staff/[id]`                 | ☑ live PNG        | empty assignments/appraisals | N/A read          | `24-live-staff-profile.png`                                    |
| `/staff/new`                  | ☑ live PNG        | validation                   | Create staff      | `14-live-staff-add.png`                                        |
| `/staff/[id]/edit`            | ☑ live PNG        | validation                   | Update            | `25-live-staff-edit.png`                                       |
| `/staff/[id]/assignments/new` | ☑ live PNG        | workload empty               | Create assignment | `26-live-staff-assignment.png`                                 |
| `/staff/[id]/appraisals/new`  | ☑ live + redesign | templates empty              | Create appraisal  | `27-live-staff-appraisal.png`                                  |

Backend unit/property: ☐ partial — student/staff domain packages exist; **no dedicated staff write-path Playwright** beyond gated list/create journeys. Student create / import / transfer covered only when `E2E_BACKEND_READY=1`.

---

## 2. E2E (Playwright)

| Journey                            | Spec file                                                 | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                                  |
| ---------------------------------- | --------------------------------------------------------- | ---------------------------- | ------- | ------ | ----------------------------------------- |
| Inventory smoke (ungated)          | `apps/web/e2e/15-overview-people-inventory-smoke.spec.ts` | N/A — always runs            | ☐ CI    | ☐      | Unauthenticated → `/login` + body/heading |
| Login → create student             | `01-login-and-create-student.spec.ts`                     | ☐ gated                      | ☐       | ☐      | Skips without backend                     |
| Transfer + workflow                | `04-transfer-and-workflow.spec.ts`                        | ☐ gated                      | ☐       | ☐      | Skips without backend                     |
| Bulk import                        | `05-bulk-import.spec.ts`                                  | ☐ gated                      | ☐       | ☐      | Skips without backend                     |
| Tenant isolation (students)        | `07-tenant-isolation.spec.ts`                             | ☐ gated                      | ☐       | ☐      | Cross-tenant student deny                 |
| Route permission coupling          | `09-route-permission-coupling.spec.ts`                    | ☐ gated                      | ☐       | ☐      | `/students`, `/staff` in matrix           |
| Authenticated inventory (optional) | `15-…` second describe                                    | ☐ gated                      | ☐       | ☐      | Headings when backend ready               |
| Staff write happy path             | —                                                         | ☐ **missing**                | —       | —      | Residual risk                             |

---

## 3. UX / a11y

| Check                              | Pass     | Evidence                                                                  |
| ---------------------------------- | -------- | ------------------------------------------------------------------------- |
| axe WCAG 2.1 AA on module routes   | ☐ gated  | `a11y-axe.spec.ts` covers dashboard + `/students` (not full staff matrix) |
| Dark mode parity                   | ☑ listed | `/`, `/students`, `/staff` in `dark-mode-parity.spec.ts`                  |
| Touch targets ≥44px / ≥48px mobile | ☑ listed | `/students`, `/staff` in `touch-target-minimum.spec.ts`                   |
| RTL smoke (if locale enabled)      | ☐        | Shared RTL suite; not people-specific                                     |
| Keyboard / focus                   | ☐        | Forms use labeled controls; full keyboard pass pending live               |

---

## 4. Multidevice captures

| Screen                                                     | Desktop 1440      | Tablet 834 | Mobile 390 | Artifact path                                                                                    |
| ---------------------------------------------------------- | ----------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------ |
| Dashboard                                                  | ☑ (live/redesign) | ☐          | ☐          | `/opt/cursor/artifacts/overview-people-audit/02-redesign-dashboard.png`, `09-live-dashboard.png` |
| Students list / add / import / profile / edit / transfer   | ☑                 | ☐          | ☐          | `03–05`, `10–12`, `15–17`, `22–23` under overview-people-audit                                   |
| Staff list / add / profile / edit / assignment / appraisal | ☑                 | ☐          | ☐          | `06–07`, `13–14`, `24–27`                                                                        |
| Tablet / mobile viewport pack                              | ☐                 | ☐          | ☐          | `capture-screens.mjs` has hub TARGETS only (list/new/import); detail routes captured ad hoc      |

Horizontal scroll / clipped CTA issues: not systematically verified on 834/390 for every people screen.

---

## 5. Security

| Check                                  | Pass    | Evidence                                                                     |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| Unauthenticated redirect               | ☑       | Middleware + `(dashboard)` `requireSession`; ungated `15-…` asserts `/login` |
| RBAC deny / hide                       | ☐ gated | `09-route-permission-coupling` includes students/staff                       |
| Cross-tenant IDOR blocked (API)        | ☐ gated | `07-tenant-isolation` (students)                                             |
| Cross-tenant IDOR blocked (UI)         | ☐       | Relies on API tenant scoping                                                 |
| No secrets/PHI leaked in git artifacts | ☑       | Artifacts under `/opt/cursor` (not committed); demo names in live shots      |
| Tenant isolation suite cited/run       | ☐       | Platform gate exists; not re-run this pass                                   |

---

## 6. CI / production gates

| Gate                           | Pass     | Link / SHA                |
| ------------------------------ | -------- | ------------------------- |
| Lint / typecheck / unit        | ☐ tip CI | After push                |
| Integration (if DB touched)    | N/A      | Docs + ungated smoke only |
| DoD / Lighthouse / tenant gate | ☐        | Tip CI                    |

---

## 7. Residual risks / waivers

| Item                                                    | Risk                                                    | Owner      | Waiver date |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------- | ----------- |
| Live student journeys gated on `E2E_BACKEND_READY`      | Default CI skips create/import/transfer                 | QA         | 2026-09-06  |
| **No staff write-path E2E**                             | Assignment/appraisal/create not asserted in Playwright  | Product/QA | 2026-09-06  |
| Multidevice pack incomplete (tablet/mobile)             | Visual regressions on small viewports                   | Design     | 2026-09-06  |
| Authenticated heading inventory only when backend ready | Ungated smoke proves auth gate, not rendered SIS chrome | Agent      | 2026-09-06  |
| axe coverage incomplete for staff detail routes         | a11y debt on assignment/appraisal forms                 | A11y       | 2026-09-06  |

---

## Done criteria

- [x] Screen inventory complete for Dashboard + Students + Staff
- [x] Honest evidence from existing gated e2e + `/opt/cursor/artifacts/overview-people-audit/`
- [x] Ungated inventory smoke added (`15-overview-people-inventory-smoke.spec.ts`)
- [ ] Walkthrough artifacts attached to PR (existing pack cited; tablet/mobile still thin)
- [ ] Session state `complete` after tip CI

**Verdict:** ☐ Not ready · ☑ Ready with waivers · ☐ Enterprise production-ready
