'use client';

/**
 * G-911 — approve / reject a scholarship application with a reviewer comment.
 * Both buttons call the same server action; the page re-renders with the
 * persisted decision (status pill, reviewer, note) via router.refresh().
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

import { Button, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { decideApplicationAction } from '../actions';

interface ApplicationDecisionFormProps {
  applicationId: string;
  /** Human-readable award text shown under the approve hint, e.g. "₹25,000 payment". */
  awardLabel: string | null;
}

export function ApplicationDecisionForm({
  applicationId,
  awardLabel,
}: ApplicationDecisionFormProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: 'approve' | 'reject') => {
    setMessage(null);
    setPending(decision);
    startTransition(async () => {
      const result = await decideApplicationAction({ applicationId, decision, comment });
      setPending(null);
      if (result.status === 'success') {
        setMessage({ tone: 'success', text: result.message ?? 'Saved.' });
        router.refresh();
      } else {
        setMessage({ tone: 'error', text: result.message ?? 'Decision failed.' });
      }
    });
  };

  return (
    <div
      className="space-y-4"
      data-testid="decision-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1.5">
        <label htmlFor="decision-comment" className="text-sm font-medium text-foreground">
          Comment (visible to school)
        </label>
        <Textarea
          id="decision-comment"
          name="comment"
          rows={3}
          maxLength={2000}
          placeholder="Optional note for the school coordinator…"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={isPending}
          data-testid="decision-comment"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={() => decide('reject')}
          data-testid="decision-reject"
        >
          <X className="me-1.5 h-4 w-4" aria-hidden="true" />
          {pending === 'reject' ? 'Rejecting…' : 'Reject'}
        </Button>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => decide('approve')}
          data-testid="decision-approve"
        >
          <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
      </div>
      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={
            message.tone === 'error'
              ? 'text-xs text-destructive'
              : 'text-xs text-emerald-700 dark:text-emerald-400'
          }
          data-testid="decision-message"
        >
          {message.text}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {awardLabel
            ? `Approving schedules the first ${awardLabel} for today. `
            : 'Approving schedules the first instalment for today. '}
          Verify supporting documents before approving — DBT fails if the account is not
          Aadhaar-seeded.
        </p>
      )}
    </div>
  );
}
