# Enterprise module development — Fees scholarship netting UI (F1)

**Capability / module:** Fees · scholarship netting staff UI  
**Branch / tip:** `cursor/fees-scholarship-net-ui-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Blackbaud Tuition–style aid netting to tuition (staff preview/apply credits)  
**Product lock:** `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md`  
**Tasks:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` (Slice F1)

## 0. Product contract

| Item                 | Content                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Finance staff can apply a paid scholarship disbursement as a fee credit against a student’s open invoice via `/fees/scholarship-netting`, wired to the existing netting API. |
| In scope             | Staff form UI; `POST /fees/scholarships/net` client helper; hub link; ungated page smoke; a11y route list; honesty banners                                                   |
| Explicit non-goals   | New scholarship award/disbursement product; dunning (F2); recon/parent instalments (F3); live PSP; Blackbaud-complete claim                                                  |
| Roles                | Staff with fees access (session + tenant JWT); parents cannot net                                                                                                            |

Screen / API inventory:

| Nav / surface       | Route                       | API                           | Tables / events                        | PII       |
| ------------------- | --------------------------- | ----------------------------- | -------------------------------------- | --------- |
| Scholarship netting | `/fees/scholarship-netting` | `POST /fees/scholarships/net` | concessions + invoice amount recompute | studentId |

## 1. Domain model

Pre-existing (G-1). No new SQL in this slice. Unit proof: `packages/backend/fees/src/scholarship-netting.test.ts`.

## 2. API / services

| Check                      | Done | Evidence                                                                |
| -------------------------- | ---- | ----------------------------------------------------------------------- |
| Route already mounted      | ☑    | `fees-plugin.ts` `${prefix}/scholarships/net`                           |
| Idempotent on disbursement | ☑    | `applyScholarshipNetting` marker `scholarship_netting:{disbursementId}` |
| Tenant-scoped              | ☑    | repository filters; e2e gated deny smoke when `E2E_BACKEND_READY`       |
| Client helper              | ☑    | `apps/web/src/lib/api/fees.ts` → `applyScholarshipNetting`              |

## 3. UI

| Screen                      | Empty/loading/error                                            | Write                                       | Evidence        |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- | --------------- |
| `/fees/scholarship-netting` | Error alert; empty invoice = reserved credit copy; result card | Server action → API                         | form + hub card |
| Fees hub                    | —                                                              | Link `data-testid=open-scholarship-netting` | `fees/page.tsx` |

Honesty: sandbox ledger only; no live PSP; not Blackbaud-complete.

## 4–6. Integration / observability / residual

- Integrates with Scholarships **disbursement IDs** (operator pastes paid id); does not invent award UX.
- Audit trail: concession `reason` includes disbursement marker.
- Residual: full UX designer captures, tip CI on merge, live PSP waiver unchanged (G-202).

## Exit (this slice)

- [x] Staff page + API wire
- [x] Ungated e2e page smoke + a11y list entry
- [x] DEV note (this file)
- [ ] Tip CI green on merge commit (release gate — not claimed here)
