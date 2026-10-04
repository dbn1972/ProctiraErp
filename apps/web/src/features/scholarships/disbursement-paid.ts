/**
 * Validation for marking a scholarship disbursement as paid.
 *
 * The scholarship service rejects `paid` without a transaction reference and
 * a paid date (PRC-H085), so the client builds the full payload here.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TRANSACTION_REFERENCE = 255;

export interface PaidUpdateInput {
  transactionReference: string;
  paidDate: string;
}

export type PaidUpdateResult =
  | {
      ok: true;
      body: { paymentStatus: 'paid'; transactionReference: string; paidDate: string };
    }
  | { ok: false; error: string };

export function buildPaidUpdateBody(input: PaidUpdateInput): PaidUpdateResult {
  const transactionReference = input.transactionReference.trim();
  if (!transactionReference) {
    return { ok: false, error: 'Enter the bank or payment transaction reference.' };
  }
  if (transactionReference.length > MAX_TRANSACTION_REFERENCE) {
    return {
      ok: false,
      error: `Transaction reference must be ${MAX_TRANSACTION_REFERENCE} characters or fewer.`,
    };
  }
  const paidDate = input.paidDate.trim();
  if (!DATE_RE.test(paidDate) || Number.isNaN(Date.parse(`${paidDate}T00:00:00Z`))) {
    return { ok: false, error: 'Enter the paid date as YYYY-MM-DD.' };
  }
  return { ok: true, body: { paymentStatus: 'paid', transactionReference, paidDate } };
}
