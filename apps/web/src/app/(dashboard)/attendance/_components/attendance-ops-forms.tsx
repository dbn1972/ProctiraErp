'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { Button, Input, Label } from '@proctira/ui/components';
import type { EntityLabelOption } from '@/lib/entity-label';

import {
  createLeaveRequestAction,
  createRegularisationAction,
  decideLeaveAction,
  decideRegularisationAction,
} from '../actions';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// PRC-M081: the attendance record and its current ("from") status are
// resolved server-side from student + class + date — no pasted ids.
const regularisationSchema = z.object({
  studentId: uuid,
  institutionId: uuid,
  classId: uuid,
  attendanceDate: isoDate,
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

function labelFor(map: Map<string, string>, id: string, fallback: string): string {
  return map.get(id) ?? fallback;
}

export function AttendanceOpsForms({
  regularisations,
  leaves,
  studentOptions = [],
  institutionOptions = [],
  classOptions = [],
  periodOptions = [],
}: {
  regularisations: Array<{
    id: string;
    studentId: string;
    classId?: string;
    fromStatus: string;
    toStatus: string;
    status: string;
    attendanceDate: string;
  }>;
  leaves: Array<{
    id: string;
    studentId: string;
    classId?: string;
    fromDate: string;
    toDate: string;
    status: string;
    reason: string | null;
  }>;
  studentOptions?: EntityLabelOption[];
  institutionOptions?: EntityLabelOption[];
  classOptions?: EntityLabelOption[];
  periodOptions?: EntityLabelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const studentLabels = new Map(studentOptions.map((o) => [o.id, o.label]));
  const classLabels = new Map(classOptions.map((o) => [o.id, o.label]));
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
            studentId: fd.get('studentId'),
            institutionId: fd.get('institutionId'),
            classId: fd.get('classId'),
            attendanceDate: fd.get('attendanceDate'),
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
        <p className="text-sm text-muted-foreground sm:col-span-2" id="regularisation-help">
          Pick the student, class and date. The recorded mark is looked up automatically and used as
          the current status.
        </p>
        <EntitySearchSelect
          id="studentId"
          name="studentId"
          label="Student"
          options={studentOptions}
          required
        />
        <EntitySearchSelect
          id="institutionId"
          name="institutionId"
          label="Institution"
          options={institutionOptions}
          required
        />
        <EntitySearchSelect
          id="classId"
          name="classId"
          label="Class"
          options={classOptions}
          required
        />
        <div className="space-y-1">
          <Label htmlFor="attendanceDate">Date</Label>
          <Input id="attendanceDate" name="attendanceDate" type="date" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="toStatus">To status</Label>
          <select
            id="toStatus"
            name="toStatus"
            className="h-11 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
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
          <li className="py-4 text-sm text-muted-foreground">
            No regularisation requests yet. Submit a request above when a past attendance mark needs
            correction.
          </li>
        ) : (
          regularisations.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{labelFor(studentLabels, row.studentId, 'Unknown student')}</span>
                {row.classId ? ` · ${labelFor(classLabels, row.classId, 'Unknown class')}` : ''} ·{' '}
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
        <EntitySearchSelect
          id="leaveStudentId"
          name="leaveStudentId"
          label="Student"
          options={studentOptions}
          required
        />
        <EntitySearchSelect
          id="leaveInstitutionId"
          name="leaveInstitutionId"
          label="Institution"
          options={institutionOptions}
          required
        />
        <EntitySearchSelect
          id="leaveClassId"
          name="leaveClassId"
          label="Class"
          options={classOptions}
          required
        />
        <EntitySearchSelect
          id="leavePeriodId"
          name="leavePeriodId"
          label="Academic period"
          options={periodOptions}
          required
        />
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
          <li className="py-4 text-sm text-muted-foreground">
            No leave requests yet. Use the leave form to request a date range for a student.
          </li>
        ) : (
          leaves.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{labelFor(studentLabels, row.studentId, 'Unknown student')}</span>
                {row.classId ? ` · ${labelFor(classLabels, row.classId, 'Unknown class')}` : ''} ·{' '}
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
