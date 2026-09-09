'use client';

import { useEffect, useState, useTransition } from 'react';
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

import { createInvoiceAction } from '../../fees-actions';
import type { FeePlan } from '@/lib/api/fees';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NewInvoiceForm({ plans }: { plans: FeePlan[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const studentId = String(fd.get('studentId') ?? '').trim();
    const planId = String(fd.get('planId') ?? '').trim();
    const title = String(fd.get('title') ?? '').trim();
    const amountRupeesRaw = String(fd.get('amount') ?? '').trim();
    const amountRupees = amountRupeesRaw === '' ? undefined : Number(amountRupeesRaw);

    if (!UUID_RE.test(studentId)) {
      setError('Student must be a UUID v4 value.');
      return;
    }
    if (!planId && (!title || amountRupees === undefined || !Number.isFinite(amountRupees))) {
      setError('Choose a plan, or provide title and amount.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createInvoiceAction({
        studentId,
        planId: planId || undefined,
        title: title || undefined,
        amountCents: amountRupees === undefined ? undefined : Math.round(amountRupees * 100),
        currency: 'INR',
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create invoice');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Issue invoice</CardTitle>
        <CardDescription>
          Create from a fee plan or ad-hoc. Parents see open invoices in the family portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
          <FormField id="invoice-student" label="Student UUID" required>
            <Input id="invoice-student" name="studentId" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="invoice-plan" label="Fee plan (optional)">
            <select
              id="invoice-plan"
              name="planId"
              className="flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue=""
              disabled={!hydrated || pending}
            >
              <option value="">Ad-hoc (no plan)</option>
              {plans
                .filter((plan) => plan.status === 'active')
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.code} — {plan.name}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField id="invoice-title" label="Title override (optional)">
            <Input id="invoice-title" name="title" disabled={!hydrated || pending} />
          </FormField>
          <FormField id="invoice-amount" label="Amount override INR (optional)">
            <Input
              id="invoice-amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              disabled={!hydrated || pending}
            />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Issuing…' : 'Issue invoice'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
