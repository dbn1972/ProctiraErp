# DEV — Admissions enrol journey tip e2e (A5 / A-7)

**Capability / module:** Admissions CRM → enrol — full tip journey proof  
**Branch / tip:** `cursor/adm-enrol-journey-e2e-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` (A0)  
**Closes:** A-7 (end-to-end tip proof) in `TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` (TASKS file not edited here)  
**Peer parity:** Staff enquiry → merit → seat → offer → family pay → enrol (sandbox)

---

## 0. Product contract

| Item                   | Content                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | Tip CI can run one gated Playwright journey proving enquiry → merit → seat reserve → offer → parent sandbox pay → enrol, with soft-skip when the gateway is down. |
| In scope (peer parity) | Extend `apps/web/e2e/41-admissions-crm-write-smoke.spec.ts`; reuse `/admissions/*` + `/parent/offers`; soft-fail honesty (Wave 11 pattern).                        |
| Explicit non-goals     | OCR (A-4 / PRD-014); live PSP; public-apply + applicant IdP parity (A3 NON-GOAL); new routes; schema churn; editing TASKS file.                                  |
| Roles (RBAC)           | Staff SUPER_ADMIN JWT for CRM writes; parent JWT email ↔ `guardianEmail` for offer accept.                                                                      |

Screen / API inventory (reused — no new routes):

| Nav / surface        | Route / API                                      | Role in A5 proof                                      |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Enquiries            | `POST /admissions/enquiries` (+ convert)         | Start journey                                         |
| Merit                | `POST /admissions/merit-lists`                   | Rank application                                      |
| Seat matrix          | `PUT/GET /admissions/seat-matrix`                | Category capacity (“seat reserve”)                    |
| Offers (staff)       | `POST /admissions/offers` + `/send`              | Draft → sent                                          |
| Offers (parent)      | `GET/POST /parent-portal/offers` · `/parent/offers` | Sandbox pay + accept → enrol                       |
| Application detail   | `/admissions/[id]`                               | `enrolled-badge` after accept                         |

---

## 1. What shipped

| Item                                                         | Evidence                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Gated tip journey `A5 tip: enquiry → merit → seat → offer → parent pay → enrol` | `41-admissions-crm-write-smoke.spec.ts` live describe                                   |
| Soft-skip when `E2E_BACKEND_READY` unset                     | Existing `test.skip(!BACKEND_READY, …)` on live describe                                          |
| Soft-skip when flag set but `/health` unreachable            | `gatewayHealthy()` in live `beforeEach` — Wave 11 honesty                                         |
| Ungated CRM shells still render offline                      | Lookups/lists already soft-fail empty; ungated tests unchanged                                    |
| Parent pay path (not staff-only accept)                      | `parent-portal/offers` accept + `/parent/offers` accepted row                                     |
| Seat filled assertion after enrol                            | `filled >= filledBefore + 1` on general quota row                                                 |
| No new a11y/touch/dark routes                                | Prefer reuse; `/parent/offers` already on axe/dark/touch matrices                                 |

---

## 2. Honesty table (shipped vs residual)

| Claim                                                              | Status        | Notes                                                                 |
| ------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------- |
| One tip journey enquiry → merit → seat → offer → pay → enrol       | **Shipped**   | Spec committed; live pass needs `E2E_BACKEND_READY=1` + healthy gateway |
| Soft-fail honesty when gateway offline                             | **Shipped**   | Soft-skip (not red) when `/health` fails                              |
| Live PSP / real card charge                                        | **Residual**  | Sandbox payment ref only — do not claim live PSP                      |
| OCR / document AI                                                  | **NON-GOAL**  | A-4 / PRD-014                                                         |
| Public apply + applicant IdP parity                                | **NON-GOAL**  | A3 / PRD-016                                                          |
| Separate seat-reserve API / % caps / priority engine               | **Residual**  | Capacity via existing `quota` seat matrix (A4 polish)                 |
| Tip CI green on **merge commit**                                   | **Residual**  | Release gate — not claimed in this agent pass                         |
| Full enterprise production-ready pack (captures / designer / SEC)  | **Residual**  | A5 is tip journey proof only                                          |

---

## 3. How to exercise

```bash
# Ungated shells (always on) — CRM chrome + not-found
pnpm --filter @proctira/web exec playwright test \
  e2e/41-admissions-crm-write-smoke.spec.ts --project=chromium --grep 'ungated'

# Live tip journey (G-401 harness preferred)
DATABASE_URL=postgresql://... JWT_SECRET=dev-secret-change-in-production \
  E2E_SPECS='e2e/41-admissions-crm-write-smoke.spec.ts' \
  bash tools/scripts/run-e2e-backend-ready.sh

# Or against an already-running gateway + web:
E2E_BACKEND_READY=1 E2E_GATEWAY_URL=http://127.0.0.1:3000 \
  pnpm --filter @proctira/web exec playwright test \
  e2e/41-admissions-crm-write-smoke.spec.ts --project=chromium --grep 'A5 tip'
```

Without `E2E_BACKEND_READY`, live describes skip. With the flag but gateway down, live tests soft-skip (exit green for that case — honesty, not a false pass of the journey).

---

## 4. Verdict

**A5 DONE for tip journey e2e + soft-fail honesty** (closes A-7 for the test slice). Do **not** claim OCR complete, live PSP, public-apply CRM parity, or tip-CI ship until release-ops proves green on the merge commit.
