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
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { useHydrated } from '@/hooks/useHydrated';
import type { EntityLabelOption } from '@/lib/entity-label';
import { channelLabel } from '@/lib/communication/channel-label';

import { createCircularAction } from '../actions';
import { PersonMultiSelect } from './person-multi-select';

const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp'] as const;
const AUDIENCES = [
  { value: 'all', label: 'Entire tenant' },
  { value: 'roles', label: 'Roles' },
  { value: 'classes', label: 'Classes' },
  { value: 'institution', label: 'Institution' },
] as const;

export function NewCircularForm({
  createdBy,
  people,
  roleOptions,
  classOptions,
  institutionOptions,
}: {
  createdBy?: string;
  people: EntityLabelOption[];
  roleOptions: EntityLabelOption[];
  classOptions: EntityLabelOption[];
  institutionOptions: EntityLabelOption[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<string[]>(['in_app', 'whatsapp']);
  const [requiresAck, setRequiresAck] = useState(true);
  const [audienceType, setAudienceType] = useState<(typeof AUDIENCES)[number]['value']>('all');

  const audienceOptions =
    audienceType === 'roles'
      ? roleOptions
      : audienceType === 'classes'
        ? classOptions
        : audienceType === 'institution'
          ? institutionOptions
          : [];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const recipientIds = fd
      .getAll('recipientIds')
      .map((value) => String(value).trim())
      .filter(Boolean);
    const audienceId = String(fd.get('audienceIds') ?? '').trim();
    if (recipientIds.length === 0) {
      setError('Add at least one recipient by name before creating the circular.');
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await createCircularAction({
        title: String(fd.get('title') ?? '').trim(),
        body: String(fd.get('body') ?? '').trim(),
        audienceType,
        audienceIds: audienceType === 'all' || !audienceId ? undefined : [audienceId],
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
          WhatsApp uses the sandbox adapter (no live provider). Recipients you add get
          acknowledgement rows when acknowledgement is required.
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
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={audienceType}
              onChange={(event) =>
                setAudienceType(event.target.value as (typeof AUDIENCES)[number]['value'])
              }
              disabled={!hydrated || pending}
            >
              {AUDIENCES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </FormField>
          {audienceType !== 'all' ? (
            <EntitySearchSelect
              key={audienceType}
              id="circ-audience-target"
              name="audienceIds"
              label={
                audienceType === 'roles' ? 'Role' : audienceType === 'classes' ? 'Class' : 'School'
              }
              options={audienceOptions}
              emptyMessage="No matching records loaded for this audience."
            />
          ) : null}
          <PersonMultiSelect
            id="circ-recipients"
            name="recipientIds"
            label="Recipients"
            options={people}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Channels</legend>
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={(checked) => {
                    setChannels((prev) => {
                      if (checked) return prev.includes(channel) ? prev : [...prev, channel];
                      return prev.filter((item) => item !== channel);
                    });
                  }}
                  disabled={!hydrated || pending}
                  aria-label={channelLabel(channel)}
                />
                {channelLabel(channel)}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm">
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
          <Button type="submit" className="min-h-11" disabled={!hydrated || pending}>
            {pending ? 'Saving…' : 'Create circular'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
