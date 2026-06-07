'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BREAK_GLASS_MAX_MINUTES,
  BREAK_GLASS_USE_CASES,
} from '@/lib/api/break-glass-constants';

import {
  createBreakGlassAction,
  type CreateBreakGlassState,
} from './actions';

const initialState: CreateBreakGlassState = {};

export function BreakGlassRequestForm() {
  const [state, formAction] = useFormState(
    createBreakGlassAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="targetTenantId">Target tenant ID *</Label>
          <Input
            id="targetTenantId"
            name="targetTenantId"
            placeholder="tnt_001 or 'platform'"
            required
            aria-invalid={Boolean(state.fieldErrors?.targetTenantId)}
          />
          {state.fieldErrors?.targetTenantId && (
            <p className="text-xs text-destructive">
              {state.fieldErrors.targetTenantId}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="scope">Requested scope *</Label>
          <Select name="scope" defaultValue="read">
            <SelectTrigger id="scope">
              <SelectValue placeholder="Pick a scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read">Read-only</SelectItem>
              <SelectItem value="support">Support (limited writes)</SelectItem>
              <SelectItem value="admin">Admin (full)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="useCase">Use case *</Label>
          <Select name="useCase" defaultValue={BREAK_GLASS_USE_CASES[0]}>
            <SelectTrigger id="useCase">
              <SelectValue placeholder="Approved use case" />
            </SelectTrigger>
            <SelectContent>
              {BREAK_GLASS_USE_CASES.map((useCase) => (
                <SelectItem key={useCase} value={useCase}>
                  {useCase}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="durationMinutes">Duration (minutes) *</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={15}
            max={BREAK_GLASS_MAX_MINUTES}
            defaultValue={60}
            required
            aria-invalid={Boolean(state.fieldErrors?.durationMinutes)}
          />
          {state.fieldErrors?.durationMinutes && (
            <p className="text-xs text-destructive">
              {state.fieldErrors.durationMinutes}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Maximum {BREAK_GLASS_MAX_MINUTES} minutes per Section 41 policy.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="justification">Justification *</Label>
        <Textarea
          id="justification"
          name="justification"
          required
          minLength={20}
          placeholder="Describe the customer issue, incident, or task that requires elevated access. Include ticket numbers if available."
          aria-invalid={Boolean(state.fieldErrors?.justification)}
        />
        {state.fieldErrors?.justification && (
          <p className="text-xs text-destructive">
            {state.fieldErrors.justification}
          </p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </Button>
  );
}
