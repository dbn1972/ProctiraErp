'use client';

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { pluginDecisionAction, type PluginDecisionState } from '../actions';

const initialState: PluginDecisionState = {};

const CONFIRM_COPY: Record<string, { title: string; description: string }> = {
  revoke: {
    title: 'Revoke this plugin?',
    description:
      'Revoke removes the plugin from the marketplace. Tenants can no longer rely on it. The justification above is stored on the audit log.',
  },
  disable: {
    title: 'Disable this plugin?',
    description:
      'Disable turns the plugin off and blocks new installs. The justification above is stored on the audit log.',
  },
};

export function PluginDecisionForm({ pluginId }: { pluginId: string }) {
  const [state, formAction] = useFormState(pluginDecisionAction, initialState);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={pluginId} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="reason">Justification *</Label>
        <Textarea
          id="reason"
          name="reason"
          required
          minLength={10}
          placeholder="e.g. Manifest reviewed; permissions match disclosed scope."
          aria-invalid={Boolean(state.fieldErrors?.reason)}
        />
        {state.fieldErrors?.reason && (
          <p className="text-xs text-destructive">{state.fieldErrors.reason}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DecisionButton name="approve" label="Approve" variant="default" />
        <DecisionButton name="reject" label="Reject" variant="outline" />
        <DecisionButton name="revoke" label="Revoke" variant="destructive" confirm />
        <DecisionButton name="disable" label="Disable" variant="secondary" confirm />
      </div>
    </form>
  );
}

function DecisionButton({
  name,
  label,
  variant,
  confirm = false,
}: {
  name: string;
  label: string;
  variant: 'default' | 'outline' | 'destructive' | 'secondary';
  confirm?: boolean;
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  if (!confirm) {
    return (
      <Button type="submit" name="action" value={name} variant={variant} disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    );
  }

  const copy = CONFIRM_COPY[name] ?? {
    title: `${label} this plugin?`,
    description: 'This decision is stored on the audit log.',
  };

  return (
    <>
      <Button type="button" variant={variant} disabled={pending} onClick={() => setOpen(true)}>
        {pending ? 'Saving…' : label}
      </Button>
      <button
        ref={submitRef}
        type="submit"
        name="action"
        value={name}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant={variant} onClick={() => submitRef.current?.click()}>
              Confirm {label.toLowerCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
