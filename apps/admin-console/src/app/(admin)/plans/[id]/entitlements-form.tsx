'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Entitlement } from '@/lib/api/plans';

import { updateEntitlementsAction } from '../actions';

export function EntitlementsForm({
  planId,
  planName,
  entitlements,
}: {
  planId: string;
  planName: string;
  entitlements: Entitlement[];
}) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <form action={updateEntitlementsAction} className="space-y-3">
        <input type="hidden" name="planId" value={planId} />
        {entitlements.map((entitlement) => (
          <label
            key={entitlement.key}
            className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
          >
            <div className="space-y-0.5">
              <div className="text-sm font-medium">{entitlement.label}</div>
              {entitlement.description && (
                <div className="text-xs text-muted-foreground">{entitlement.description}</div>
              )}
              <code className="text-xs text-muted-foreground">{entitlement.key}</code>
            </div>
            <input
              type="checkbox"
              name={`entitlement.${entitlement.key}`}
              defaultChecked={entitlement.enabled}
              aria-label={`${entitlement.label} entitlement`}
              className="mt-1 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
            />
          </label>
        ))}
        <div className="flex justify-end pt-2">
          <SaveButton onClick={() => setOpen(true)} />
        </div>
        <button ref={submitRef} type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save entitlements for {planName}?</DialogTitle>
            <DialogDescription>
              This updates the features granted to every tenant on this plan. The change is recorded
              as a plan update.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => submitRef.current?.click()}>
              Confirm save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button type="button" onClick={onClick} disabled={pending}>
      {pending ? 'Saving…' : 'Save entitlements'}
    </Button>
  );
}
