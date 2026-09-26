# Screen test — Fees (Sunrise Public School)

**Date (UTC):** 2026-09-26  
**Tenant:** Sunrise Public School `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` after Prisma migrate and `APPLY_STRICT_FKS=1` domain SQL. Seed notice: 3 fee plans, 3 invoices (open 2, paid 1).  
**Session:** HS256 staff cookie, role `admin`, subject `neha.verma`. No password login exists on this seed.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`. Walked in headless Chrome.

This is a route walk of the staff fees screens. It is not a production-ready or 10/10 claim.

Pay and refund were opened through `ConfirmActionDialog` and cancelled. `SPS-2026-0001` stayed `open`. `SPS-2026-0002` stayed `paid`. `fee_refunds` stayed empty.

## Route table

| Route                       | Result | What was exercised                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/fees`                     | PASS   | Hub loaded 3 plans, 3 invoices, and 1 receipt. Manage plans opened `/fees/plans`.                                                                                                                                                                                                                                                  |
| `/fees/plans`               | PASS   | Term 1 tuition (`SPS-TUITION-T1`, ₹45,000), Term 1 transport (`SPS-TRANSPORT-T1`, ₹12,000), and Board exam fee (`SPS-EXAM`, ₹1,500) listed with no raw UUID. Create plan added **Screen-test activity fee** (`SPS-SCREEN-ACT`, ₹250, once).                                                                                        |
| `/fees/invoices`            | PASS   | Rows name Aarav Mehta, Diya Sharma, and Ananya Reddy with `SPS-2026-0001` open, `SPS-2026-0002` paid, `SPS-2026-0003` open. Issue invoice created an open Board exam fee for Rohan Mehta (`INV-20260926-57A11F3B`). Pay (sandbox) stopped on “Record sandbox payment?”. Refund stopped on “Record this refund?”. Neither post ran. |
| `/fees/receipts`            | PASS   | `SPS-RCT-2026-0001` for ₹12,000 is tied to invoice `SPS-2026-0002`. The list is the surface; there is no separate write control.                                                                                                                                                                                                   |
| `/fees/dunning`             | PASS   | Overdue feed is empty. Seed due dates are 15 Oct 2026 and 1 Nov 2026, after this walk (26 Sep 2026), so send stays unavailable. Add suppression for Aarav Mehta (“Screen test hold for Aarav”) posted, then Remove opened “Remove this suppression?” and the confirm cleared it.                                                   |
| `/fees/reconciliation`      | PASS   | Import of `sunrise-screen-test.csv` matched `SPS-2026-0001` (₹45,000) and left exception `SPS-NOT-A-REAL-INVOICE` (₹1.00, invoice not found). The audit row uses the filename, not a UUID fragment.                                                                                                                                |
| `/fees/reports`             | PASS   | Dues show **9-B** ₹45,000 open, **10-A** ₹1,500 open, and **Unassigned** ₹1,500 open for the Rohan invoice issued above (that plan invoice has no class). Download dues CSV uses those class names.                                                                                                                                |
| `/fees/structures`          | PASS   | Grade 9-B term tuition (`SPS-FEE-TUITION-9B`) and School transport (`SPS-FEE-TRANSPORT`). Bulk invoice stopped on “Create bulk invoices?” and created nothing.                                                                                                                                                                     |
| `/fees/scholarship-netting` | PASS   | Apply netting for Aarav Mehta / `SPS-2026-0001` stopped on “Apply this scholarship credit?”. Cancelled. Invoice statuses unchanged.                                                                                                                                                                                                |

No fees route in this list was FAIL or BLOCKED on the retest after the fixes below.

Out of scope: attendance, hostel fees, transport fees, and the parent fees portal.

## Fixes from the walk

| Screen            | Fault                                                                                       | Change                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Invoices · refund | “Confirm refund” posted from the amount form. Pay already stopped on `ConfirmActionDialog`. | `refund-dialog.tsx` collects amount and reason, then opens `ConfirmActionDialog` (`refund-confirm`) before `refundInvoiceAction`. |
| Reports           | Both class rows were titled “Class dues”. The CSV `classId` column was the raw class UUID.  | Class names come from the classes directory (`9-B`, `10-A`). The dues CSV column is `class`.                                      |
| Reconciliation    | The import summary and match line led with an 8-character UUID fragment.                    | Summary uses the filename. Match lines show the invoice number and amount.                                                        |
| Dunning           | Suppression reset read `event.currentTarget` after the server action.                       | The form element is captured before the await.                                                                                    |

## Rows this walk added

These are staff writes from the primary actions. They are not part of the original seed.

- Fee plan `SPS-SCREEN-ACT` (Screen-test activity fee, ₹250, once).
- Invoice `INV-20260926-57A11F3B` for Rohan Mehta, Board exam fee, ₹1,500, open, no class.
- Reconciliation batch `sunrise-screen-test.csv` (1 match, 1 open exception).

The Aarav suppression was removed before the walk ended.
