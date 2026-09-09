'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { createContentAction } from '../depth-actions';

export function ContentForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createContentAction({
        scope: 'school',
        institutionId: String(form.get('institutionId') ?? ''),
        title: String(form.get('title') ?? ''),
        kind: String(form.get('kind') ?? 'text') as 'link' | 'file' | 'text',
        body: String(form.get('body') ?? ''),
        classKey: String(form.get('classKey') ?? ''),
        subject: String(form.get('subject') ?? ''),
        published: form.get('published') === 'on',
      });
      setMessage(result.status === 'success' ? 'Content saved.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
      data-testid="lms-content-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="content-title">Title</Label>
        <Input id="content-title" name="title" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="content-school">School ID</Label>
        <Input id="content-school" name="institutionId" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="content-kind">Kind</Label>
        <select
          id="content-kind"
          name="kind"
          className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="text">Text</option>
          <option value="link">Link</option>
          <option value="file">File</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="content-class">Class</Label>
        <Input id="content-class" name="classKey" placeholder="7A" className="h-11" />
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label htmlFor="content-body">Body or URL</Label>
        <Textarea id="content-body" name="body" rows={3} />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="published"
          className="size-12 shrink-0 rounded border border-input"
        />
        Publish for students
      </label>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        Save content
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
