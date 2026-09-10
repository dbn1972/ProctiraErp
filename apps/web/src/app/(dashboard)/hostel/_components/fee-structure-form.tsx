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

import { createHostelFeeStructureAction } from '../../campus-ops-actions';
import type { Hostel } from '@/lib/api/hostel';

export function HostelFeeStructureForm({ hostels }: { hostels: Hostel[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const roomType = String(fd.get('roomType') ?? '').trim();
    const termLabel = String(fd.get('termLabel') ?? '').trim();
    const amountCents = Number(fd.get('amountCents'));
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await createHostelFeeStructureAction({
        hostelId,
        roomType,
        termLabel,
        amountCents,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Save failed');
        return;
      }
      setMessage(result.message ?? 'Saved.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Fee structure</CardTitle>
        <CardDescription>
          Amount per room type × term. Fees reads the summary route.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel fee structure"
          data-testid="hostel-fee-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="fee-hostel" label="Hostel" required>
            <select
              id="fee-hostel"
              name="hostelId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select hostel…
              </option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="fee-room" label="Room type" required>
            <Input id="fee-room" name="roomType" className="h-11 min-h-11" />
          </FormField>
          <FormField id="fee-term" label="Term" required>
            <Input id="fee-term" name="termLabel" className="h-11 min-h-11" />
          </FormField>
          <FormField id="fee-amount" label="Amount (cents)" required>
            <Input
              id="fee-amount"
              name="amountCents"
              type="number"
              min="0"
              className="h-11 min-h-11"
            />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? 'Saving…' : 'Save structure'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
