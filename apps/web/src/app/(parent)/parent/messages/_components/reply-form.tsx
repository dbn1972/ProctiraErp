'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Textarea,
} from '@proctira/ui/components';

import { replyToThreadAction } from '../../../parent-actions';

export function ReplyForm({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const body = String(fd.get('body') ?? '').trim();
    if (!body) {
      setError('Message is required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await replyToThreadAction(threadId, body);
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to send reply');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Reply</CardTitle>
        <CardDescription>Send a message in this thread.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" noValidate onSubmit={onSubmit} aria-label="Reply to thread">
          <FormField id="reply-body" label="Message" required>
            <Textarea id="reply-body" name="body" rows={3} className="min-h-[96px]" />
          </FormField>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="min-h-12">
              <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
