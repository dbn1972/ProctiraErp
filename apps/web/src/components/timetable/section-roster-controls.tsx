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
        variant="outline"
        className="h-8 px-2.5 text-xs"
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
        // PRC-M141: capture the form element now. Inside the async transition
        // `event.currentTarget` is null (React nulls it after the handler
        // returns), so `event.currentTarget.reset()` threw and router.refresh()
        // never ran. Reference the stable node instead.
        const form = event.currentTarget;
        const fd = new FormData(form);
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
          form.reset();
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
          presentation="combobox"
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
        // PRC-M141: capture the form before the async transition (see note on
        // the single-enrol form).
        const form = event.currentTarget;
        const fd = new FormData(form);
        const raw = String(fd.get('studentIds') ?? '');
        // PRC-M140: build a token → student-id index that records ambiguity. A
        // token (admission code, name word, label) that points at more than one
        // distinct student must NOT silently enrol the last match — it is
        // reported as ambiguous so an operator resolves it explicitly.
        const tokenToIds = new Map<string, Set<string>>();
        const addToken = (token: string, id: string) => {
          const key = token.toLowerCase();
          if (!key) return;
          const set = tokenToIds.get(key) ?? new Set<string>();
          set.add(id);
          tokenToIds.set(key, set);
        };
        for (const option of props.studentOptions ?? []) {
          addToken(option.id, option.id);
          for (const token of option.searchText?.split(/\s+/) ?? []) addToken(token, option.id);
          addToken(option.label, option.id);
        }
        const tokens = raw
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const studentIds: string[] = [];
        const unknown: string[] = [];
        const ambiguous: string[] = [];
        const seen = new Set<string>();
        for (const token of tokens) {
          const matches = tokenToIds.get(token.toLowerCase());
          if (!matches || matches.size === 0) {
            unknown.push(token);
          } else if (matches.size > 1) {
            ambiguous.push(token);
          } else {
            const id = [...matches][0]!;
            if (!seen.has(id)) {
              seen.add(id);
              studentIds.push(id);
            }
          }
        }
        setError(null);
        setMessage(null);
        if (tokens.length === 0) {
          setError('Enter at least one admission number');
          return;
        }
        if (ambiguous.length > 0) {
          setError(
            `Ambiguous — more than one student matches: ${ambiguous.slice(0, 5).join(', ')}. ` +
              'Use the unique admission number.',
          );
          return;
        }
        if (studentIds.length === 0) {
          setError(`No matching students for ${unknown.join(', ')}`);
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
            const names = new Map(
              (props.studentOptions ?? []).map((option) => [option.id, option.label]),
            );
            const failedNames = result.failed.map((f) => names.get(f.studentId) ?? f.studentId);
            const named = [...failedNames, ...unknown];
            const failNote =
              named.length > 0 ? ` · ${named.length} failed (${named.slice(0, 3).join(', ')})` : '';
            setMessage(`Enrolled ${result.enrolled}${failNote}`);
          }
          form.reset();
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium text-foreground" htmlFor="bulkStudentIds">
        Bulk assign by admission number
      </label>
      <p className="text-xs text-muted-foreground">
        Paste admission numbers separated by commas or new lines. Unknown numbers are named in the
        result instead of raw ids.
      </p>
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
