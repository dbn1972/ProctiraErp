'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useHydrated } from '@/hooks/useHydrated';

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

import { placeHoldAction } from '../../campus-ops-actions';
import type { LibraryItem } from '@/lib/api/library';

export function PlaceHoldForm({
  items,
  defaultItemId,
}: {
  items: LibraryItem[];
  defaultItemId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const itemId = String(fd.get('itemId') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const patronUserId = String(fd.get('patronUserId') ?? '').trim();
    if (!itemId) {
      setError('Select a title.');
      return;
    }
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await placeHoldAction({
        itemId,
        studentId: studentId || undefined,
        patronUserId: patronUserId || undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Hold failed');
        return;
      }
      setMessage(result.message ?? 'Hold placed.');
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Place hold</CardTitle>
        <CardDescription>Queue a patron when no copies are on the shelf.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Place library hold"
          data-testid="library-hold-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="hold-item" label="Title" required>
            <select
              id="hold-item"
              name="itemId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={defaultItemId ?? ''}
            >
              <option value="" disabled>
                Select title…
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.available}/{item.copies})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="hold-student" label="Student id">
            <Input id="hold-student" name="studentId" className="h-11 min-h-11" />
          </FormField>
          <FormField id="hold-patron" label="Patron user id">
            <Input id="hold-patron" name="patronUserId" className="h-11 min-h-11" />
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
            {pending ? 'Queuing…' : 'Place hold'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
