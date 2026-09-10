'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { createLessonAction } from '../depth-actions';

export function LessonForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createLessonAction({
        institutionId: String(form.get('institutionId') ?? ''),
        title: String(form.get('title') ?? ''),
        subject: String(form.get('subject') ?? ''),
        description: String(form.get('description') ?? ''),
        resourceTitle: String(form.get('resourceTitle') ?? ''),
        resourceUrl: String(form.get('resourceUrl') ?? ''),
        published: form.get('published') === 'on',
      });
      setMessage(result.status === 'success' ? 'Lesson saved.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
      data-testid="lms-lesson-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="lesson-title">Title</Label>
        <Input id="lesson-title" name="title" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lesson-school">School ID</Label>
        <Input id="lesson-school" name="institutionId" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lesson-subject">Subject</Label>
        <Input id="lesson-subject" name="subject" className="h-11" />
      </div>
      <label
        htmlFor="lesson-published"
        className="flex min-h-11 cursor-pointer items-center gap-2 sm:col-span-2"
      >
        <input
          id="lesson-published"
          name="published"
          type="checkbox"
          className="size-12 shrink-0 rounded border border-input"
        />
        <span className="text-sm font-medium">Published</span>
      </label>
      <div className="sm:col-span-2 space-y-1">
        <Label htmlFor="lesson-body">Description</Label>
        <Textarea id="lesson-body" name="description" rows={3} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lesson-resource">Resource title</Label>
        <Input id="lesson-resource" name="resourceTitle" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lesson-url">Video or link URL</Label>
        <Input id="lesson-url" name="resourceUrl" className="h-11" />
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        Save lesson
      </Button>
      {message ? (
        <p role="status" className="sm:col-span-2 text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
