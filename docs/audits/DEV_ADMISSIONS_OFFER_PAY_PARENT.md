# DEV — Admissions parent offer-pay UX (A2 / A-2)

**Capability / module:** Admissions CRM → enrol — parent/guardian offer fee + accept  
**Branch / tip:** `cursor/adm-offer-pay-parent-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` (A0)  
**Peer parity:** Family-facing offer letter → fee → accept enrol (PS / IC / Ellucian-class conversion)

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | A linked parent/guardian with a verified email matching the application `guardianEmail` can list open offers, see fee amount / invoice id, record a **sandbox** payment reference, and accept so the student enrols. |
| In scope (peer parity) | Parent shell `/parent/offers`; `GET/POST /parent-portal/offers`; reuse pipeline accept + fee assert hooks; honesty banner (no live PSP).                                                                             |
| Explicit non-goals     | Public apply / applicant IdP (**A3**); OCR (**A-4** NON-GOAL); live PSP; claiming full CRM→enrol world-class complete; F2 dunning.                                                                                   |
| Roles (RBAC)           | Parent/guardian via `parent` resource (portal self-service). Staff continue to use `/admissions` offer panel.                                                                                                        |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: N/A (admissions journey, not board marksheet)                                                                                                                                           |

Screen / API inventory:

| Nav / surface   | Route            | API                                     | Tables / events                       | PII                   |
| --------------- | ---------------- | --------------------------------------- | ------------------------------------- | --------------------- |
| Offers (parent) | `/parent/offers` | `GET /parent-portal/offers`             | `admission_offers` + applications     | guardian email, names |
| Accept          | same             | `POST /parent-portal/offers/:id/accept` | accept → enrol + optional fee sandbox | payment ref (sandbox) |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                        |
| ----------------------------- | ---- | ----------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | Reuses `034` offers (no new migration)          |
| Constraints / indexes / FKs   | ☑    | Existing pipeline schema                        |
| Multi-board seed fixtures     | ☐    | N/A this slice                                  |
| Domain unit/property tests    | ☑    | Guardian list/accept deny in `pipeline.test.ts` |
| Invariants documented         | ☑    | Email match required; mismatch → 404            |

---

## 2. API / services

| Check                              | Done | Evidence                                                        |
| ---------------------------------- | ---- | --------------------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | Parent-portal routes + pipeline store tenant scoping            |
| Validation + typed errors          | ☑    | `AcceptGuardianOfferSchema` / Typebox                           |
| RBAC enforced                      | ☑    | `/parent-portal/*` → `parent` resource (existing portal grants) |
| Conflict / rule failures → 409/422 | ☑    | Pipeline seat / status rules unchanged                          |
| Idempotent writes where needed     | ☑    | Accept idempotent (existing)                                    |
| Cross-tenant deny test             | ☑    | Existing tenant-scoped store + guardian email filter (unit)     |

---

## 3. UI (redesign)

| Screen                 | Empty/loading/error | Write works | Board-aware | Evidence                                      |
| ---------------------- | ------------------- | ----------- | ----------- | --------------------------------------------- |
| `/parent/offers`       | ☑                   | ☑ sandbox   | N/A         | Honesty banner; accept form mirrors staff ref |
| Parent nav + home card | ☑                   | —           | N/A         | `ParentPortalShell`, home quick link          |

---

## 4. Cross-module integration

| Dependency                    | Integrated | Evidence                                             |
| ----------------------------- | ---------- | ---------------------------------------------------- |
| Admissions pipeline accept    | ☑          | `AdmissionsOffersPort` → `AdmissionsPipelineService` |
| Fees sandbox assert on accept | ☑          | Shared gateway hooks with staff registration plugin  |
| Parent portal shell           | ☑          | Nav Offers                                           |

---

## 5. Observability & audit

Honesty: sandbox only; OCR stays NON-GOAL; A3 public apply not claimed.

---

## 6. Verdict

**A2 DONE for parent offer-pay UX** (list + sandbox accept + enrol). Not a claim of tip-CI journey e2e (A5) or public apply (A3).
