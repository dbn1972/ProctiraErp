'use client';

import { useLocale } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { useHydrated } from '@/hooks/useHydrated';
import { DEFAULT_FEE_CURRENCY, formatAmount } from './format-amount';
import { applyScholarshipNettingAction } from '@/lib/fees/actions';
import { generateIdempotencyKey } from '@/lib/sync/idempotencyKey';
import type { NettableScholarshipDisbursement, ScholarshipNettingResult } from '@/lib/api/fees';
import type { EntityLabelOption } from '@/lib/entity-label';
import { humanizeStatus } from '@/lib/status-label';
import { resolveEntityLabel } from '@/lib/entity-label';

/** PRC-H020: picker label for a verified, paid, un-netted disbursement (PRC-L040 formatting). */
export function disbursementOptionLabel(
  disbursement: NettableScholarshipDisbursement,
  studentLabels: Record<string, string>,
  locale: string,
): string {
  const student = resolveEntityLabel(disbursement.studentId, studentLabels, 'Student');
  const money = formatAmount(
    disbursement.amountCents,
    disbursement.currency ?? DEFAULT_FEE_CURRENCY,
    locale,
  );
  const paid = disbursement.paidDate ? ` · paid ${disbursement.paidDate.slice(0, 10)}` : '';
  return `${student} · ${money}${paid}`;
}

export function ScholarshipNettingForm({
  studentOptions = [],
  disbursements = [],
  disbursementsFailed = false,
  invoiceOptions = [],
  invoiceDirectoryFailed = false,
}: {
  studentOptions?: EntityLabelOption[];
  /** Paid, un-netted disbursements returned by GET /fees/scholarships/nettable-disbursements. */
  disbursements?: NettableScholarshipDisbursement[];
  disbursementsFailed?: boolean;
  invoiceOptions?: EntityLabelOption[];
  invoiceDirectoryFailed?: boolean;
}) {
  const locale = useLocale();
  const studentLabels = Object.fromEntries(studentOptions.map((o) => [o.id, o.label]));
  const disbursementOptions: EntityLabelOption[] = disbursements.map((d) => {
    const label = disbursementOptionLabel(d, studentLabels, locale);
    return { id: d.id, label, searchText: label };
  });
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScholarshipNettingResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<{
    studentId: string;
    disbursementId: string;
    invoiceId: string;
    currency?: string;
    idempotencyKey: string;
  } | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    // PRC-H020: student and currency come from the verified disbursement, not free text.
    const disbursementId = String(fd.get('disbursementId') ?? '').trim();
    const disbursement = disbursements.find((d) => d.id === disbursementId);
    if (!disbursement) {
      setError('Select a paid scholarship disbursement.');
      return;
    }
    setError(null);
    setPendingValues({
      studentId: disbursement.studentId,
      disbursementId: disbursement.id,
      invoiceId: String(fd.get('invoiceId') ?? '').trim(),
      // PRC-L040: send the disbursement's currency when known, otherwise let the server choose.
      ...(disbursement.currency ? { currency: disbursement.currency } : {}),
      // PRC-H058: one Idempotency-Key per submission; a double-confirm reuses it.
      idempotencyKey: generateIdempotencyKey(),
    });
    setConfirmOpen(true);
  }

  function onConfirm() {
    if (!pendingValues) return;
    const values = pendingValues;
    startTransition(async () => {
      setError(null);
      setResult(null);
      const actionResult = await applyScholarshipNettingAction(values);
      if (!actionResult.success) {
        setError(actionResult.error);
        return;
      }
      setConfirmOpen(false);
      setPendingValues(null);
      setResult(actionResult.data);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 max-w-[720px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply disbursement credit</CardTitle>
          <CardDescription>
            Credits an open fee invoice from a paid scholarship disbursement (
            <code className="text-xs">POST /fees/scholarships/net</code>). The credited amount is
            the verified disbursement amount. Idempotent on disbursement. Sandbox ledger only — not
            a live PSP claim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSubmit}
            className="space-y-4"
            aria-busy={pending}
            data-testid="scholarship-netting-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            {disbursementsFailed ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="netting-disbursements-error"
              >
                Paid scholarship disbursements could not be loaded. Netting is unavailable until
                they can be verified.
              </p>
            ) : null}
            <EntitySearchSelect
              id="net-disbursement"
              name="disbursementId"
              label="Paid disbursement"
              options={disbursementOptions}
              required
              placeholder="Search paid disbursements…"
              emptyMessage="No paid scholarship disbursements are waiting to be netted."
            />
            <EntitySearchSelect
              id="net-invoice"
              name="invoiceId"
              label="Invoice (optional)"
              options={invoiceOptions}
              placeholder="Search invoices…"
              emptyMessage={
                invoiceDirectoryFailed
                  ? 'Invoices could not be loaded. Leave this blank to use the first open invoice.'
                  : 'No invoices are loaded. Leave this blank to use the first open invoice.'
              }
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="netting-error">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={!hydrated || pending || disbursementOptions.length === 0}
              data-testid="submit-scholarship-netting"
            >
              {pending ? 'Applying…' : 'Apply netting'}
            </Button>
          </form>
          <ConfirmActionDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Apply this scholarship credit?"
            description="This posts a fee credit from the disbursement. It cannot be undone from this form."
            confirmLabel="Apply credit"
            pending={pending}
            onConfirm={onConfirm}
            testId="scholarship-netting-confirm"
          />
        </CardContent>
      </Card>

      {result ? (
        <Card data-testid="netting-result">
          <CardHeader>
            <CardTitle className="text-base">Netting result</CardTitle>
            <CardDescription>
              {result.idempotent
                ? 'Already applied for this disbursement (idempotent replay).'
                : result.invoice
                  ? 'Credit applied to invoice.'
                  : 'No open invoice — credit reserved on scholarship netting structure.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Discount: </span>
              {formatAmount(
                result.discountCents,
                result.invoice?.currency ?? DEFAULT_FEE_CURRENCY,
                locale,
              )}
            </p>
            {result.concession ? (
              <p>
                <span className="text-muted-foreground">Concession: </span>
                <code className="text-xs">{result.concession.id}</code>
                {result.concession.reason ? (
                  <span className="block mt-1 text-muted-foreground">
                    {result.concession.reason}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground" data-testid="netting-empty-concession">
                No concession payload returned.
              </p>
            )}
            {result.invoice ? (
              <p>
                <span className="text-muted-foreground">Invoice: </span>
                {resolveEntityLabel(
                  result.invoice.id,
                  Object.fromEntries(invoiceOptions.map((option) => [option.id, option.label])),
                  'Invoice',
                )}
                <span className="ml-2">
                  balance{' '}
                  {formatAmount(result.invoice.amountCents, result.invoice.currency, locale)} (
                  {humanizeStatus(result.invoice.status)})
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground" data-testid="netting-empty-invoice">
                No invoice linked — reserved credit only.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
