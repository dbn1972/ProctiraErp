'use client';

/**
 * Approve / Reject actions for a pending workflow approval card.
 *
 * Posts to POST /workflows/instances/:id/transition (ProctiraERP Req 13.1).
 * Layout per redesign/web/workflows-approvals.html.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';

import { Button, Textarea } from '@proctira/ui/components';

import {
  approveWorkflowAction,
  rejectWorkflowAction,
} from '../../actions';

interface Props {
  instanceId: string;
}

export function ApprovalActions({ instanceId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(action: 'approve' | 'reject') {
    setError(null);
    setDone(null);
    const formData = new FormData();
    if (comments.trim()) formData.set('comments', comments.trim());

    startTransition(async () => {
      const result =
        action === 'approve'
          ? await approveWorkflowAction(instanceId, formData)
          : await rejectWorkflowAction(instanceId, formData);
      if (result.status === 'error') {
        setError(result.message ?? 'Action failed');
      } else {
        setDone(result.message ?? 'Done');
        router.refresh();
      }
    });
  }

  if (done) {
    return (
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Textarea
        rows={2}
        placeholder="Optional comment…"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run('approve')}>
          <Check className="me-1 h-4 w-4" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => run('reject')}
        >
          <X className="me-1 h-4 w-4" aria-hidden="true" />
          Reject
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
