'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import { applyConcessionAction } from '@/lib/fees/actions';
import { generateIdempotencyKey } from '@/lib/sync/idempotencyKey';

export function ConcessionDialog({
  studentId,
  structureId,
  invoiceId,
}: {
  studentId: string;
  structureId: string;
  invoiceId: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const submission = useRef<{ signature: string; key: string } | null>(null);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    // PRC-L238: blank stays blank (undefined) so validation rejects it instead of applying 0%.
    const rawPercent = String(fd.get('percent') ?? '').trim();
    const reason = String(fd.get('reason') ?? '');
    // PRC-H058: identical resubmissions reuse one Idempotency-Key (applied once).
    const signature = `${rawPercent}|${reason}`;
    if (!submission.current || submission.current.signature !== signature) {
      submission.current = { signature, key: generateIdempotencyKey() };
    }
    const idempotencyKey = submission.current.key;
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const result = await applyConcessionAction({
        studentId,
        structureId,
        invoiceId,
        kind: 'percent',
        percent: rawPercent === '' ? undefined : Number(rawPercent),
        reason,
        idempotencyKey,
      });
      if (!result.success) {
        const byField: Record<string, string> = {};
        for (const fe of result.fieldErrors ?? []) byField[fe.field] ??= fe.message;
        setFieldErrors(byField);
        setError(result.fieldErrors?.length ? null : result.error);
        return;
      }
      submission.current = null;
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!hydrated}
        data-testid="open-concession"
        data-hydrated={hydrated ? 'true' : 'false'}
        onClick={() => setOpen(true)}
      >
        Concession
      </Button>
      <DialogContent>
        <form
          onSubmit={onSubmit}
          data-testid="concession-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <DialogHeader>
            <DialogTitle>Apply concession</DialogTitle>
            <DialogDescription>
              Percent discount recomputes open dues on this invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <FormField id="concession-percent" label="Percent" required error={fieldErrors.percent}>
              <Input
                id="concession-percent"
                name="percent"
                type="number"
                min="0.01"
                max="100"
                step="any"
                required
                defaultValue="10"
              />
            </FormField>
            <FormField id="concession-reason" label="Reason" required error={fieldErrors.reason}>
              <Input id="concession-reason" name="reason" required />
            </FormField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!hydrated || pending} data-testid="submit-concession">
              {pending ? 'Saving…' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
