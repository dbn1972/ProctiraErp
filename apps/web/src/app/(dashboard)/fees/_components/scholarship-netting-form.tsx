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
import { useHydrated } from '@/hooks/useHydrated';
import { applyScholarshipNettingAction } from '@/lib/fees/actions';
import type { ScholarshipNettingResult } from '@/lib/api/fees';

function formatMoney(cents: number, currency = 'INR'): string {
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

export function ScholarshipNettingForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScholarshipNettingResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      setResult(null);
      const actionResult = await applyScholarshipNettingAction({
        studentId: String(fd.get('studentId') ?? '').trim(),
        disbursementId: String(fd.get('disbursementId') ?? '').trim(),
        amount: Number(fd.get('amount') ?? 0),
        invoiceId: String(fd.get('invoiceId') ?? '').trim(),
        currency: String(fd.get('currency') ?? '').trim() || 'INR',
      });
      if (!actionResult.success) {
        setError(actionResult.error);
        return;
      }
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
            <FormField id="net-student" label="Student UUID" required>
              <Input
                id="net-student"
                name="studentId"
                required
                disabled={!hydrated || pending}
                autoComplete="off"
              />
            </FormField>
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
            <FormField id="net-invoice" label="Invoice UUID (optional)">
              <Input
                id="net-invoice"
                name="invoiceId"
                disabled={!hydrated || pending}
                autoComplete="off"
                placeholder="Defaults to first open/overdue invoice"
              />
            </FormField>
            <input type="hidden" name="currency" value="INR" />
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="netting-error">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={!hydrated || pending}
              data-testid="submit-scholarship-netting"
            >
              {pending ? 'Applying…' : 'Apply netting'}
            </Button>
          </form>
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
                <code className="text-xs">{result.invoice.id}</code>
                <span className="ml-2">
                  balance {formatMoney(result.invoice.amountCents, result.invoice.currency)} (
                  {result.invoice.status})
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
