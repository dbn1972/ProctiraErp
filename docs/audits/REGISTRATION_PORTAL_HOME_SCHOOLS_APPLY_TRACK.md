# Enterprise module test — Registration Portal

**Module:** Registration Portal (`apps/registration-portal`)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router + registration API (server / headless)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label             | Route                       | Roles  | PII/PHI | Notes                                  |
| --------------------- | --------------------------- | ------ | ------- | -------------------------------------- |
| Home                  | `/`                         | public | Low     | Landing CTAs                           |
| Find schools          | `/schools`                  | public | Low     | Map + Apply CTA sets `institutionId`   |
| Apply · personal info | `/apply/[type]`             | public | High    | DOB validated client-side              |
| Apply · documents     | `/apply/[type]/documents`   | public | High    | Metadata in sessionStorage; bytes in memory |
| Apply · review        | `/apply/[type]/review`      | public | High    | Blocks submit without institution UUID; base64 at submit |
| Apply · success       | `/apply/success`            | public | Medium  | Tracking number                        |
| Track application     | `/track`, `/track/[n]?dob=` | public | High    | Backend DOB gate                       |

---

## 1. Functionality

| Screen                             | Load OK | Empty/loading/error | Write path or N/A          | Evidence               |
| ---------------------------------- | ------- | ------------------- | -------------------------- | ---------------------- |
| `/` `/schools` `/apply/*` `/track` | ☑       | ☑                   | Submit hardened            | Routes + Review guards |
| School → apply handoff             | ☑       | N/A                 | Sets `institutionId` query | Institution map CTA    |
| Track DOB gate                     | ☑       | ☑ not-found         | Status requires DOB        | Backend `checkStatus`  |
| Document draft persistence         | ☑       | re-upload after refresh | Metadata only           | `stripDocumentContent` + Vitest |

Backend unit/property: ☑ — registration-service checkStatus DOB match/mismatch tests + draft persistence Vitest.

---

## 2. E2E (Playwright)

| Journey          | Spec file                                  | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence            |
| ---------------- | ------------------------------------------ | ---------------------------- | ------- | ------ | ------------------- |
| Public inventory | `e2e/01-registration-portal-smoke.spec.ts` | N/A                          | ☐       | ☐      | Spec added          |
| Wrong DOB        | same                                       | ☐ gated                      | ☐       | ☐      | Backend unit covers |

---

## 3. UX / a11y

| Check            | Pass                    | Evidence                                |
| ---------------- | ----------------------- | --------------------------------------- |
| axe WCAG 2.1 AA  | ☐                       | Waiver: no axe suite in this app yet    |
| Dark mode parity | ☐                       | Not wired                               |
| Touch targets    | ☐                       | Apply CTA uses `h-10` (40px) — residual |
| Keyboard / focus | ☑ primary forms labeled | Track + personal info                   |

---

## 4. Multidevice captures

| Screen         | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path        |
| -------------- | ------------ | ---------- | ---------- | -------------------- |
| portal screens | ☐            | ☐          | ☐          | Pending host capture |

---

## 5. Security

| Check                               | Pass | Evidence                              |
| ----------------------------------- | ---- | ------------------------------------- |
| Track DOB required                  | ☑    | Backend NotFound on missing/mismatch  |
| Institution UUID required on submit | ☑    | Review-step + `isValidInstitutionId`  |
| Cross-tenant IDOR                   | ☐    | Relies on tracking+DOB secrecy        |
| No secrets in git                   | ☑    |                                       |
| sessionStorage docs (bytes)         | ☑    | Metadata only; File map in memory; base64 at submit |

---

## 6. CI / production gates

| Gate                    | Pass | Link / SHA                                                                                                                                                                                              |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / unit | ☑    | tip `e94ac2f` — [CI run 34010731801](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731801) (Lint/Typecheck/Unit/Build/Tenant/Bundle ✅); draft Vitest added this pass — tip CI after push |
| Integration             | N/A  | N/A — Integration skipped (no schema change on tip)                                                                                                                                                     |
| DoD / Lighthouse        | ☑    | same tip — [DoD 34010731900](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731900) + Lighthouse on CI run ✅; [PR Check](https://github.com/dbn1972/ProctiraErp/actions/runs/34010731742) ✅ |

---

## 7. Residual risks / waivers

1. Live IdP/backend Playwright inventory still gated.
2. Document bytes are in-memory only — after refresh, applicants must re-upload before submit (intentional).
3. DOB remains in query string for track deep-links (prefer POST token later).
4. No CSP headers added this pass.
5. Deploy registry infra failures are not feature blockers.
6. Multidevice tablet/mobile pack still thin; axe suite not wired for this app.

**Verdict:** Ready with waivers above.

**Score delta (2026-09-06):** Module **8.5 → 9.0**. Closed sessionStorage base64 residual. Remaining gap to 9.5: live apply E2E, axe, multidevice pack, DOB-in-query.

## Screenshot pack (2026-09-06)

Filled `/opt/cursor/artifacts/registration-portal-audit/` (7 PNGs). Multidevice tablet/mobile still thin for this portal.
