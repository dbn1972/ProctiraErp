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
        {actions.map((action) =>
          action.value === 'decommission' || action.value === 'offboard' ? (
            <ConfirmedActionButton
              key={action.value}
              value={action.value}
              label={action.label}
              tone={action.tone}
              disabled={reason.trim().length < 10}
            />
          ) : (
            <ActionButton
              key={action.value}
              value={action.value}
              label={action.label}
              tone={action.tone}
              disabled={reason.trim().length < 10}
            />
          ),
        )}
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

const CONFIRM_COPY: Record<'decommission' | 'offboard', { title: string; description: string }> = {
  decommission: {
    title: 'Decommission this tenant?',
    description:
      'Decommission starts offboarding and removes active access. The justification above is stored on the audit log. This is a separate confirmation from the reason length check.',
  },
  offboard: {
    title: 'Permanently offboard this tenant?',
    description:
      'Offboard deletes the tenant record. This cannot be undone from the console. The justification above is stored on the audit log.',
  },
};

function ConfirmedActionButton({
  value,
  label,
  tone,
  disabled,
}: {
  value: 'decommission' | 'offboard';
  label: string;
  tone: 'default' | 'destructive' | 'outline';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const copy = CONFIRM_COPY[value];

  return (
    <>
      <Button
        type="button"
        variant={tone}
        disabled={pending || disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <button
        ref={submitRef}
        type="submit"
        name="action"
        value={value}
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
            <Button type="button" variant={tone} onClick={() => submitRef.current?.click()}>
              Confirm {label.toLowerCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
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
