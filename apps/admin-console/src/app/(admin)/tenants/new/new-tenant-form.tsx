'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createTenantAction, type CreateTenantState } from '../actions';

const initialState: CreateTenantState = {};

export function NewTenantForm() {
  const [state, formAction] = useFormState(createTenantAction, initialState);

  return (
    <form className="grid gap-4 sm:grid-cols-2" action={formAction}>
      {state.error && (
        <Alert variant="destructive" className="sm:col-span-2">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Field name="name" label="Display name" required state={state} />
      <Field
        name="slug"
        label="Slug"
        required
        state={state}
        hint="Lowercase letters, digits, hyphens. Used in URLs."
      />
      <Field
        name="contactEmail"
        label="Primary contact email"
        type="email"
        required
        state={state}
      />
      <PlanField state={state} />
      <Field
        name="region"
        label="Hosting region"
        required
        defaultValue="us-east-1"
        state={state}
      />

      <div className="sm:col-span-2 flex justify-end pt-2">
        <SubmitButton />
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
  defaultValue,
  hint,
  state,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  state: CreateTenantState;
}) {
  const error = state.fieldErrors?.[name];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={Boolean(error)}
      />
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PlanField({ state }: { state: CreateTenantState }) {
  const error = state.fieldErrors?.plan;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="plan">
        Plan<span className="text-destructive"> *</span>
      </Label>
      <Select name="plan" defaultValue="pilot">
        <SelectTrigger id="plan">
          <SelectValue placeholder="Select a plan" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pilot">Pilot</SelectItem>
          <SelectItem value="standard">Standard</SelectItem>
          <SelectItem value="enterprise">Enterprise</SelectItem>
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Provisioning…' : 'Provision tenant'}
    </Button>
  );
}
