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
import { listMessagesResult, listThreadsResult } from '@/lib/api/parent-portal';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { humanizeStatus } from '@/lib/status-label';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelsForIds } from '@/lib/load-entity-labels';
import { ReplyForm } from '../_components/reply-form';

export const dynamic = 'force-dynamic';

export default async function ParentThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  await requireSession();
  const { threadId } = await params;
  const [threadsResult, messagesResult] = await Promise.all([
    listThreadsResult(),
    listMessagesResult(threadId),
  ]);
  if (!threadsResult.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Message</h1>
        <ListLoadFailure
          kind={threadsResult.kind}
          status={threadsResult.status}
          returnTo="/parent/messages"
        />
      </div>
    );
  }
  const threads = threadsResult.items;
  const thread = threads.find((row) => row.id === threadId);

  if (!thread) {
    notFound();
  }

  const studentLabels = await loadStudentLabelsForIds([thread.studentId]);
  const messages = messagesResult.ok ? messagesResult.items : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {thread.subject}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolveEntityLabel(thread.studentId, studentLabels, 'Child')} ·{' '}
            {humanizeStatus(thread.status)}
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
            {!messagesResult.ok
              ? 'Messages could not be loaded.'
              : messages.length === 0
                ? 'No messages in this thread.'
                : `${messages.length} message${messages.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!messagesResult.ok ? (
            <ListLoadFailure
              kind={messagesResult.kind}
              status={messagesResult.status}
              returnTo={`/parent/messages/${threadId}`}
            />
          ) : messages.length === 0 ? (
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
