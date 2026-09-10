'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { tenantLifecycleAction } from '../actions';
import type { TenantLifecycleAction, TenantStatus } from '@/lib/api/tenants';

interface Props {
  tenantId: string;
  status: TenantStatus;
}

/** Lifecycle action panel with required justification + confirmation. */
export function TenantLifecycleActions({ tenantId, status }: Props) {
  const [reason, setReason] = useState('');

  const actions = availableActions(status);

  return (
    <form action={tenantLifecycleAction} className="space-y-4">
      <input type="hidden" name="id" value={tenantId} />

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="reason">
          Justification (required)
        </label>
        <Textarea
          id="reason"
          name="reason"
          minLength={10}
          required
          placeholder="Why are you taking this action?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The reason is recorded in the audit log alongside your operator identity.
        </p>
      </div>

      {actions.length === 0 && (
        <Alert>
          <AlertDescription>
            No lifecycle actions are available for tenants in the <strong>{status}</strong> state.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <ActionButton
            key={action.value}
            value={action.value}
            label={action.label}
            tone={action.tone}
            disabled={reason.trim().length < 10}
          />
        ))}
      </div>
    </form>
  );
}

interface ActionDef {
  value: TenantLifecycleAction;
  label: string;
  tone: 'default' | 'destructive' | 'outline';
}

function availableActions(status: TenantStatus): ActionDef[] {
  switch (status) {
    case 'active':
      return [
        { value: 'suspend', label: 'Suspend tenant', tone: 'outline' },
        { value: 'decommission', label: 'Decommission', tone: 'destructive' },
      ];
    case 'suspended':
      return [
        { value: 'reactivate', label: 'Reactivate tenant', tone: 'default' },
        { value: 'decommission', label: 'Decommission', tone: 'destructive' },
      ];
    case 'decommissioning':
      return [{ value: 'offboard', label: 'Permanently offboard', tone: 'destructive' }];
    case 'provisioning':
      return [{ value: 'suspend', label: 'Suspend provisioning', tone: 'outline' }];
    default:
      return [];
  }
}

function ActionButton({
  value,
  label,
  tone,
  disabled,
}: {
  value: TenantLifecycleAction;
  label: string;
  tone: 'default' | 'destructive' | 'outline';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="action" value={value} variant={tone} disabled={pending || disabled}>
      {label}
    </Button>
  );
}
