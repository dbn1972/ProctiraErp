/**
 * Parent message thread detail (Server Component).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listMessages, listThreads } from '@/lib/api/parent-portal';
import { ReplyForm } from '../_components/reply-form';

export const dynamic = 'force-dynamic';

export default async function ParentThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  await requireSession();
  const { threadId } = await params;
  const [threads, messages] = await Promise.all([listThreads(), listMessages(threadId)]);
  const thread = threads.find((row) => row.id === threadId);

  if (!thread) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {thread.subject}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Student {thread.studentId.slice(0, 8)}… · {thread.status}
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-12">
          <Link href="/parent/messages">Back to messages</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
          <CardDescription>
            {messages.length === 0
              ? 'No messages in this thread.'
              : `${messages.length} message${messages.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No messages in this thread.
            </p>
          ) : (
            <ul className="space-y-4" role="list">
              {messages.map((message) => (
                <li key={message.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {message.senderRole} · {new Date(message.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{message.body}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ReplyForm threadId={threadId} />
    </div>
  );
}
