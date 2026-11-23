-- F-D1 / F-D2 read-only detection report: scholarship disbursements whose fee netting
-- credited less than the disbursement amount. Run through
-- tools/scripts/fees-scholarship-netting-report.mjs (READ ONLY transaction, tenant GUC
-- bound with --tenant). Never writes. $1 = tenant id (uuid text) or NULL for every
-- tenant the connected role can see under RLS.
--
-- One row per disbursement that has at least one live (non-rejected) netting row in
-- fee_concessions (source_disbursement_id) and any discrepancy. All amounts are integer
-- paise.
--   expected_credit_cents  scholarship_disbursements.amount_cents (verified amount)
--   recorded_credit_cents  SUM(fee_concessions.amount_cents) of the live netting rows
--   applied_credit_cents   paise actually posted to invoices: the 'concession applied'
--                          fee_revenue debit legs written in the same transaction as each
--                          netting row (same invoice, same created_at = transaction time)
--   reserved_cents         recorded on legacy "credit reserved" rows (no invoice); never
--                          credited to any invoice
--   uncredited_cents       expected − applied: money of a paid scholarship that no invoice
--                          received
--   remaining_cents        expected − recorded: what the netting screen now offers for the
--                          student's next open invoice (after this fix)
--   reversal_overstated_cents  recorded − applied on invoice rows: a reversal of this
--                          disbursement would add this much to invoice faces that never
--                          received it
-- Findings (comma separated):
--   F-D1_zero_or_short_credit   a netting row records more than was posted to its invoice
--   F-D2_remainder_not_netted   the rows record less than the disbursement amount. For
--                               rows written before the fix this is the dropped excess;
--                               after the fix it is a remainder waiting for the
--                               student's next open invoice. Either way the netting
--                               screen now offers remaining_cents for netting.
--   reserved_not_applied        a legacy reserved row (no invoice) holds part of the credit
--   disbursement_not_paid       live netting rows but the disbursement is no longer paid
--   disbursement_missing        the disbursement row is not visible / does not exist
WITH netting AS (
  SELECT c.tenant_id,
         c.source_disbursement_id AS disbursement_id,
         c.id AS concession_id,
         c.student_id,
         c.invoice_id,
         c.amount_cents::bigint AS recorded_cents,
         c.created_at,
         COALESCE((
           SELECT SUM(l.amount_cents)
             FROM fee_ledger_entries l
            WHERE l.tenant_id = c.tenant_id
              AND l.invoice_id = c.invoice_id
              AND l.memo = 'concession applied'
              AND l.account = 'fee_revenue'
              AND l.side = 'debit'
              AND l.created_at = c.created_at
         ), 0)::bigint AS applied_cents
    FROM fee_concessions c
   WHERE c.source_disbursement_id IS NOT NULL
     AND c.status <> 'rejected'
     AND ($1::uuid IS NULL OR c.tenant_id = $1::uuid)
), per_disbursement AS (
  SELECT n.tenant_id,
         n.disbursement_id,
         MIN(n.student_id::text) AS student_id,
         COUNT(*) AS netting_rows,
         string_agg(COALESCE(n.invoice_id::text, '(reserved)'), ',' ORDER BY n.created_at)
           AS invoice_ids,
         SUM(n.recorded_cents)::bigint AS recorded_credit_cents,
         SUM(n.applied_cents) FILTER (WHERE n.invoice_id IS NOT NULL)::bigint
           AS applied_on_invoices_cents,
         COALESCE(SUM(n.recorded_cents) FILTER (WHERE n.invoice_id IS NULL), 0)::bigint
           AS reserved_cents,
         COALESCE(SUM(GREATEST(n.recorded_cents - n.applied_cents, 0))
           FILTER (WHERE n.invoice_id IS NOT NULL), 0)::bigint AS reversal_overstated_cents,
         MIN(n.created_at) AS first_netted_at,
         MAX(n.created_at) AS last_netted_at
    FROM netting n
   GROUP BY n.tenant_id, n.disbursement_id
), report AS (
  SELECT p.tenant_id,
         p.disbursement_id,
         p.student_id,
         d.payment_status AS disbursement_status,
         d.amount_cents::bigint AS expected_credit_cents,
         p.recorded_credit_cents,
         COALESCE(p.applied_on_invoices_cents, 0) AS applied_credit_cents,
         p.reserved_cents,
         -- NULL when the disbursement row is missing (no expected amount to compare).
         d.amount_cents - COALESCE(p.applied_on_invoices_cents, 0) AS uncredited_cents,
         GREATEST(d.amount_cents - p.recorded_credit_cents, 0) AS remaining_cents,
         p.reversal_overstated_cents,
         p.netting_rows,
         p.invoice_ids,
         p.first_netted_at,
         p.last_netted_at,
         concat_ws(',',
           CASE WHEN p.reversal_overstated_cents > 0 THEN 'F-D1_zero_or_short_credit' END,
           CASE WHEN d.id IS NOT NULL AND p.recorded_credit_cents < d.amount_cents
                THEN 'F-D2_remainder_not_netted' END,
           CASE WHEN p.reserved_cents > 0 THEN 'reserved_not_applied' END,
           CASE WHEN d.id IS NOT NULL AND d.payment_status <> 'paid'
                THEN 'disbursement_not_paid' END,
           CASE WHEN d.id IS NULL THEN 'disbursement_missing' END
         ) AS findings
    FROM per_disbursement p
    LEFT JOIN scholarship_disbursements d
      ON d.tenant_id = p.tenant_id AND d.id::text = p.disbursement_id
)
SELECT *
  FROM report
 WHERE findings <> ''
 ORDER BY tenant_id, first_netted_at, disbursement_id;
