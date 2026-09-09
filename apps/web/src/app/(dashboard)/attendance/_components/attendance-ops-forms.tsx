'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { Button, Input, Label } from '@proctira/ui/components';

import {
  createLeaveRequestAction,
  createRegularisationAction,
  decideLeaveAction,
  decideRegularisationAction,
} from '../actions';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const regularisationSchema = z.object({
  attendanceId: uuid,
  studentId: uuid,
  institutionId: uuid,
  classId: uuid,
  attendanceDate: isoDate,
  fromStatus: z.string().min(1),
  toStatus: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'EARLY_DEPARTURE']),
  reason: z.string().max(2000).optional(),
});

const leaveSchema = z.object({
  studentId: uuid,
  institutionId: uuid,
  classId: uuid,
  academicPeriodId: uuid,
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().max(2000).optional(),
  attachmentUrl: z.string().url().optional().or(z.literal('')),
});

export function AttendanceOpsForms({
  regularisations,
  leaves,
}: {
  regularisations: Array<{
    id: string;
    studentId: string;
    fromStatus: string;
    toStatus: string;
    status: string;
    attendanceDate: string;
  }>;
  leaves: Array<{
    id: string;
    studentId: string;
    fromDate: string;
    toDate: string;
    status: string;
    reason: string | null;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-8" data-testid="attendance-ops-panel">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        data-testid="regularisation-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const fd = new FormData(event.currentTarget);
          const parsed = regularisationSchema.safeParse({
            attendanceId: fd.get('attendanceId'),
            studentId: fd.get('studentId'),
            institutionId: fd.get('institutionId'),
            classId: fd.get('classId'),
            attendanceDate: fd.get('attendanceDate'),
            fromStatus: fd.get('fromStatus'),
            toStatus: fd.get('toStatus'),
            reason: String(fd.get('reason') ?? '') || undefined,
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid regularisation');
            return;
          }
          startTransition(async () => {
            const result = await createRegularisationAction(parsed.data);
            if (result.status === 'error') {
              setError(result.message ?? 'Request failed');
              return;
            }
            router.refresh();
          });
        }}
      >
        <h3 className="text-base font-semibold sm:col-span-2">Request regularisation</h3>
        {(
          [
            ['attendanceId', 'Attendance record id'],
            ['studentId', 'Student id'],
            ['institutionId', 'Institution id'],
            ['classId', 'Class id'],
          ] as const
        ).map(([name, label]) => (
          <div key={name} className="space-y-1">
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} name={name} required />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="attendanceDate">Date</Label>
          <Input id="attendanceDate" name="attendanceDate" type="date" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fromStatus">From status</Label>
          <Input id="fromStatus" name="fromStatus" defaultValue="ABSENT" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="toStatus">To status</Label>
          <select
            id="toStatus"
            name="toStatus"
            className="h-10 w-full rounded-md border border-border bg-background px-3"
            defaultValue="PRESENT"
          >
            <option>PRESENT</option>
            <option>ABSENT</option>
            <option>LATE</option>
            <option>EXCUSED</option>
            <option>EARLY_DEPARTURE</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="reason">Reason</Label>
          <Input id="reason" name="reason" />
        </div>
        <Button type="submit" disabled={pending} data-testid="regularisation-submit">
          {pending ? 'Submitting…' : 'Submit request'}
        </Button>
      </form>

      <ul className="divide-y divide-border" role="list" data-testid="regularisation-list">
        {regularisations.length === 0 ? (
          <li className="py-2 text-sm text-muted-foreground">No regularisation requests.</li>
        ) : (
          regularisations.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {row.attendanceDate} · {row.fromStatus} → {row.toStatus} · {row.status}
              </span>
              {row.status === 'requested' ? (
                <span className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await decideRegularisationAction(row.id, 'approve');
                        router.refresh();
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await decideRegularisationAction(row.id, 'reject');
                        router.refresh();
                      })
                    }
                  >
                    Reject
                  </Button>
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <form
        className="grid gap-3 sm:grid-cols-2"
        data-testid="leave-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const fd = new FormData(event.currentTarget);
          const parsed = leaveSchema.safeParse({
            studentId: fd.get('leaveStudentId'),
            institutionId: fd.get('leaveInstitutionId'),
            classId: fd.get('leaveClassId'),
            academicPeriodId: fd.get('leavePeriodId'),
            fromDate: fd.get('fromDate'),
            toDate: fd.get('toDate'),
            reason: String(fd.get('leaveReason') ?? '') || undefined,
            attachmentUrl: String(fd.get('attachmentUrl') ?? '') || undefined,
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid leave request');
            return;
          }
          startTransition(async () => {
            const result = await createLeaveRequestAction(parsed.data);
            if (result.status === 'error') {
              setError(result.message ?? 'Request failed');
              return;
            }
            router.refresh();
          });
        }}
      >
        <h3 className="text-base font-semibold sm:col-span-2">Student leave</h3>
        <div className="space-y-1">
          <Label htmlFor="leaveStudentId">Student id</Label>
          <Input id="leaveStudentId" name="leaveStudentId" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leaveInstitutionId">Institution id</Label>
          <Input id="leaveInstitutionId" name="leaveInstitutionId" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leaveClassId">Class id</Label>
          <Input id="leaveClassId" name="leaveClassId" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leavePeriodId">Academic period id</Label>
          <Input id="leavePeriodId" name="leavePeriodId" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fromDate">From</Label>
          <Input id="fromDate" name="fromDate" type="date" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="toDate">To</Label>
          <Input id="toDate" name="toDate" type="date" required />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="leaveReason">Reason</Label>
          <Input id="leaveReason" name="leaveReason" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="attachmentUrl">Attachment URL (optional)</Label>
          <Input id="attachmentUrl" name="attachmentUrl" />
        </div>
        <Button type="submit" disabled={pending} data-testid="leave-submit">
          {pending ? 'Submitting…' : 'Submit leave'}
        </Button>
      </form>

      <ul className="divide-y divide-border" role="list" data-testid="leave-list">
        {leaves.length === 0 ? (
          <li className="py-2 text-sm text-muted-foreground">No leave requests.</li>
        ) : (
          leaves.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {row.fromDate}–{row.toDate} · {row.status}
                {row.reason ? ` · ${row.reason}` : ''}
              </span>
              {row.status === 'requested' ? (
                <span className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await decideLeaveAction(row.id, 'approve');
                        router.refresh();
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await decideLeaveAction(row.id, 'reject');
                        router.refresh();
                      })
                    }
                  >
                    Reject
                  </Button>
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
