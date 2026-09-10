'use client';

/**
 * G-913 — retention policy editor + on-demand archival for the audit trail.
 * The chain-integrity card is server-rendered (see audit-logs/page.tsx); this
 * component only owns the mutations.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Loader2, Save } from 'lucide-react';

import { Button, Checkbox, Input, Label } from '@proctira/ui/components';
import {
  runArchivalAction,
  saveRetentionAction,
  type AuditActionState,
} from '@/app/(dashboard)/audit-logs/actions';
import { useHydrated } from '@/hooks/useHydrated';
import type { AuditRetentionConfig } from '@/lib/api/platform.server';

export function RetentionPolicyForm({ config }: { config: AuditRetentionConfig | null }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [state, setState] = useState<AuditActionState | null>(null);
  const [archivalEnabled, setArchivalEnabled] = useState(config?.archivalEnabled ?? false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await saveRetentionAction({
        retentionMonths: Number(formData.get('retentionMonths') ?? 0),
        archivalEnabled,
        archivalDestination: String(formData.get('archivalDestination') ?? '').trim() || null,
      });
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  const onArchive = () => {
    if (!window.confirm('Archive every entry older than the retention window now?')) return;
    startTransition(async () => {
      const res = await runArchivalAction();
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  return (
    <form
      action={onSubmit}
      className="space-y-4"
      data-testid="retention-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      {state && state.status !== 'idle' ? (
        <p
          role={state.status === 'error' ? 'alert' : 'status'}
          className={
            state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'
          }
          data-testid="retention-feedback"
        >
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="retentionMonths">Retain for (months)</Label>
          <Input
            id="retentionMonths"
            name="retentionMonths"
            type="number"
            min={1}
            max={120}
            required
            defaultValue={config?.retentionMonths ?? 84}
          />
          {state?.fieldErrors?.retentionMonths ? (
            <p className="text-xs text-destructive">{state.fieldErrors.retentionMonths}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Entries older than this are moved to the archive by the runtime sweep.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="archivalDestination">Archive destination</Label>
          <Input
            id="archivalDestination"
            name="archivalDestination"
            placeholder="s3://bucket/audit (optional label)"
            defaultValue={config?.archivalDestination ?? ''}
          />
          <p className="text-xs text-muted-foreground">
            Recorded on every archived row; rows stay queryable in the archive table.
          </p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={archivalEnabled}
          onCheckedChange={(v) => setArchivalEnabled(Boolean(v))}
          aria-label="Enable automatic archival"
        />
        Enable automatic archival (runtime scheduler)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending} data-testid="save-retention">
          {isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="me-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Save policy
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onArchive}
          disabled={isPending || !config?.archivalEnabled}
          title={!config?.archivalEnabled ? 'Enable archival and save first' : undefined}
          data-testid="run-archival"
        >
          <Archive className="me-1.5 h-4 w-4" aria-hidden="true" />
          Archive expired now
        </Button>
        {config?.lastArchivalAt ? (
          <span className="text-xs text-muted-foreground">
            Last sweep {new Date(config.lastArchivalAt).toLocaleString()}
          </span>
        ) : null}
      </div>
    </form>
  );
}
