'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import {
  createDiscussionAction,
  createDiscussionPostAction,
  hidePostAction,
  lockDiscussionAction,
  pinPostAction,
} from '../depth-actions';

export function DiscussionCreateForm() {
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
      <div className="space-y-1">
        <Label htmlFor="disc-school">School ID (optional)</Label>
        <Input id="disc-school" name="institutionId" className="h-11" />
      </div>
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
            startTransition(async () => {
              await lockDiscussionAction(threadId, !locked);
              router.refresh();
            })
          }
        >
          {locked ? 'Unlock' : 'Lock'} thread
        </Button>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const body = String(new FormData(event.currentTarget).get('body') ?? '');
          startTransition(async () => {
            await createDiscussionPostAction(threadId, body);
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
                startTransition(async () => {
                  await pinPostAction(threadId, post.id, !post.pinned);
                  router.refresh();
                })
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
                startTransition(async () => {
                  await hidePostAction(threadId, post.id, !post.hidden);
                  router.refresh();
                })
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
