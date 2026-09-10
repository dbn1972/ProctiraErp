'use client';

import { useTransition } from 'react';

import { Button } from '@proctira/ui/components';

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

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        title={pending ? 'Running schedule' : undefined}
        onClick={() =>
          startTransition(async () => {
            await runReportScheduleAction(scheduleId);
          })
        }
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
          startTransition(async () => {
            await toggleReportScheduleAction(scheduleId, !enabled);
          })
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
        onClick={() =>
          startTransition(async () => {
            await deleteReportScheduleAction(scheduleId);
          })
        }
      >
        Delete
      </Button>
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
