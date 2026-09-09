'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { createCircularAction } from '../actions';

const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp'] as const;
const AUDIENCES = [
  { value: 'all', label: 'Entire tenant' },
  { value: 'roles', label: 'Roles' },
  { value: 'classes', label: 'Classes' },
  { value: 'institution', label: 'Institution' },
] as const;

export function NewCircularForm({ createdBy }: { createdBy?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<string[]>(['in_app', 'whatsapp']);
  const [requiresAck, setRequiresAck] = useState(true);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const audienceType = String(fd.get('audienceType') ?? 'all') as
      | 'all'
      | 'roles'
      | 'classes'
      | 'institution';
    const audienceIds = String(fd.get('audienceIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const recipientIds = String(fd.get('recipientIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      setError(null);
      const result = await createCircularAction({
        title: String(fd.get('title') ?? '').trim(),
        body: String(fd.get('body') ?? '').trim(),
        audienceType,
        audienceIds: audienceIds.length ? audienceIds : undefined,
        recipientIds,
        requiresAck,
        channels,
        createdBy,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.push(`/communication/circulars/${result.id}`);
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">New circular</CardTitle>
        <CardDescription>
          WhatsApp uses the sandbox adapter (no live provider). Recipients listed here get ack rows
          when acknowledgement is required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          data-testid="communication-circular-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="circ-title" label="Title" required>
            <Input id="circ-title" name="title" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="circ-body" label="Body" required>
            <Textarea id="circ-body" name="body" required disabled={!hydrated || pending} />
          </FormField>
          <FormField id="circ-audience" label="Audience">
            <select
              id="circ-audience"
              name="audienceType"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue="all"
              disabled={!hydrated || pending}
            >
              {AUDIENCES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="circ-audience-ids" label="Audience ids (comma-separated)">
            <Input id="circ-audience-ids" name="audienceIds" disabled={!hydrated || pending} />
          </FormField>
          <FormField id="circ-recipients" label="Recipient ids (comma-separated)" required>
            <Input
              id="circ-recipients"
              name="recipientIds"
              required
              disabled={!hydrated || pending}
            />
          </FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Channels</legend>
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={(checked) => {
                    setChannels((prev) => {
                      if (checked) return prev.includes(channel) ? prev : [...prev, channel];
                      return prev.filter((c) => c !== channel);
                    });
                  }}
                  disabled={!hydrated || pending}
                />
                {channel}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={requiresAck}
              onCheckedChange={(checked) => setRequiresAck(Boolean(checked))}
              disabled={!hydrated || pending}
            />
            Requires acknowledgement
          </label>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Saving…' : 'Create circular'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
