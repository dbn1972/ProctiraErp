/**
 * Human references for screens that used to show a sliced UUID.
 * Callers pass a directory label — never a raw id fragment.
 */

export function offerFeeInvoiceStatus(invoiceId: string | null | undefined): string {
  return invoiceId?.trim() ? 'Fee invoice ready' : 'No invoice yet';
}

/** Directory name for a candidate, or a fixed label when the student is unknown. */
export function examinationCandidateLabel(studentLabel: string | null | undefined): string {
  const label = studentLabel?.trim();
  return label ? label : 'Candidate';
}
