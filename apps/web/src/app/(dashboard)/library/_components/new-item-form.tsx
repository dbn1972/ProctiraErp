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

import { createLibraryItemAction } from '../../campus-actions';

export function NewLibraryItemForm() {
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
    const title = String(fd.get('title') ?? '').trim();
    const author = String(fd.get('author') ?? '').trim();
    const isbn = String(fd.get('isbn') ?? '').trim();
    const copiesRaw = String(fd.get('copies') ?? '').trim();
    if (!title) {
      setError('Title is required.');
      return;
    }
    const copies = copiesRaw ? Number(copiesRaw) : undefined;
    if (copiesRaw && (!Number.isFinite(copies) || (copies as number) < 1)) {
      setError('Copies must be at least 1.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createLibraryItemAction({
        title,
        author: author || undefined,
        isbn: isbn || undefined,
        copies,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create item');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add catalog item</CardTitle>
        <CardDescription>Creates a holding via POST `/library/items`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create library item"
          data-testid="library-item-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="item-title" label="Title" required>
            <Input id="item-title" name="title" className="h-11 min-h-11" />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="item-author" label="Author">
              <Input id="item-author" name="author" className="h-11 min-h-11" />
            </FormField>
            <FormField id="item-isbn" label="ISBN">
              <Input id="item-isbn" name="isbn" className="h-11 min-h-11" />
            </FormField>
          </div>
          <FormField id="item-copies" label="Copies">
            <Input
              id="item-copies"
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
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Add item'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
