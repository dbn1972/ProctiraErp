# DEV — Admissions seat / merit polish (A4 · A-5 / A-6)

**Capability / module:** Admissions CRM → enrol — seat category/reservation UX + entrance-score ingest  
**Branch / tip:** `cursor/adm-seat-merit-polish-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (A4)  
**Product contract:** `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` (A0; program exit A4)  
**Peer parity target:** IC/PS-style category seat buckets + staff ability to enter entrance/test scores used by merit weights  
**Dev session:** A4 build slice (no TASKS file edit)  
**Paired test audit:** not claimed this slice — smoke/matrix touch only

Copy of `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md` (trimmed to honesty for a polish slice).

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | Admissions officers can maintain **category/reservation seat rows** via the existing `quota` key on `/admissions/seat-matrix`, and can **ingest interview + entrance/test scores** onto application placement (API already supported) so merit ranking is not score-blind. |
| In scope (peer parity) | Clearer category UX on seat matrix; placement score ingest on merit + application detail; empty/error/honesty when lookups missing; no fake schema.                                                                                                                        |
| Explicit non-goals     | New SQL for reservation rules / % caps / cut-offs; entrance-exam catalog or board-pack ingest; OCR (A-4 / PRD-014); public apply (A3); tip-CI full journey (A5).                                                                                                           |
| Roles (RBAC)           | Staff admissions (existing gateway tenant + staff session); no new public surface.                                                                                                                                                                                         |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: category keys are free-text presets (not board-certified rules).                                                                                                                                                                              |

Screen / API inventory:

| Nav / surface             | Route                     | API                                                     | Tables / fields                             | PII                     |
| ------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------------- | ----------------------- |
| Seat matrix               | `/admissions/seat-matrix` | `GET/PUT /admissions/seat-matrix`                       | `seat_matrix.quota`, seats, filled          | none beyond ids         |
| Merit list + score ingest | `/admissions/merit`       | `POST/GET /admissions/merit-lists`; `PATCH …/placement` | placements `interview_score` / `test_score` | applicant name via link |
| Application placement     | `/admissions/[id]`        | `PATCH /admissions/applications/:id/placement`          | placement row                               | applicant identity      |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                                 |
| ----------------------------- | ---- | ------------------------------------------------------------------------ |
| Versioned SQL under `db/sql/` | ☐    | **No new migration** — reused `db/sql/034_admissions_crm_schema.sql`     |
| Constraints / indexes / FKs   | ☑    | Existing unique `(tenant, institution, period, grade, quota)`            |
| Multi-board seed fixtures     | ☐    | N/A this polish                                                          |
| Domain unit/property tests    | ☐    | Existing pipeline ranking tests unchanged                                |
| Invariants documented         | ☑    | Quota key = reservation bucket; scores live on placement, not merit list |

**Residual (honest):** No multi-rule reservation engine (priority/cut-off/percentage of general seats). Category is a single TEXT `quota` key per matrix row.

---

## 2. API / services

| Check                              | Done | Evidence                                                         |
| ---------------------------------- | ---- | ---------------------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | Existing pipeline routes (`requireTenant`)                       |
| Validation + typed errors          | ☑    | `ApplicationPlacementSchema` + web `placementScoreFormSchema`    |
| RBAC enforced                      | ☑    | Existing admissions staff path (no API change)                   |
| Conflict / rule failures → 409/422 | ☑    | Existing seat assert on offer                                    |
| Idempotent writes where needed     | ☑    | Seat upsert + placement upsert                                   |
| Cross-tenant deny test             | ☐    | Covered by prior pipeline / RLS packs — not re-proven this slice |

**Shipped API wiring (UI only):** `setApplicationPlacement` → `PATCH /admissions/applications/:id/placement` with `interviewScore` / `testScore`.

**Could not invent:** Dedicated entrance-exam ingest endpoint or score history table — not in schema.

---

## 3. UI (redesign)

| Screen             | Empty/loading/error                    | Write works                    | Board-aware  | Evidence                                            |
| ------------------ | -------------------------------------- | ------------------------------ | ------------ | --------------------------------------------------- |
| Seat matrix        | ☑ honesty + lookups empty + form error | ☑ existing PUT                 | presets only | `seat-matrix-panel.tsx`, `quota-category-field.tsx` |
| Merit              | ☑ honesty + score/generate empty       | ☑ placement PATCH + POST merit | n/a          | `merit-panel.tsx`                                   |
| Application detail | ☑ missing placement status             | ☑ placement form               | n/a          | `placement-panel.tsx`, `[id]/page.tsx`              |

---

## 4. Cross-module integration

| Dependency                      | Integrated | Evidence                                    |
| ------------------------------- | ---------- | ------------------------------------------- |
| Institutions / periods / grades | ☑          | `loadAdmissionsLookups`                     |
| Offers / enrol                  | ☑          | Placement still required before offer draft |
| Board exam packs                | ☐          | Residual — no API                           |

---

## 5. Observability & audit

Unchanged this slice (gateway request logs / existing audit posture).

---

## 6. Security & tenancy notes

No new IDOR surface: placement PATCH already tenant-scoped; UI only adds the same call the e2e chain already uses indirectly via enquiry convert scores. Cross-tenant proof not re-run here.

---

## 7. Test / matrix

| Check                                     | Done | Evidence                                                                                                  |
| ----------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| Page regression matrix paths still listed | ☑    | `/admissions/seat-matrix`, `/admissions/merit`, `/admissions/[id]` already in `PAGE_REGRESSION_MATRIX.md` |
| Smoke expects honesty / score control     | ☑    | `41-admissions-crm-write-smoke.spec.ts`                                                                   |
| Full enterprise production-ready pack     | ☐    | Deferred to A5 / test skill                                                                               |

---

## 8. Verdict — shipped vs residual

| Claim                                                      | Status                                      |
| ---------------------------------------------------------- | ------------------------------------------- |
| A-6 category/reservation **UI polish** on existing `quota` | **Shipped**                                 |
| A-6 multi-rule reservation / % / priority engine           | **Residual** (no schema)                    |
| A-5 entrance-score **ingest UI** via placement API         | **Shipped** (merit + application detail)    |
| A-5 first-class entrance-exam catalog / CSV ingest         | **Residual** (API is placement scores only) |
| OCR / public apply                                         | Out of scope (A-4 NON-GOAL / A3)            |

**A4 build polish DONE for what schema/API already allow.** Do not claim peer IC/PS reservation-rules parity or board entrance-pack ingest.
