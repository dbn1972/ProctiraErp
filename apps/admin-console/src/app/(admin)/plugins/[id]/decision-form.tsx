'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  pluginDecisionAction,
  type PluginDecisionState,
} from '../actions';

const initialState: PluginDecisionState = {};

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
        <DecisionButton name="revoke" label="Revoke" variant="destructive" />
        <DecisionButton name="disable" label="Disable" variant="secondary" />
      </div>
    </form>
  );
}

function DecisionButton({
  name,
  label,
  variant,
}: {
  name: string;
  label: string;
  variant: 'default' | 'outline' | 'destructive' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="action" value={name} variant={variant} disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}
