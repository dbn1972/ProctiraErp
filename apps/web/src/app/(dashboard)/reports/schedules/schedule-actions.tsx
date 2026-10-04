'use client';

import { useTransition, useState } from 'react';

import { Button } from '@proctira/ui/components';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

import type { InsightsActionState } from '../actions';
import {
  deleteReportScheduleAction,
  runDueSchedulesAction,
  runReportScheduleAction,
  toggleReportScheduleAction,
} from '../actions';

export function ScheduleRowActions({
  scheduleId,
  enabled,
}: {
  scheduleId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<InsightsActionState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  function run(action: () => Promise<InsightsActionState>, fallback: string) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(
        result.status === 'error'
          ? { status: 'error', message: result.message ?? fallback }
          : { status: 'success', message: result.message ?? 'Done' },
      );
    });
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        title={pending ? 'Running schedule' : undefined}
        onClick={() => run(() => runReportScheduleAction(scheduleId), 'Failed to run schedule')}
      >
        Run now
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        title={pending ? 'Updating schedule' : undefined}
        onClick={() =>
          run(() => toggleReportScheduleAction(scheduleId, !enabled), 'Failed to update schedule')
        }
      >
        {enabled ? 'Pause' : 'Enable'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        title={pending ? 'Deleting schedule' : undefined}
        onClick={() => {
          setDeleteError(null);
          setConfirmDelete(true);
        }}
      >
        Delete
      </Button>
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this report schedule?"
        description="Future automatic runs will stop. Past report results are kept."
        confirmLabel="Delete schedule"
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            setDeleteError(null);
            const result = await deleteReportScheduleAction(scheduleId);
            if (result.status === 'error') {
              // Keep the dialog open so the user sees why and can retry or cancel.
              setDeleteError(result.message ?? 'Failed to delete schedule');
              return;
            }
            setConfirmDelete(false);
            setFeedback({ status: 'success', message: result.message ?? 'Schedule deleted' });
          })
        }
        testId="report-schedule-delete-confirm"
      >
        {deleteError ? (
          <p className="text-sm text-destructive" role="alert">
            {deleteError}
          </p>
        ) : null}
      </ConfirmActionDialog>
      <p
        className={
          feedback?.status === 'error'
            ? 'w-full text-end text-xs text-destructive'
            : 'w-full text-end text-xs text-muted-foreground'
        }
        role={feedback?.status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        data-testid="report-schedule-row-feedback"
      >
        {feedback?.message ?? ''}
      </p>
    </div>
  );
}

export function RunDueButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      title={pending ? 'Ticking due schedules' : undefined}
      data-testid="run-due-schedules"
      onClick={() =>
        startTransition(async () => {
          await runDueSchedulesAction();
        })
      }
    >
      {pending ? 'Running due…' : 'Run due now'}
    </Button>
  );
}
