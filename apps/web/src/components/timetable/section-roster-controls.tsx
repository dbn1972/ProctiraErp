'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isPublished = props.status === 'PUBLISHED';

  function run(unpublish: boolean) {
    setError(null);
    startTransition(async () => {
      const result = unpublish
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
            ? `This section clashes with another booking. ${result.error}`
            : result.error,
        );
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={isPublished ? 'outline' : 'default'}
        disabled={pending}
        onClick={() => {
          if (isPublished) {
            setConfirmOpen(true);
            return;
          }
          run(false);
        }}
      >
        {pending ? 'Working…' : isPublished ? 'Unpublish to draft' : 'Publish schedule'}
      </Button>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Unpublish this section?"
        description="The section returns to draft. Students keep their places, and you can publish again after clashes are resolved."
        confirmLabel="Unpublish to draft"
        destructive
        pending={pending}
        testId="unpublish-section"
        onConfirm={() => run(true)}
      />
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
          placeholder="Search by name or admission no."
          options={props.studentOptions ?? []}
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Enrolling…' : 'Enrol'}
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
        const byAdmission = new Map<string, string>();
        for (const option of props.studentOptions ?? []) {
          byAdmission.set(option.id.toLowerCase(), option.id);
          for (const token of option.searchText?.split(/\s+/) ?? []) {
            if (token) byAdmission.set(token.toLowerCase(), option.id);
          }
          byAdmission.set(option.label.toLowerCase(), option.id);
        }
        const studentIds = raw
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((token) => byAdmission.get(token.toLowerCase()) ?? token);
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
            const names = new Map((props.studentOptions ?? []).map((option) => [option.id, option.label]));
            const failNote =
              result.failed.length > 0
                ? ` · ${result.failed.length} failed (${result.failed
                    .slice(0, 3)
                    .map((f) => names.get(f.studentId) ?? 'a student')
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
          props.studentOptions?.[0]?.searchText
            ? `e.g. ${props.studentOptions[0].searchText.split(' ').slice(-1)[0]}`
            : 'Admission numbers, separated by commas'
        }
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
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
  studentName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        data-hydrated={hydrated ? 'true' : 'false'}
        aria-label={`Withdraw ${props.studentName}`}
        onClick={() => setOpen(true)}
      >
        {pending ? '…' : 'Withdraw'}
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Withdraw ${props.studentName}?`}
        description="They leave this section roster. You can enroll them again later."
        confirmLabel="Withdraw"
        destructive
        pending={pending}
        testId="withdraw-student"
        onConfirm={() => {
          startTransition(async () => {
            await withdrawStudentAction({
              institutionId: props.institutionId,
              sectionId: props.sectionId,
              studentId: props.studentId,
            });
            setOpen(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}
