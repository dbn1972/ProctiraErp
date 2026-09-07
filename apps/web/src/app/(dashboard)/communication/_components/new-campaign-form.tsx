'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Check } from 'lucide-react';

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

import { createCampaignAction, previewAudienceAction } from '../actions';

const CHANNELS = ['email', 'sms', 'push', 'in_app'] as const;
const SCOPES = [
  { value: 'all', label: 'Entire tenant' },
  { value: 'grade', label: 'Grade / class' },
  { value: 'hostel', label: 'Hostel residents' },
  { value: 'route', label: 'Transport route' },
] as const;

export function NewCampaignForm({ createdBy }: { createdBy?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [channels, setChannels] = useState<string[]>(['email', 'in_app']);
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('all');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [honestyNote, setHonestyNote] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function toggleChannel(channel: string, checked: boolean) {
    setChannels((prev) => {
      if (checked) return prev.includes(channel) ? prev : [...prev, channel];
      return prev.filter((c) => c !== channel);
    });
  }

  function buildAudience(fd: FormData): Record<string, unknown> {
    const audience: Record<string, unknown> = { scope };
    if (scope === 'grade') {
      audience['grade'] = String(fd.get('grade') ?? '').trim() || 'all';
    }
    if (scope === 'hostel') {
      const hostelId = String(fd.get('hostelId') ?? '').trim();
      if (hostelId) audience['hostelId'] = hostelId;
    }
    if (scope === 'route') {
      const routeId = String(fd.get('routeId') ?? '').trim();
      if (routeId) audience['routeId'] = routeId;
    }
    return audience;
  }

  function onPreview(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const form = event.currentTarget.form;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      setError(null);
      const result = await previewAudienceAction(buildAudience(fd));
      if (result.status === 'error') {
        setError(result.message ?? 'Preview failed');
        setPreviewText(null);
        return;
      }
      setPreviewText(result.message ?? null);
      setHonestyNote(result.honestyNote ?? null);
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const body = String(fd.get('body') ?? '').trim();
    if (!name) {
      setError('Name is required.');
      return;
    }
    if (channels.length === 0) {
      setError('Select at least one channel.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createCampaignAction({
        name,
        body: body || undefined,
        channels,
        audienceJson: buildAudience(fd),
        createdBy,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create campaign');
        return;
      }
      router.push('/communication/campaigns');
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[860px]">
      <CardHeader>
        <CardTitle className="text-base">Campaign details</CardTitle>
        <CardDescription>Draft a multi-channel notice for a tenant audience.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create communication campaign"
          data-testid="communication-campaign-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="campaign-name" label="Name" required>
            <Input
              id="campaign-name"
              name="name"
              placeholder="Term opening notice"
              className="h-11 min-h-11"
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
                    onCheckedChange={(value) => toggleChannel(channel, value === true)}
                    aria-label={channel}
                  />
                  <span>{channel}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormField id="campaign-scope" label="Audience scope" required>
            <select
              id="campaign-scope"
              name="scope"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number]['value'])}
            >
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
          {scope === 'grade' ? (
            <FormField id="campaign-grade" label="Grade">
              <Input id="campaign-grade" name="grade" placeholder="10" className="h-11 min-h-11" />
            </FormField>
          ) : null}
          {scope === 'hostel' ? (
            <FormField id="campaign-hostel" label="Hostel UUID (optional)">
              <Input id="campaign-hostel" name="hostelId" className="h-11 min-h-11" />
            </FormField>
          ) : null}
          {scope === 'route' ? (
            <FormField id="campaign-route" label="Route UUID (optional)">
              <Input id="campaign-route" name="routeId" className="h-11 min-h-11" />
            </FormField>
          ) : null}
          <FormField id="campaign-body" label="Message body">
            <Textarea
              id="campaign-body"
              name="body"
              rows={5}
              placeholder="Message content…"
              className="min-h-28"
            />
          </FormField>
          {previewText ? (
            <p className="text-sm text-foreground" role="status" data-testid="audience-preview">
              {previewText}
            </p>
          ) : null}
          {honestyNote ? <p className="text-xs text-muted-foreground">{honestyNote}</p> : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/communication/campaigns">Cancel</Link>
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onPreview}>
              Preview audience
            </Button>
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Saving…' : 'Create campaign'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
