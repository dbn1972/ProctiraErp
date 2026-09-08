'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import {
  enrollStudentAction,
  bulkEnrollStudentsAction,
  publishSectionAction,
  unpublishSectionAction,
  withdrawStudentAction,
} from '@/app/(dashboard)/timetable-actions';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

export function SectionPublishControls(props: {
  institutionId: string;
  sectionId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPublished = props.status === 'PUBLISHED';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={isPublished ? 'outline' : 'default'}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = isPublished
              ? await unpublishSectionAction({
                  institutionId: props.institutionId,
                  sectionId: props.sectionId,
                })
              : await publishSectionAction({
                  institutionId: props.institutionId,
                  sectionId: props.sectionId,
                });
            if (!result.ok) {
              setError(
                result.status === 409
                  ? `Conflict (409): ${result.error}`
                  : result.error,
              );
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending
          ? 'Working…'
          : isPublished
            ? 'Unpublish to draft'
            : 'Publish schedule'}
      </Button>
      {error && (
        <p className="w-full text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SectionEnrollForm(props: {
  institutionId: string;
  sectionId: string;
  studentOptions?: EntityLabelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const studentId = String(fd.get('studentId') ?? '').trim();
        setError(null);
        startTransition(async () => {
          const result = await enrollStudentAction({
            institutionId: props.institutionId,
            sectionId: props.sectionId,
            studentId,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          event.currentTarget.reset();
          router.refresh();
        });
      }}
    >
      <div className="min-w-[16rem] flex-1">
        <EntitySearchSelect
          id="enrollStudentId"
          name="studentId"
          label="Student"
          options={props.studentOptions ?? []}
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Enrolling…' : 'Enroll'}
      </Button>
      {error && (
        <p className="w-full text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Bulk roster assign — paste or multi-select student ids (G-304). */
export function SectionBulkEnrollForm(props: {
  institutionId: string;
  sectionId: string;
  studentOptions?: EntityLabelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const raw = String(fd.get('studentIds') ?? '');
        const studentIds = raw
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        setError(null);
        setMessage(null);
        if (studentIds.length === 0) {
          setError('Enter at least one student id');
          return;
        }
        startTransition(async () => {
          const result = await bulkEnrollStudentsAction({
            institutionId: props.institutionId,
            sectionId: props.sectionId,
            studentIds,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          if ('enrolled' in result) {
            const failNote =
              result.failed.length > 0
                ? ` · ${result.failed.length} failed (${result.failed
                    .slice(0, 3)
                    .map((f) => f.studentId.slice(0, 8))
                    .join(', ')})`
                : '';
            setMessage(`Enrolled ${result.enrolled}${failNote}`);
          }
          event.currentTarget.reset();
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium text-foreground" htmlFor="bulkStudentIds">
        Bulk assign (student ids, comma or newline separated)
      </label>
      <textarea
        id="bulkStudentIds"
        name="studentIds"
        rows={3}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        placeholder={
          props.studentOptions?.[0]
            ? `e.g. ${props.studentOptions[0].id}`
            : 'student-uuid-1, student-uuid-2'
        }
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Assigning…' : 'Bulk assign'}
      </Button>
      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function WithdrawStudentButton(props: {
  institutionId: string;
  sectionId: string;
  studentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await withdrawStudentAction(props);
          router.refresh();
        });
      }}
    >
      {pending ? '…' : 'Withdraw'}
    </Button>
  );
}
