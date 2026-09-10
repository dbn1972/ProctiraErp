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

import { importIsbnAction } from '../../campus-ops-actions';

export function IsbnImportForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const isbn = String(fd.get('isbn') ?? '').trim();
    const copiesRaw = String(fd.get('copies') ?? '').trim();
    if (!isbn) {
      setError('ISBN is required.');
      return;
    }
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await importIsbnAction({
        isbn,
        copies: copiesRaw ? Number(copiesRaw) : undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Import failed');
        return;
      }
      setMessage(result.message ?? 'Imported.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Import from ISBN</CardTitle>
        <CardDescription>
          Uses the sandbox catalog by default. Live Open Library is env-gated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Import library item from ISBN"
          data-testid="library-isbn-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="isbn-value" label="ISBN" required>
            <Input id="isbn-value" name="isbn" className="h-11 min-h-11" />
          </FormField>
          <FormField id="isbn-copies" label="Copies">
            <Input
              id="isbn-copies"
              name="copies"
              type="number"
              min="1"
              defaultValue={1}
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
            {pending ? 'Importing…' : 'Import ISBN'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
