'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { sendCampaignAction } from '../actions';

export function SendCampaignButton({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [honesty, setHonesty] = useState<string | null>(null);
  const canSend = status === 'draft' || status === 'scheduled';

  if (!canSend) {
    return null;
  }

  function onSend() {
    startTransition(async () => {
      setMessage(null);
      setHonesty(null);
      const result = await sendCampaignAction(campaignId);
      if (result.status === 'error') {
        setMessage(result.message ?? 'Send failed');
        return;
      }
      setMessage(result.message ?? 'Sent');
      setHonesty(result.honestyNote ?? null);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11"
        disabled={pending}
        onClick={onSend}
        data-testid="send-campaign-button"
      >
        <Send className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {pending ? 'Sending…' : 'Sandbox send'}
      </Button>
      {message ? (
        <p className="text-xs text-foreground" role="status">
          {message}
        </p>
      ) : null}
      {honesty ? <p className="text-xs text-muted-foreground">{honesty}</p> : null}
    </div>
  );
}
