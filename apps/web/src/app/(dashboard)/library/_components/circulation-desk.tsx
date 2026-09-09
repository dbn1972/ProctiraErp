'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

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

import {
  checkoutLibraryItemAction,
  renewLibraryLoanAction,
  returnLibraryLoanAction,
} from '../../campus-actions';
import { checkoutBarcodeAction, returnBarcodeAction } from '../../campus-ops-actions';
import type { LibraryItem } from '@/lib/api/library';

export function CirculationDesk({
  items,
  patronUserId,
}: {
  items: LibraryItem[];
  patronUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [lastLoanId, setLastLoanId] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const itemId = String(fd.get('itemId') ?? '').trim();
    const barcode = String(fd.get('barcode') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const dueAt = String(fd.get('dueAt') ?? '').trim();
    if (!itemId && !barcode) {
      setError('Select a catalog item or scan a barcode.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = barcode
        ? await checkoutBarcodeAction({
            barcode,
            patronUserId,
            studentId: studentId || undefined,
          })
        : await checkoutLibraryItemAction({
            itemId,
            patronUserId,
            studentId: studentId || undefined,
            dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          });
      if (result.status === 'error') {
        setError(result.message ?? 'Checkout failed');
        return;
      }
      setLastLoanId(result.id ?? null);
      setMessage(`Checked out. Loan id: ${result.id}`);
      router.refresh();
    });
  }

  function onReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const loanId = String(fd.get('loanId') ?? '').trim();
    const barcode = String(fd.get('barcode') ?? '').trim();
    if (!loanId && !barcode) {
      setError('Loan id or barcode is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = barcode
        ? await returnBarcodeAction(barcode)
        : await returnLibraryLoanAction(loanId);
      if (result.status === 'error') {
        setError(result.message ?? 'Return failed');
        return;
      }
      setMessage('Loan returned.');
      router.refresh();
    });
  }

  function onRenew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const loanId = String(fd.get('loanId') ?? '').trim();
    if (!loanId) {
      setError('Loan id is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await renewLibraryLoanAction(loanId, 14);
      if (result.status === 'error') {
        setError(result.message ?? 'Renew failed');
        return;
      }
      setMessage(result.message ?? 'Loan renewed.');
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checkout</CardTitle>
          <CardDescription>POST `/library/circulation/checkout`</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={onCheckout}
            aria-label="Checkout library item"
            data-testid="library-checkout-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="checkout-barcode" label="Scan barcode">
              <Input
                id="checkout-barcode"
                name="barcode"
                className="h-11 min-h-11"
                autoComplete="off"
                data-testid="library-checkout-barcode"
              />
            </FormField>
            <FormField id="checkout-item" label="Catalog item">
              <select
                id="checkout-item"
                name="itemId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select item…
                </option>
                {items.map((item) => (
                  <option key={item.id} value={item.id} disabled={item.available < 1}>
                    {item.title} ({item.available}/{item.copies})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="checkout-student" label="Student id (optional)">
              <Input id="checkout-student" name="studentId" className="h-11 min-h-11" />
            </FormField>
            <FormField id="checkout-due" label="Due date">
              <Input id="checkout-due" name="dueAt" type="date" className="h-11 min-h-11" />
            </FormField>
            <Button type="submit" disabled={pending} className="min-h-11">
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Working…' : 'Checkout'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Return / renew</CardTitle>
          <CardDescription>
            POST `/library/circulation/return` · `/library/circulation/renew`
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="space-y-4"
            noValidate
            onSubmit={onReturn}
            aria-label="Return library loan"
            data-testid="library-return-form"
          >
            <FormField id="return-barcode" label="Scan barcode">
              <Input
                id="return-barcode"
                name="barcode"
                className="h-11 min-h-11"
                autoComplete="off"
                data-testid="library-return-barcode"
              />
            </FormField>
            <FormField id="return-loan" label="Loan id">
              <Input
                id="return-loan"
                name="loanId"
                defaultValue={lastLoanId ?? ''}
                className="h-11 min-h-11"
              />
            </FormField>
            <Button type="submit" variant="outline" disabled={pending} className="min-h-11">
              Return loan
            </Button>
          </form>
          <form
            className="space-y-4"
            noValidate
            onSubmit={onRenew}
            aria-label="Renew library loan"
            data-testid="library-renew-form"
          >
            <FormField id="renew-loan" label="Loan id" required>
              <Input
                id="renew-loan"
                name="loanId"
                defaultValue={lastLoanId ?? ''}
                className="h-11 min-h-11"
              />
            </FormField>
            <Button type="submit" variant="outline" disabled={pending} className="min-h-11">
              Renew (+14 days)
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive lg:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground lg:col-span-2" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
