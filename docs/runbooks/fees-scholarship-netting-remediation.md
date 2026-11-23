# Fees: scholarship netting remediation (F-D1, F-D2)

Operator runbook for scholarship disbursements that were netted wrongly before the F-D1/F-D2
fix. Follow-up status: **owner to approve data correction**. Nothing in this runbook runs
automatically, and the fix does not rewrite historical money rows.

## What went wrong

A paid scholarship disbursement is netted against the student's open fee invoice, either
automatically when the disbursement is marked paid (scholarship fee outbox →
`FeesService.applyScholarshipNetting`) or from `/fees/scholarship-netting`
(`POST /fees/scholarships/net`).

- **F-D1, ₹0 credit.** Against an invoice with no fee structure (ad-hoc from `/fees/invoices`,
  or issued from a fee plan) the credit was priced on the `SCHOLARSHIP_NET` structure, whose
  price is 0. The invoice did not change, but a netting row recorded the full amount and the
  disbursement left the nettable list. Example: a ₹2,000.00 invoice stayed ₹2,000.00 after a
  ₹500.25 scholarship.
- **F-D2, excess dropped.** A disbursement larger than the open invoice was capped at the
  invoice face. Example: ₹1,500 against a ₹1,000 invoice paid the invoice and recorded
  ₹1,000; ₹500 was credited nowhere.
- **Reserved credit never applied.** With no open invoice, a "credit reserved" row was created
  with no invoice. Nothing ever applied it, and the disbursement left the nettable list.

## What the fix changes

- The credit is the verified disbursement amount in exact integer paise, for structure, plan
  and ad-hoc invoices alike.
- One netting credits at most the invoice's open amount (face − collected). The remainder
  stays on the disbursement: the nettable list (`GET /fees/scholarships/nettable-disbursements`
  and the netting screen) shows `amountCents`, `nettedCents` and `remainingCents`, and the next
  netting credits the remainder to the student's next open invoice. A disbursement counts as
  netted only when its full amount has been applied.
- With no open invoice nothing is credited and the full amount stays on the nettable list.
  No more reserved rows are created.
- One netting row per disbursement and invoice (`db/sql/305_fees_scholarship_netting_partial.sql`)
  and a per-disbursement transaction lock make netting idempotent under double clicks, retries,
  outbox redelivery and concurrent calls.
- Reversal (disbursement cancelled/failed) restores every invoice by the credit it received and
  reopens an invoice that the credit had settled.

The fees module has no student credit-balance or advance ledger, so the remainder lives on the
disbursement (derived from its netting rows), not in a separate ledger.

## 1. Detect (read only)

`tools/scripts/fees-scholarship-netting-report.mjs` runs
`tools/scripts/fees-scholarship-netting-report.sql` in a `BEGIN READ ONLY` transaction and
rolls back. It never writes.

```bash
# One tenant, runtime role (RLS bound to the tenant):
DATABASE_URL=<runtime connection string> \
  node tools/scripts/fees-scholarship-netting-report.mjs --tenant=<tenant uuid> --format=csv

# Every tenant: use a read-only ops role that bypasses RLS.
DATABASE_URL=<read-only BYPASSRLS connection string> \
  node tools/scripts/fees-scholarship-netting-report.mjs --all-tenants --format=csv
```

Exit code 0 means no affected disbursements, 3 means rows were listed, 1 is an error and 2 is
a usage error. Keep the CSV as evidence for the owner's approval.

All amounts are integer paise. Columns:

| Column                      | Meaning                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `expected_credit_cents`     | Verified disbursement amount (`scholarship_disbursements.amount_cents`).                                                           |
| `recorded_credit_cents`     | Sum of the live netting rows (`fee_concessions.amount_cents`).                                                                     |
| `applied_credit_cents`      | Paise actually posted to invoices: the `concession applied` fee-revenue debit written in the same transaction as each netting row. |
| `reserved_cents`            | Recorded on legacy reserved rows (no invoice). Never credited.                                                                     |
| `uncredited_cents`          | `expected − applied`: money of a paid scholarship that no invoice received.                                                        |
| `remaining_cents`           | `expected − recorded`: what the netting screen now offers for the next open invoice.                                               |
| `reversal_overstated_cents` | `recorded − applied` on invoice rows: what a reversal would wrongly add to invoice faces.                                          |
| `findings`                  | `F-D1_zero_or_short_credit`, `F-D2_remainder_not_netted`, `reserved_not_applied`, `disbursement_not_paid`, `disbursement_missing`. |

## 2. Remediate (owner approval required)

Do not edit `fee_concessions`, `parent_fee_invoices` or `fee_ledger_entries` by hand. Every
correction goes through the application so it posts a balanced journal and an audit row.
Record the report row, the action taken and the approver for each disbursement.

- **`F-D2_remainder_not_netted`**: after the fix, the remainder (`remaining_cents`) is offered on
  `/fees/scholarship-netting`. Net it to the student's next open invoice from that screen (or
  `POST /fees/scholarships/net`). That is the whole correction. If the student has no open
  invoice, leave it listed; it is credited when the next invoice exists. If the owner decides
  the money should be refunded instead, use the existing refund process outside netting.
- **`F-D1_zero_or_short_credit`**: the netting row records credit that never reached the
  invoice, so the disbursement is not offered again (recorded = expected). Credit the shortfall
  (`uncredited_cents`) to the student's open invoice with an approved credit note
  (`POST /fees/invoices/:id/credit-notes`, reason citing the disbursement id and "F-D1"), one per
  affected invoice, capped at the invoice's open amount. If the disbursement is later cancelled,
  its reversal would add `reversal_overstated_cents` to the invoice face; until a correction tool
  exists, the owner must approve each reversal of a listed disbursement and the operator must
  void or credit-note the overstated amount after it.
- **`reserved_not_applied`**: the reserved row hides the disbursement from the netting screen.
  Credit `reserved_cents` to the student's open invoice with an approved credit note as above.
- **`disbursement_not_paid` / `disbursement_missing`**: investigate with the scholarship office
  before any money movement; do not credit.

After each correction, re-run the report for the tenant and attach the before/after CSV. The
correction is complete when the disbursement no longer shows `uncredited_cents > 0` from a
netting that the owner has not explicitly waived. Credit notes are not netting rows, so
F-D1 and reserved rows stay listed: mark them in the evidence as corrected by credit note
`<id>`.

## Follow-ups

- Owner to approve data correction (per tenant, from the report CSV).
- A dedicated, audited correction tool for F-D1/reserved rows (adjust the netting row to the
  applied amount and re-offer the remainder) if the number of affected rows makes manual
  credit notes impractical.
