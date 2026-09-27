/**
 * Parent messages list (Server Component).
 */
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listChildrenResult, listThreadsResult } from '@/lib/api/parent-portal';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import type { ListFailureKind } from '@/lib/api/list-result';
import { humanizeStatus } from '@/lib/status-label';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentLabelsForIds } from '@/lib/load-entity-labels';
import { CreateThreadForm } from './_components/create-thread-form';

export const dynamic = 'force-dynamic';

export default async function ParentMessagesPage() {
  await requireSession();
  const [threadsResult, childrenResult] = await Promise.all([
    listThreadsResult(),
    listChildrenResult(),
  ]);
  if (!threadsResult.ok) {
    return <ParentMessagesFailure kind={threadsResult.kind} status={threadsResult.status} />;
  }
  if (!childrenResult.ok) {
    return <ParentMessagesFailure kind={childrenResult.kind} status={childrenResult.status} />;
  }
  const threads = threadsResult.items;
  const children = childrenResult.items;
  const studentIds = children.map((child) => child.studentId);
  const studentLabels = Object.fromEntries(await loadStudentLabelsForIds(studentIds));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Messages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Two-way conversations with your school about your children.
          </p>
        </div>
      </div>

      <CreateThreadForm studentIds={studentIds} studentLabels={studentLabels} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversations</CardTitle>
          <CardDescription>
            {threads.length === 0
              ? 'Start a conversation below.'
              : `${threads.length} thread${threads.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No conversations yet. Start a new message above — your school will reply here.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="parent-thread-row"
                >
                  <Link
                    href={`/parent/messages/${thread.id}`}
                    className="block min-h-12 rounded-md px-1 py-2 hover:bg-muted/60"
                  >
                    <p className="text-sm font-medium text-foreground">{thread.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {resolveEntityLabel(thread.studentId, studentLabels, 'Child')} ·{' '}
                      {humanizeStatus(thread.status)} ·{' '}
                      {new Date(thread.updatedAt).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ParentMessagesFailure({ kind, status }: { kind: ListFailureKind; status: number }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two-way conversations with your school about your children.
        </p>
      </div>
      <ListLoadFailure kind={kind} status={status} returnTo="/parent/messages" />
    </div>
  );
}
