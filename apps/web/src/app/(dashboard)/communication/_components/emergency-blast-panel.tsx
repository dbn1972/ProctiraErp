'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Textarea,
} from '@proctira/ui/components';

import {
  confirmEmergencyBlastAction,
  createEmergencyBlastAction,
  dispatchEmergencyBlastAction,
} from '../actions';
import type { EmergencyBlast } from '@/lib/api/communication';

const CHANNELS = ['sms', 'push', 'email', 'in_app'] as const;

export function EmergencyBlastPanel({
  actorId,
  initialBlasts,
}: {
  actorId: string;
  initialBlasts: EmergencyBlast[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [honesty, setHonesty] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [channels, setChannels] = useState<string[]>(['sms', 'push']);
  const [confirmAck, setConfirmAck] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const reason = String(fd.get('reason') ?? '').trim();
    if (!reason) {
      setError('Reason is required.');
      return;
    }
    if (channels.length === 0) {
      setError('Select at least one channel.');
      return;
    }
    if (!confirmAck) {
      setError('Acknowledge the dual-confirm requirement before drafting.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      setHonesty(null);
      const result = await createEmergencyBlastAction({
        reason,
        channels,
        createdBy: actorId,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to draft blast');
        return;
      }
      setMessage(result.message ?? 'Drafted.');
      setConfirmAck(false);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onConfirm(blastId: string) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      setHonesty(null);
      const result = await confirmEmergencyBlastAction(blastId, actorId);
      if (result.status === 'error') {
        setError(result.message ?? 'Confirm failed');
        return;
      }
      setMessage(result.message ?? 'Confirmed.');
      router.refresh();
    });
  }

  function onDispatch(blastId: string) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      setHonesty(null);
      const result = await dispatchEmergencyBlastAction(blastId);
      if (result.status === 'error') {
        setError(result.message ?? 'Dispatch failed');
        return;
      }
      setMessage(result.message ?? 'Dispatched.');
      setHonesty(result.honestyNote ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Draft emergency blast
          </CardTitle>
          <CardDescription>
            Requires two distinct confirmations before send. Quiet hours are bypassed on confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            noValidate
            onSubmit={onCreate}
            aria-label="Draft emergency blast"
            data-testid="emergency-blast-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="blast-reason" label="Reason" required>
              <Textarea
                id="blast-reason"
                name="reason"
                rows={4}
                placeholder="Why this emergency notice is being issued…"
                className="min-h-24"
              />
            </FormField>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">
                Channels <span className="text-destructive">*</span>
              </legend>
              <div className="flex flex-wrap gap-3">
                {CHANNELS.map((channel) => (
                  <label key={channel} className="inline-flex min-h-11 items-center gap-2 text-sm">
                    <Checkbox
                      checked={channels.includes(channel)}
                      onCheckedChange={(value) => {
                        setChannels((prev) =>
                          value === true
                            ? prev.includes(channel)
                              ? prev
                              : [...prev, channel]
                            : prev.filter((c) => c !== channel),
                        );
                      }}
                      aria-label={channel}
                    />
                    <span>{channel}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="inline-flex min-h-11 items-start gap-2 text-sm">
              <Checkbox
                checked={confirmAck}
                onCheckedChange={(value) => setConfirmAck(value === true)}
                aria-label="Acknowledge dual confirm"
              />
              <span>
                I understand this blast needs a second distinct confirmer before it can send.
              </span>
            </label>
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
            {honesty ? <p className="text-xs text-muted-foreground">{honesty}</p> : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                {pending ? 'Saving…' : 'Draft blast'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open blasts</CardTitle>
          <CardDescription>
            Confirm as the signed-in actor. A second distinct actor must confirm before the blast
            can send.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialBlasts.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No emergency blasts yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {initialBlasts.map((blast) => (
                <li
                  key={blast.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  data-testid="emergency-blast-row"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{blast.reason}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {blast.status} · {blast.channels.join(', ')}
                      {blast.confirmActor1 ? ' · confirm 1 recorded' : ''}
                      {blast.confirmActor2 ? ' · confirm 2 recorded' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {blast.status === 'pending_confirm' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() => onConfirm(blast.id)}
                      >
                        Confirm as me
                      </Button>
                    ) : null}
                    {blast.status === 'confirmed' ? (
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() => onDispatch(blast.id)}
                        data-testid="dispatch-emergency-button"
                      >
                        Sandbox dispatch
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
