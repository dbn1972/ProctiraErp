'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, FormField, Input } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useHydrated } from '@/hooks/useHydrated';

import { ackCircularAction, sendCircularAction } from '../actions';

export function CircularAckPanel({
  circularId,
  status,
  ackRate,
}: {
  circularId: string;
  status: string;
  ackRate: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  function onConfirmSend() {
    startTransition(async () => {
      setError(null);
      const result = await sendCircularAction(circularId);
      if (result.status === 'error') {
        setError(result.message ?? 'Send failed');
        return;
      }
      setMessage(result.message ?? 'Sent');
      setConfirmSend(false);
      router.refresh();
    });
  }

  function onAck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await ackCircularAction(circularId, String(fd.get('recipientId') ?? ''));
      if (result.status === 'error') {
        setError(result.message ?? 'Ack failed');
        return;
      }
      setMessage(result.message ?? 'Acknowledged');
      router.refresh();
    });
  }

  return (
    <div
      className="space-y-4"
      data-testid="circular-ack-panel"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <p className="text-sm text-muted-foreground">
        Status {status} · ack rate {Math.round(ackRate * 100)}%
      </p>
      {status !== 'sent' ? (
        <Button type="button" onClick={() => setConfirmSend(true)} disabled={!hydrated || pending}>
          {pending ? 'Sending…' : 'Send circular'}
        </Button>
      ) : null}
      <ConfirmActionDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="Send this circular?"
        description="Recipients will receive the circular and acknowledgement tracking will start. Confirm the audience before sending."
        confirmLabel="Send circular"
        pending={pending}
        onConfirm={onConfirmSend}
        testId="send-circular-confirm"
      />
      <form onSubmit={onAck} className="flex flex-wrap items-end gap-2">
        <FormField id="ack-recipient" label="Recipient id">
          <Input id="ack-recipient" name="recipientId" required disabled={!hydrated || pending} />
        </FormField>
        <Button type="submit" variant="outline" disabled={!hydrated || pending}>
          Record ack
        </Button>
      </form>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
