# Enterprise module development — Fees recon ops + parent instalment clarity (F3)

**Capability / module:** Fees · reconciliation match/exception UX · parent instalment schedule  
**Branch / tip:** `cursor/fees-recon-parent-instalments-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Blackbaud Tuition–style bank recon triage + family portal instalment / remaining-balance clarity  
**Product lock:** `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md`  
**Tasks:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` (Slice F3 — closes F-5, F-6)

## 0. Product contract

| Item                 | Content                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Finance staff import bank/PSP CSV, review match vs exception lists with import/resolution audit on `/fees/reconciliation`; parents see instalment schedule and remaining balance on `/parent/fees`. |
| In scope             | List/resolve recon APIs; staff recon console; parent schedule/remaining UX; e2e ungated + gated extend; a11y/touch/dark route lists; DEV note                                                       |
| Explicit non-goals   | Dunning (F2); admissions; GL/tax (F-4); live PSP (G-202 waiver); editing TASKS file; opening a PR                                                                                                   |
| Roles                | Staff finance roles for resolve; parents read own invoices/instalments only                                                                                                                         |

Screen / API inventory:

| Nav / surface  | Route                  | API                                                                                                      | Tables / events                                                                  | PII       |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| Reconciliation | `/fees/reconciliation` | `POST /fees/reconciliation/import`, `GET …/batches`, `GET …/batches/:id/rows`, `POST …/rows/:id/resolve` | `fee_reconciliation_batches`, `fee_reconciliation_rows` (+ exception audit cols) | invoice # |
| Family fees    | `/parent/fees`         | `GET /fees/invoices?scope=parent`, receipts, `GET /fees/structures/:id/instalments`                      | invoices, receipts, structure instalments                                        | studentId |

## 1. Domain model

| Check                         | Done | Evidence                                                                      |
| ----------------------------- | ---- | ----------------------------------------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/048_fees_recon_exception_audit.sql` (+ applied in `ensureFeesSchema`) |
| Constraints / indexes / FKs   | ☑    | exception status + partial index on open exceptions                           |
| Domain unit tests             | ☑    | `packages/backend/fees/src/fees-service.test.ts` recon exceptions suite       |
| Invariants                    | ☑    | matched → `exception_status=none`; unmatched → `open`; resolve once           |

## 2. API / services

| Check             | Done | Evidence                                                         |
| ----------------- | ---- | ---------------------------------------------------------------- |
| Tenant middleware | ☑    | tenant required on all recon routes                              |
| RBAC on resolve   | ☑    | `assertFeesAccess(…, 'payment.record')`                          |
| Cross-tenant deny | ☑    | unit: batches empty for other tenant; e2e gated structures suite |
| Client helpers    | ☑    | `apps/web/src/lib/api/fees.ts` list/import/resolve + instalments |

## 3. UI

| Screen                 | Empty/loading/error           | Write                                | Evidence                       |
| ---------------------- | ----------------------------- | ------------------------------------ | ------------------------------ |
| `/fees/reconciliation` | empty batches; resolve alerts | import CSV; resolve/ignore exception | `reconciliation-workspace.tsx` |
| Fees hub               | —                             | card `open-reconciliation`           | `fees/page.tsx`                |
| `/fees/reports`        | —                             | link out to recon console            | `fees-reports-panel.tsx`       |
| `/parent/fees`         | empty schedule; remaining ₹0  | sandbox pay unchanged                | parent fees page               |

Honesty: sandbox ledger / PSP only; not Blackbaud-complete.

## 4–6. Integration / observability / residual

- Reuses existing import matcher; adds list + resolve audit fields (`resolved_by`, `resolved_at`, `resolution_note`).
- Parent schedule reads structure instalments for invoices that carry `structureId`; remaining = billed − receipts (0 when paid/void).
- Residual: tip CI on merge (release gate), full designer captures, SEC audit extension optional follow-up.

## Exit (this slice)

- [x] Staff recon match/exception + audit UX
- [x] Parent instalment schedule / remaining balance clarity
- [x] Ungated e2e page smoke + a11y/touch/dark route entries
- [x] DEV note (this file)
- [ ] Tip CI green on merge commit (release gate — not claimed here)
