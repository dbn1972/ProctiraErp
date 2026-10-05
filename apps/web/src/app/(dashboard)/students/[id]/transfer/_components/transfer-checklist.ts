/**
 * PRC-M483: transfer readiness checklist built from the student's live records
 * (fee invoices, discipline incidents, consents). No item is ever "done" unless the
 * underlying read succeeded and shows nothing outstanding; failed reads are
 * reported as "could not be checked".
 */
import type { DisciplineIncident, StudentConsent } from '@/lib/api/students';

export type ChecklistState = 'done' | 'outstanding' | 'unknown';

export interface TransferChecklistItem {
  key: 'fees' | 'discipline' | 'consent';
  label: string;
  state: ChecklistState;
  note: string;
}

const OPEN_INVOICE_STATUSES = new Set(['open', 'overdue']);

export function buildTransferChecklist(input: {
  /** Invoices for this student, or null when the fees read failed. */
  invoices: Array<{ status: string }> | null;
  discipline: DisciplineIncident[] | null;
  consents: StudentConsent[] | null;
}): TransferChecklistItem[] {
  const items: TransferChecklistItem[] = [];

  if (input.invoices === null) {
    items.push({
      key: 'fees',
      label: 'All fees settled',
      state: 'unknown',
      note: 'Fee invoices could not be loaded. Check the fees ledger before submitting.',
    });
  } else {
    const unpaid = input.invoices.filter((inv) => OPEN_INVOICE_STATUSES.has(inv.status)).length;
    items.push({
      key: 'fees',
      label: 'All fees settled',
      state: unpaid === 0 ? 'done' : 'outstanding',
      note:
        unpaid === 0
          ? 'No open or overdue invoices.'
          : `${unpaid} open or overdue invoice${unpaid === 1 ? '' : 's'}.`,
    });
  }

  if (input.discipline === null) {
    items.push({
      key: 'discipline',
      label: 'No outstanding discipline action',
      state: 'unknown',
      note: 'Discipline records could not be loaded.',
    });
  } else {
    const open = input.discipline.filter((d) => !d.actionTaken?.trim()).length;
    items.push({
      key: 'discipline',
      label: 'No outstanding discipline action',
      state: open === 0 ? 'done' : 'outstanding',
      note:
        open === 0
          ? input.discipline.length === 0
            ? 'No incidents on record.'
            : 'Every recorded incident has an action recorded.'
          : `${open} incident${open === 1 ? '' : 's'} without a recorded action.`,
    });
  }

  if (input.consents === null) {
    items.push({
      key: 'consent',
      label: 'Data-sharing consent recorded',
      state: 'unknown',
      note: 'Consents could not be loaded.',
    });
  } else {
    // Latest decision per kind wins.
    const latest = [...input.consents]
      .filter((c) => c.kind === 'data_sharing')
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    items.push({
      key: 'consent',
      label: 'Data-sharing consent recorded',
      state: latest?.granted ? 'done' : 'outstanding',
      note: latest
        ? latest.granted
          ? 'Guardian consented to sharing records with the destination school.'
          : 'Guardian declined data sharing.'
        : 'No data-sharing consent on record.',
    });
  }

  return items;
}
