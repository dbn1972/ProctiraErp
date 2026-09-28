'use client';

import { useState, useTransition } from 'react';

import { logRepairRequestAction } from '@/app/(dashboard)/institutions/[id]/infrastructure/actions';
import { Button, Label, Textarea } from '@proctira/ui/components';

export function LogRepairRequestForm({
  institutionId,
  targets,
}: {
  institutionId: string;
  targets: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [facilityId, setFacilityId] = useState(targets[0]?.id ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  return (
    <form
      className="mt-3 space-y-2"
      data-testid="log-repair-request"
      onSubmit={(event) => {
        event.preventDefault();
        const summary = String(new FormData(event.currentTarget).get('summary') ?? '');
        setError(null);
        setMessage(null);
        startTransition(async () => {
          const result = await logRepairRequestAction({
            institutionId,
            infrastructureId: facilityId,
            summary,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage('Repair request logged.');
          event.currentTarget.reset();
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
          Facility
          <select
            className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={facilityId}
            onChange={(event) => setFacilityId(event.target.value)}
            data-testid="repair-facility"
          >
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-[16rem] flex-1 space-y-1">
          <Label htmlFor="repair-summary" className="text-amber-900 dark:text-amber-200">
            Repair request
          </Label>
          <Textarea id="repair-summary" name="summary" required rows={2} maxLength={500} />
        </div>
        <Button type="submit" size="sm" disabled={pending} data-testid="submit-repair-request">
          {pending ? 'Saving…' : 'Log repair request'}
        </Button>
      </div>
      {message ? (
        <p className="text-sm text-amber-900 dark:text-amber-100" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
