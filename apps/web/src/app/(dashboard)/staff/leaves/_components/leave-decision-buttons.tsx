'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge, Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import { decideStaffLeaveAction } from '../../../staff-leave-actions';
import { inclusiveLeaveDays } from './leave-days';

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'outline' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'destructive';
  if (status === 'pending') return 'warning';
  return 'outline';
}
export function StaffLeaveStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(status)} className="capitalize" data-testid="leave-status">
      {status}
    </Badge>
  );
}
export function StaffLeaveDecisionButtons({
  leaveId,
  status,
  staffName,
  leaveType,
  startDate,
  endDate,
}: {
  leaveId: string;
  status: string;
  staffName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null);

  if (status !== 'pending') {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="leave-decided">
        <StaffLeaveStatusBadge status={status} />
      </p>
    );
  }

  const days = inclusiveLeaveDays(startDate, endDate);
  const span = `${startDate} to ${endDate}`;
  const context = `${staffName}, ${leaveType}, ${span}${days !== null ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`;
  function onConfirm() {
    if (!confirm) return;
    const next = confirm;
    startTransition(async () => {
      setError(null);
      const result = await decideStaffLeaveAction(leaveId, next);
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to decide leave');
        return;
      }
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => setConfirm('approved')}
        aria-label={`Approve leave for ${staffName}, ${span}`}
        data-testid="leave-approve"
      >
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setConfirm('rejected')}
        aria-label={`Reject leave for ${staffName}, ${span}`}
        data-testid="leave-reject"
      >
        Reject
      </Button>
      <ConfirmActionDialog
        open={confirm === 'approved'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Approve this staff leave?"
        description={`${context}. The leave will be recorded as approved and may affect coverage planning.`}
        confirmLabel="Approve leave"
        pending={pending}
        onConfirm={onConfirm}
        testId="staff-leave-approve-confirm"
      />
      <ConfirmActionDialog
        open={confirm === 'rejected'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reject this staff leave?"
        description={`${context}. The leave request will be rejected. Confirm only if the staff member should remain on duty.`}
        confirmLabel="Reject leave"
        destructive
        pending={pending}
        onConfirm={onConfirm}
        testId="staff-leave-reject-confirm"
      />
      {error ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
