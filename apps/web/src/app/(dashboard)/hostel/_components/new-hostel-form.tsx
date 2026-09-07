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

import { createHostelAction } from '../../campus-actions';

export function NewHostelForm() {
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
    const name = String(fd.get('name') ?? '').trim();
    const code = String(fd.get('code') ?? '').trim();
    const address = String(fd.get('address') ?? '').trim();
    const capacityRaw = String(fd.get('capacity') ?? '').trim();
    if (!name || !code) {
      setError('Name and code are required.');
      return;
    }
    const capacity = capacityRaw ? Number(capacityRaw) : undefined;
    if (capacityRaw && (!Number.isFinite(capacity) || (capacity as number) < 0)) {
      setError('Capacity must be a non-negative number.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelAction({
        name,
        code,
        address: address || undefined,
        capacity,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create hostel');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add hostel</CardTitle>
        <CardDescription>Creates a hostel via POST `/hostel`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel"
          data-testid="hostel-create-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="hostel-name" label="Name" required>
              <Input id="hostel-name" name="name" className="h-11 min-h-11" />
            </FormField>
            <FormField id="hostel-code" label="Code" required>
              <Input id="hostel-code" name="code" className="h-11 min-h-11" />
            </FormField>
          </div>
          <FormField id="hostel-address" label="Address">
            <Input id="hostel-address" name="address" className="h-11 min-h-11" />
          </FormField>
          <FormField id="hostel-capacity" label="Capacity">
            <Input
              id="hostel-capacity"
              name="capacity"
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
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create hostel'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
