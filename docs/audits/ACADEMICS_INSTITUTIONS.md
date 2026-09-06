# Enterprise module test — Academics · Institutions

**Module:** Academics — Institutions  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router `(dashboard)/institutions` + gateway institutions API  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label                     | Route                               | Roles                    | PII/PHI    | Notes                   |
| ----------------------------- | ----------------------------------- | ------------------------ | ---------- | ----------------------- |
| Institutions · list           | `/institutions`                     | `institution.read`       | Low–Medium | Table + Register CTA    |
| Institutions · profile        | `/institutions/[id]`                | `institution.read`       | Low        | Redirects to overview   |
| Institutions · overview       | `/institutions/[id]/overview`       | `institution.read`       | Low        | Hub tabs                |
| Institutions · register       | `/institutions/new`                 | `institution.write`      | Low        | Register form           |
| Institutions · edit           | `/institutions/[id]/edit`           | `institution.write`      | Low        | Edit identity           |
| Institutions · classes        | `/institutions/[id]/classes`        | `institution.read/write` | Low        | Class sections          |
| Institutions · grades         | `/institutions/[id]/grades`         | `institution.read/write` | Low        | Grades offered          |
| Institutions · infrastructure | `/institutions/[id]/infrastructure` | `institution.read/write` | Low        | Land/building hierarchy |

Seeded live probe id (historical): `a2e96cd1-0232-4cce-97e2-00ebbfb9a374` — see `/opt/cursor/artifacts/institutions-audit/summary.json`.

---

## 1. Functionality

| Screen                              | Load OK      | Empty/loading/error | Write path or N/A | Evidence                                   |
| ----------------------------------- | ------------ | ------------------- | ----------------- | ------------------------------------------ |
| `/institutions`                     | ☑ HTML probe | empty CTA           | N/A list          | `summary.json` list DONE (h1 Institutions) |
| `/institutions/[id]` → overview     | ☑            | 404 on bad id       | N/A               | summary profile → overview                 |
| `/institutions/[id]/overview`       | ☑            | —                   | N/A read          | summary overview DONE                      |
| `/institutions/new`                 | ☑            | validation          | Register          | summary register DONE                      |
| `/institutions/[id]/edit`           | ☑            | validation          | Save              | summary edit DONE                          |
| `/institutions/[id]/classes`        | ☑            | empty sections      | Create/manage     | summary classes DONE                       |
| `/institutions/[id]/grades`         | ☑            | empty grades        | Manage            | summary grades DONE                        |
| `/institutions/[id]/infrastructure` | ☑            | empty hierarchy     | Add land          | summary infrastructure DONE                |

Backend unit/property: ☐ cite institutions package tests when re-run; UI wired via `apps/web/src/lib/institutions/api.ts`.

---

## 2. E2E (Playwright)

| Journey                                   | Spec file                                              | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                                 |
| ----------------------------------------- | ------------------------------------------------------ | ---------------------------- | ------- | ------ | ---------------------------------------- |
| Inventory smoke (ungated)                 | `apps/web/e2e/16-institutions-inventory-smoke.spec.ts` | N/A — always runs            | ☐ CI    | ☐      | Unauthenticated → `/login`               |
| Login → pick institution → create student | `01-login-and-create-student.spec.ts`                  | ☐ gated                      | ☐       | ☐      | Hits `/institutions` list                |
| Route permission coupling                 | `09-route-permission-coupling.spec.ts`                 | ☐ gated                      | ☐       | ☐      | `/institutions` in matrix                |
| Authenticated inventory (optional)        | `16-…` second describe                                 | ☐ gated                      | ☐       | ☐      | Headings when backend ready              |
| Dedicated institution write E2E           | —                                                      | ☐ **missing**                | —       | —      | Register/edit/classes not journey-tested |

---

## 3. UX / a11y

| Check                              | Pass     | Evidence                                            |
| ---------------------------------- | -------- | --------------------------------------------------- |
| axe WCAG 2.1 AA on module routes   | ☐ gated  | `a11y-axe.spec.ts` covers `/institutions` list only |
| Dark mode parity                   | ☑ listed | `/institutions` in `dark-mode-parity.spec.ts`       |
| Touch targets ≥44px / ≥48px mobile | ☑ listed | `/institutions` in `touch-target-minimum.spec.ts`   |
| RTL smoke (if locale enabled)      | ☐        | Not institution-specific                            |
| Keyboard / focus                   | ☐        | Pending live pass on register/edit forms            |

---

## 4. Multidevice captures

| Screen                                   | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path                                             |
| ---------------------------------------- | ------------ | ---------- | ---------- | --------------------------------------------------------- | ------------- |
| list                                     | ☑            | ☑          | ☑          | `/opt/cursor/artifacts/institutions-audit/01-list(.tablet | .mobile).png` |
| new / register                           | ☑            | ☑          | ☑          | `02-new*`                                                 |
| profile / overview                       | ☑            | ☑          | ☑          | `03-profile*` · `04-overview*`                            |
| edit / classes / grades / infrastructure | ☑            | ☑          | ☑          | `05`–`08-*` (authenticated cookie capture 2026-09-06)     |

Horizontal scroll / clipped CTA: visually reviewed on desktop pack — no blocking clip found on list/new.

---

## 5. Security

| Check                                  | Pass    | Evidence                                            |
| -------------------------------------- | ------- | --------------------------------------------------- |
| Unauthenticated redirect               | ☑       | Middleware + `requireSession`; ungated `16-…`       |
| RBAC deny / hide                       | ☐ gated | `09-route-permission-coupling`                      |
| Cross-tenant IDOR blocked (API)        | ☐       | Institutions domain tenant scoping — cite when live |
| Cross-tenant IDOR blocked (UI)         | ☐       | Relies on API                                       |
| No secrets/PHI leaked in git artifacts | ☑       | Demo institution names only in PNG pack             |
| Tenant isolation suite cited/run       | ☐       | Not re-run this pass                                |

---

## 6. CI / production gates

| Gate                           | Pass     | Link / SHA           |
| ------------------------------ | -------- | -------------------- |
| Lint / typecheck / unit        | ☐ tip CI | After push           |
| Integration (if DB touched)    | N/A      | Docs + ungated smoke |
| DoD / Lighthouse / tenant gate | ☐        | Tip CI               |

---

## 7. Residual risks / waivers

| Item                                    | Risk                                                      | Owner    | Waiver date |
| --------------------------------------- | --------------------------------------------------------- | -------- | ----------- |
| Live institution write journeys missing | Register/edit/classes/grades/infra untested in Playwright | QA       | 2026-09-06  |
| Gated e2e default-skip in CI            | Inventory ungated only proves auth redirect               | QA       | 2026-09-06  |
| KPI cards show connect-API placeholders | Enrollment/reporting metrics not live without gateway     | Platform | 2026-09-06  |

---

## Done criteria

- [x] Full institutions screen inventory
- [x] Honest note of prior screenshot gap (closed 2026-09-06)
- [x] Ungated inventory smoke (`16-institutions-inventory-smoke.spec.ts`)
- [x] Multidevice PNGs under `institutions-audit/` (24)
- [ ] Session state `complete` after tip CI

**Verdict:** ☐ Not ready · ☑ Ready with waivers (audit + ungated smoke + authenticated multidevice pack; live write e2e still gated) · ☐ Enterprise production-ready
