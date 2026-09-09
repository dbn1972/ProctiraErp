'use client';

import { useState, useTransition } from 'react';
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
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await applyConcessionAction({
        studentId,
        structureId,
        invoiceId,
        kind: 'percent',
        percent: Number(fd.get('percent') ?? 0),
        reason: String(fd.get('reason') ?? ''),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
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
            <FormField id="concession-percent" label="Percent" required>
              <Input
                id="concession-percent"
                name="percent"
                type="number"
                min="0"
                max="100"
                defaultValue="10"
              />
            </FormField>
            <FormField id="concession-reason" label="Reason" required>
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
