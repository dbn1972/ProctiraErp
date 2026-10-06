'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { EntityLabelOption } from '@/lib/entity-label';

import {
  createDiscussionAction,
  createDiscussionPostAction,
  hidePostAction,
  lockDiscussionAction,
  pinPostAction,
} from '../depth-actions';
import { SchoolField } from './school-field';

export function DiscussionCreateForm({ schools = [] }: { schools?: EntityLabelOption[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createDiscussionAction({
        classKey: String(form.get('classKey') ?? ''),
        title: String(form.get('title') ?? ''),
        institutionId: String(form.get('institutionId') ?? ''),
      });
      setMessage(result.status === 'success' ? 'Thread opened.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-3"
      data-testid="lms-discussion-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="disc-class">Class</Label>
        <Input id="disc-class" name="classKey" required placeholder="7A" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="disc-title">Title</Label>
        <Input id="disc-title" name="title" required className="h-11" />
      </div>
      <SchoolField id="disc-school" schools={schools} />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        Open thread
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

export function DiscussionModeration({
  threadId,
  locked,
  posts,
}: {
  threadId: string;
  locked: boolean;
  posts: Array<{ id: string; body: string; hidden: boolean; pinned?: boolean }>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  // PRC-M106: every moderation action reports its outcome per thread.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function run(action: () => Promise<{ status: string; message?: string }>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.status !== 'success') {
        setError(result.message ?? 'Action failed.');
        return;
      }
      setNotice(success);
      router.refresh();
    });
  }
  return (
    <div
      className="space-y-3"
      data-testid="lms-discussion-moderation"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => lockDiscussionAction(threadId, !locked),
              locked ? 'Thread unlocked.' : 'Thread locked.',
            )
          }
        >
          {locked ? 'Unlock' : 'Lock'} thread
        </Button>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const body = String(new FormData(form).get('body') ?? '');
          setError(null);
          setNotice(null);
          startTransition(async () => {
            const result = await createDiscussionPostAction(threadId, body);
            if (result.status !== 'success') {
              setError(result.message ?? 'Reply could not be posted.');
              return;
            }
            form.reset();
            setNotice('Reply posted.');
            router.refresh();
          });
        }}
      >
        <Label htmlFor={`post-${threadId}`} className="sr-only">
          Reply
        </Label>
        <Textarea id={`post-${threadId}`} name="body" required rows={2} className="flex-1" />
        <Button
          type="submit"
          disabled={pending || locked}
          title={locked ? 'Thread is locked' : undefined}
        >
          Reply
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="discussion-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <ul className="space-y-2">
        {posts.map((post) => (
          <li key={post.id} className="rounded border p-3 text-sm">
            <p className={post.hidden ? 'text-muted-foreground line-through' : undefined}>
              {post.body}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => pinPostAction(threadId, post.id, !post.pinned),
                  post.pinned ? 'Post unpinned.' : 'Post pinned.',
                )
              }
            >
              {post.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => hidePostAction(threadId, post.id, !post.hidden),
                  post.hidden ? 'Post unhidden.' : 'Post hidden.',
                )
              }
            >
              {post.hidden ? 'Unhide' : 'Hide'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
