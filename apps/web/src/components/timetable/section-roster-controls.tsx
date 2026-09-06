'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import {
  enrollStudentAction,
  publishSectionAction,
  unpublishSectionAction,
  withdrawStudentAction,
} from '@/app/(dashboard)/timetable-actions';

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
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
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
          setStudentId('');
          router.refresh();
        });
      }}
    >
      <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">Student ID</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          required
          placeholder="UUID"
        />
      </label>
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
