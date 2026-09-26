'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { useHydrated } from '@/hooks/useHydrated';
import { applyScholarshipNettingAction } from '@/lib/fees/actions';
import type { ScholarshipNettingResult } from '@/lib/api/fees';
import type { EntityLabelOption } from '@/lib/entity-label';
import { humanizeStatus } from '@/lib/status-label';
import { resolveEntityLabel } from '@/lib/entity-label';

function formatMoney(cents: number, currency = 'INR'): string {
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

export function ScholarshipNettingForm({
  studentOptions = [],
  invoiceOptions = [],
  invoiceDirectoryFailed = false,
}: {
  studentOptions?: EntityLabelOption[];
  invoiceOptions?: EntityLabelOption[];
  invoiceDirectoryFailed?: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScholarshipNettingResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<{
    studentId: string;
    disbursementId: string;
    amount: number;
    invoiceId: string;
    currency: string;
  } | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setPendingValues({
      studentId: String(fd.get('studentId') ?? '').trim(),
      disbursementId: String(fd.get('disbursementId') ?? '').trim(),
      amount: Number(fd.get('amount') ?? 0),
      invoiceId: String(fd.get('invoiceId') ?? '').trim(),
      currency: String(fd.get('currency') ?? '').trim() || 'INR',
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
            <code className="text-xs">POST /fees/scholarships/net</code>). Idempotent on
            disbursement ID. Sandbox ledger only — not a live PSP claim.
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
            <EntitySearchSelect
              id="net-student"
              name="studentId"
              label="Student"
              options={studentOptions}
              required
            />
            <FormField id="net-disbursement" label="Disbursement ID" required>
              <Input
                id="net-disbursement"
                name="disbursementId"
                required
                disabled={!hydrated || pending}
                autoComplete="off"
                placeholder="Paid disbursement id from Scholarships"
              />
            </FormField>
            <FormField id="net-amount" label="Amount (INR)" required>
              <Input
                id="net-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
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
            <input type="hidden" name="currency" value="INR" />
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="netting-error">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={!hydrated || pending || studentOptions.length === 0}
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
              {formatMoney(result.discountCents, result.invoice?.currency ?? 'INR')}
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
                  balance {formatMoney(result.invoice.amountCents, result.invoice.currency)} (
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
