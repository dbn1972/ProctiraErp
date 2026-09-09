'use client';

import { useState, useTransition } from 'react';
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
import { useHydrated } from '@/hooks/useHydrated';

import { createLibraryItemAction } from '../../campus-actions';
import { lookupIsbnFillAction } from '../../campus-ops-actions';

export function NewLibraryItemForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');

  function onLookup() {
    const value = isbn.trim();
    if (!value) {
      setError('Enter an ISBN to look up.');
      return;
    }
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await lookupIsbnFillAction(value);
      if (result.status === 'error') {
        setError(result.message ?? 'Lookup failed');
        return;
      }
      setTitle(result.title ?? '');
      setAuthor(result.author ?? '');
      if (result.isbn) setIsbn(result.isbn);
      setMessage(result.message ?? 'Fields filled from ISBN.');
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const nextTitle = String(fd.get('title') ?? '').trim();
    const nextAuthor = String(fd.get('author') ?? '').trim();
    const nextIsbn = String(fd.get('isbn') ?? '').trim();
    const copiesRaw = String(fd.get('copies') ?? '').trim();
    if (!nextTitle) {
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
      setMessage(null);
      const result = await createLibraryItemAction({
        title: nextTitle,
        author: nextAuthor || undefined,
        isbn: nextIsbn || undefined,
        copies,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create item');
        return;
      }
      setTitle('');
      setAuthor('');
      setIsbn('');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add catalog item</CardTitle>
        <CardDescription>
          Look up an ISBN to fill title and author, then save the holding.
        </CardDescription>
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
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <FormField id="item-isbn" label="ISBN">
              <Input
                id="item-isbn"
                name="isbn"
                value={isbn}
                onChange={(event) => setIsbn(event.target.value)}
                className="h-11 min-h-11"
                data-testid="library-isbn-input"
              />
            </FormField>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={pending}
              onClick={onLookup}
              data-testid="library-isbn-lookup"
            >
              {pending ? 'Looking up…' : 'Look up ISBN'}
            </Button>
          </div>
          <FormField id="item-title" label="Title" required>
            <Input
              id="item-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-11 min-h-11"
              data-testid="library-title-input"
            />
          </FormField>
          <FormField id="item-author" label="Author">
            <Input
              id="item-author"
              name="author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="h-11 min-h-11"
              data-testid="library-author-input"
            />
          </FormField>
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
          {message ? (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
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
