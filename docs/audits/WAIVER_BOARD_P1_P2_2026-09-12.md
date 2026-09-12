# Waiver / honesty board — P1 / P2 register close (2026-09-12 UTC)

**Owner:** cloud agent on `cursor/p1-p2-honesty-waivers-56c3` (docs only).  
**Tip verified against:** `origin/main` @ `fc4b222c` (2026-09-12).  
**Program:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` (parent reconciles Status — **this pack does not edit TASKS**).  
**Prior boards:** `docs/audits/WAIVER_BOARD_20260912.md` (G-\* / PRD-\* external secrets); `docs/audits/WAIVER_BOARD_20260910.md` (historical).  
**Product IA:** `docs/audits/PRODUCT_ENTERPRISE_P0_P1_P2_PROGRAM.md`.

**Honesty rule:** Tip paths below prove what **is** shipped. Dated **NON-GOAL** / **WAIVER** / **PARKED** close unfunded or secret-gated residuals. **Never fake green.** PROD_WAIVED ≠ capability complete.

---

## 1. Purpose / program DoD mapping

Program DoD allows P1/P2 rows to close as **DONE** when S0/S1 shipped capability is tip-proven **or** the residual is a **dated** NON-GOAL / WAIVER / PARKED decision. This board is the release-board artifact for:

| Register ID      | Close treatment                     | Residual class                                       |
| ---------------- | ----------------------------------- | ---------------------------------------------------- |
| **P1-ADM**       | **DONE** + dated NON-GOAL residuals | Public apply / OCR already dated; peer CRM not claim |
| **P1-FIN-GL**    | **DONE-with-dated-NON-GOAL**        | Unfunded CoA / budgets / period close (absorbs F5)   |
| **P1-PAY**       | **DONE-with-dated-NON-GOAL**        | Statutory payroll + GL integration unfunded          |
| **P1-PROC**      | **DONE-with-dated-NON-GOAL**        | Procurement / assets greenfield — no tip package     |
| **P2-LMS**       | **DONE-with-dated-WAIVER**          | LMS depth shipped; LTI/SCORM = PRD-012               |
| **P2-CANTEEN**   | **DONE-with-dated-NON-GOAL**        | Unfunded greenfield — no tip package                 |
| **P2-TRANSPORT** | **DONE-with-dated-NON-GOAL**        | Live cellular / hardware GPS adapter unfunded        |
| **P2-ALUMNI**    | **DONE-with-dated-NON-GOAL**        | Alumni engagement greenfield — no tip package        |
| **P2-MOBILE**    | **DONE-with-dated-WAIVER**          | Device-farm PNGs = PRD-007                           |
| **P2-SURVEY**    | **DONE-with-dated-PARKED**          | Remains PARKED (G-605) — do not un-park              |

---

## 2. Register close table (parent-facing)

| ID               | Tip proves (shipped)                                                                                                         | Dated residual (2026-09-12)                                                              | PRODUCT residual note                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **P1-ADM**       | Staff enquiry → merit → seat → offer → parent sandbox pay → enrol; PG pipeline; seat/merit polish; A5 tip e2e                | Public apply + applicant IdP **NON-GOAL** (PRD-016); OCR **NON-GOAL** (PRD-014)          | `PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` §10                                             |
| **P1-FIN-GL**    | Fees v1 + Blackbaud-depth F1–F3 surfaces (netting, dunning, recon); fee **ledger journals** (integer cents) — **not** ERP GL | Full GL / budgets / journals / period close / tax pack **NON-GOAL** until funded (ex-F5) | `PRODUCT_FEES_BLACKBAUD_DEPTH.md` §9                                                  |
| **P1-PAY**       | Staff HR G-918: contracts, attendance, import, **payroll CSV export** at `/staff/payroll`                                    | Statutory payroll + accounting/GL integration **NON-GOAL**                               | `PRODUCT_STAFF_HR_G918.md` §9                                                         |
| **P1-PROC**      | — (no `packages/backend/procurement`, no `/procurement` mount)                                                               | Procurement / vendors / POs / receiving / fixed assets **NON-GOAL**                      | Board-only (no prior PRODUCT)                                                         |
| **P2-LMS**       | LMS depth: bank, rubrics, files, discussions, content, analytics (`038`, `/lms/*`)                                           | LTI 1.3 / SCORM / live LMS connectors **WAIVED** (PRD-012); plan-only epic               | `PRODUCT_LMS_DEPTH.md` §9 · `docs/plans/LMS_LTI_EPIC.md`                              |
| **P2-CANTEEN**   | — (no canteen package / dashboard route)                                                                                     | Canteen POS / dietary safety / inventory **NON-GOAL**                                    | Board-only                                                                            |
| **P2-TRANSPORT** | Stops, trip boarding, GPS **batch ingest** + live **SVG** map, alerts, fee bands (`045`, `/transport/*`)                     | Live cellular provider / hardware GPS adapter **NON-GOAL**; MapLibre remains PRD-010     | `PRODUCT_TRANSPORT_OPS.md` §9                                                         |
| **P2-ALUMNI**    | — (no alumni engagement package; SIS graduation ≠ alumni CRM)                                                                | Alumni engagement product **NON-GOAL**                                                   | Board-only · backlog BL-001 is SIS promote, not this row                              |
| **P2-MOBILE**    | Flutter auth + DI + analyze + goldens + Linux desktop IT (`apps/mobile`, `MOBILE_FLUTTER_ENTERPRISE.md`)                     | Android **device-farm** / emulator PNGs **WAIVED** (PRD-007)                             | `MOBILE_FLUTTER_ENTERPRISE.md` §2026-09-12 · `PRODUCT_MOBILE_DEVICE_FARM_RESIDUAL.md` |
| **P2-SURVEY**    | Plugin code exists under `packages/backend/survey` but **unmounted**                                                         | **PARKED** (G-605) — remain parked; no gateway product surface                           | `PRODUCT_SURVEY_PARKED.md` · `GATEWAY_MOUNT_MATRIX.md`                                |

---

## 3. Tip evidence paths (what IS done)

### P1-ADM — Admissions review → enrol

| Artifact                                                   | Role                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| `packages/backend/registration` + `db/sql/014_*` / `034_*` | CRM + PG pipeline                        |
| `apps/web/src/app/(dashboard)/admissions/**`               | Enquiries, merit, seat-matrix, offers UI |
| `apps/web/e2e/41-admissions-crm-write-smoke.spec.ts`       | A5 tip journey (gated soft-skip)         |
| `docs/audits/DEV_ADMISSIONS_PIPELINE_PG.md`                | A1 PG honesty                            |
| `docs/audits/DEV_ADMISSIONS_OFFER_PAY_PARENT.md`           | A2 parent offer-pay                      |
| `docs/audits/DEV_ADMISSIONS_SEAT_MERIT_POLISH.md`          | A4 polish                                |
| `docs/audits/DEV_ADMISSIONS_ENROL_JOURNEY_E2E.md`          | A5 e2e pack                              |
| `docs/audits/DEV_ADMISSIONS_PUBLIC_APPLY_WAIVER.md`        | A-1 / PRD-016 NON-GOAL                   |

**Forbidden claims:** peer PowerSchool / Infinite Campus / Ellucian **public-apply + applicant IdP** parity; OCR/ID-scan complete.

### P1-FIN-GL — GL / budgets / period close

| Artifact                                                                                                                  | Role                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/backend/fees` + `db/sql/011_*` / `023_*` / `031_*` / `048_*`                                                    | Fee plans, invoices, ledger journals, recon audit     |
| `apps/web/src/app/(dashboard)/fees/**`                                                                                    | Structures, netting, dunning, reconciliation, reports |
| `docs/audits/PRODUCT_FEES_FINANCE_V1.md` · `PRODUCT_FEES_BLACKBAUD_DEPTH.md`                                              | Fees S0/S1 IA                                         |
| `docs/audits/DEV_FEES_SCHOLARSHIP_NETTING_UI.md` · `DEV_FEES_DUNNING_CONSOLE.md` · `DEV_FEES_RECON_PARENT_INSTALMENTS.md` | F1–F3 tip packs                                       |

**Not on tip:** chart of accounts, budget cycles, period close, tax pack export, multi-entity consolidation. Fee ledger journals ≠ ERP GL.

### P1-PAY — Statutory payroll + GL

| Artifact                                                        | Role                      |
| --------------------------------------------------------------- | ------------------------- |
| `db/sql/043_staff_hr_schema.sql`                                | Contracts / HR attendance |
| `apps/web/src/app/(dashboard)/staff/payroll`                    | Payroll CSV export UI     |
| `apps/web/e2e/52-staff-hr-write-smoke.spec.ts`                  | HR write smoke            |
| `docs/audits/PRODUCT_STAFF_HR_G918.md` · `DEV_STAFF_HR_G918.md` | G-918 pack                |

**Not on tip:** PF/ESI/tax engines, payslips, bank files, payroll→GL postings.

### P1-PROC / P2-CANTEEN / P2-ALUMNI — greenfield

Verified **absent** on tip (`fc4b222c`): no `packages/backend/{procurement,canteen,alumni}`; no dashboard routes under those names; gateway mount matrix has no procurement/canteen/alumni rows.

### P2-LMS — learning workflows + LTI residual

| Artifact                                                | Role                             |
| ------------------------------------------------------- | -------------------------------- |
| `db/sql/038_lms_depth_schema.sql`                       | Bank / rubrics / discussions / … |
| `apps/web/src/app/(dashboard)/lms/**`                   | Depth UI                         |
| `apps/web/e2e/47-lms-depth-write-smoke.spec.ts`         | Depth write smoke                |
| `docs/audits/PRODUCT_LMS_DEPTH.md` · `DEV_LMS_DEPTH.md` | Depth IA + DEV                   |
| `docs/plans/LMS_LTI_EPIC.md`                            | LTI plan-only (not product)      |

### P2-TRANSPORT — trips / boarding / GPS residual

| Artifact                                                        | Role                                   |
| --------------------------------------------------------------- | -------------------------------------- |
| `db/sql/045_transport_ops_schema.sql` (+ `006_*`)               | Stops, pings, attendance, alerts, fees |
| `apps/web/src/app/(dashboard)/transport/**`                     | Live SVG map, attendance, alerts, …    |
| `apps/web/e2e/54-transport-ops-write-smoke.spec.ts`             | Transport ops smoke                    |
| `docs/audits/PRODUCT_TRANSPORT_OPS.md` · `DEV_TRANSPORT_OPS.md` | Ops IA + DEV                           |

**Shipped GPS:** authenticated batch ingest + last-ping SVG. **Not shipped:** live cellular telematics provider / hardware adapter; MapLibre SDK (PRD-010).

### P2-MOBILE — device-farm residual

| Artifact                                             | Role                         |
| ---------------------------------------------------- | ---------------------------- |
| `apps/mobile/**`                                     | Flutter shell                |
| `docs/audits/MOBILE_FLUTTER_ENTERPRISE.md`           | Analyze / goldens / Linux IT |
| `docs/audits/PRODUCT_MOBILE_DEVICE_FARM_RESIDUAL.md` | This residual note           |

### P2-SURVEY — remain PARKED

| Artifact                                             | Role                    |
| ---------------------------------------------------- | ----------------------- |
| `packages/backend/survey`                            | Plugin only (unmounted) |
| `docs/audits/GATEWAY_MOUNT_MATRIX.md` (PARKED G-605) | Mount decision          |
| `docs/backlog/PRODUCT_CAPABILITY_BACKLOG.md` BL-010  | Parked backlog          |
| `docs/audits/PRODUCT_SURVEY_PARKED.md`               | Honesty residual        |

---

## 4. Cross-links to prior PRD / G rows (re-dated, not invented)

| Prior ID | Topic                        | 2026-09-12 treatment for this pack            |
| -------- | ---------------------------- | --------------------------------------------- |
| PRD-007  | Flutter device-farm          | **WAIVED** → closes **P2-MOBILE** residual    |
| PRD-010  | MapLibre transport map       | **NON-GOAL** (SVG+OSM accepted) — still holds |
| PRD-012  | LTI / SCORM                  | **WAIVED** → closes **P2-LMS** LTI residual   |
| PRD-014  | Admissions OCR               | **NON-GOAL** — holds for **P1-ADM**           |
| PRD-016  | Public apply + applicant IdP | **NON-GOAL** — holds for **P1-ADM**           |
| G-202    | Live PSP sandbox receipt     | **WAIVED** — Fees honesty, not P1-FIN-GL      |
| G-605    | Survey unmounted             | **PARKED** → closes **P2-SURVEY**             |

---

## 5. Parent reconciliation checklist

Parent may mark the ten register rows in §2 as **DONE-with-dated-NON-GOAL/WAIVER/PARKED** when merging this pack, without editing product history in prior PRODUCT sections (append-only residual §§ only).

- [ ] P1-ADM
- [ ] P1-FIN-GL
- [ ] P1-PAY
- [ ] P1-PROC
- [ ] P2-LMS
- [ ] P2-CANTEEN
- [ ] P2-TRANSPORT
- [ ] P2-ALUMNI
- [ ] P2-MOBILE
- [ ] P2-SURVEY

**Re-open rules:** fund greenfield epic (PROC / CANTEEN / ALUMNI / FIN-GL / PAY statutory); or supply device-farm / live LMS sandbox / cellular GPS provider secrets and reverse the matching PRD row on a newer waiver board.
