'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { Button, Checkbox } from '@proctira/ui/components';

import { runGenerationJobAction } from '@/app/(dashboard)/timetable-actions';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

const demandSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  staffId: z.string().min(1),
  periodsPerWeek: z.number().int().min(1).max(20),
  preferredRoomId: z.string().min(1).optional().nullable(),
  enrollmentCount: z.number().int().min(0).optional(),
});

export function TimetableGenerateForm(props: {
  institutionId: string;
  academicPeriodId: string;
  bellScheduleOptions: { id: string; label: string }[];
  sectionOptions: { id: string; label: string }[];
  staffOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sectionId, setSectionId] = useState(props.sectionOptions[0]?.id ?? '');
  const [staffId, setStaffId] = useState(props.staffOptions[0]?.id ?? '');
  const [bellScheduleId, setBellScheduleId] = useState(props.bellScheduleOptions[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState('math');
  const [periodsPerWeek, setPeriodsPerWeek] = useState('4');
  const [persistMeetings, setPersistMeetings] = useState(false);

  const canSubmit = Boolean(props.academicPeriodId && sectionId && staffId && bellScheduleId);
  const sectionLabel =
    props.sectionOptions.find((item) => item.id === sectionId)?.label ?? 'the section';
  const teacherLabel =
    props.staffOptions.find((item) => item.id === staffId)?.label ?? 'the teacher';
  const scheduleLabel =
    props.bellScheduleOptions.find((item) => item.id === bellScheduleId)?.label ??
    'the bell schedule';
  const writeSummary = `Write ${periodsPerWeek} period${periodsPerWeek === '1' ? '' : 's'} a week for ${sectionLabel}, taught by ${teacherLabel}, on ${scheduleLabel}. This adds meetings to the live week. Slots that clash with an existing teacher, class, or room are skipped. Preview first if you only want the counts.`;

  function run(persist: boolean) {
    setError(null);
    setResult(null);
    const parsed = demandSchema.safeParse({
      sectionId,
      subjectId,
      staffId,
      periodsPerWeek: Number(periodsPerWeek),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid demand');
      return;
    }
    startTransition(async () => {
      const outcome = await runGenerationJobAction({
        institutionId: props.institutionId,
        academicPeriodId: props.academicPeriodId,
        bellScheduleId,
        persistMeetings: persist,
        demands: [parsed.data],
      });
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setResult(
        `${persist ? 'Saved' : 'Preview'}: ${outcome.assignedCount ?? 0} slots assigned, ${outcome.clashCount ?? 0} clashes.${persist ? ' Open the week grid to review the new meetings.' : ' Nothing was written to the week.'}`,
      );
      if (persist) setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-testid="timetable-generate-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (persistMeetings) {
          setConfirmOpen(true);
          return;
        }
        run(false);
      }}
    >
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Bell schedule</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          aria-label="Bell schedule"
          value={bellScheduleId}
          onChange={(e) => setBellScheduleId(e.target.value)}
          required
        >
          {props.bellScheduleOptions.map((schedule) => (
            <option key={schedule.id} value={schedule.id}>
              {schedule.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Section</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          required
        >
          {props.sectionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Teacher</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        >
          {props.staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Subject reference</span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Periods per week</span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          type="number"
          min={1}
          max={20}
          value={periodsPerWeek}
          onChange={(e) => setPeriodsPerWeek(e.target.value)}
          required
        />
      </label>
      <div className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox
          id="persist-meetings"
          checked={persistMeetings}
          onCheckedChange={(checked) => setPersistMeetings(checked === true)}
        />
        <label htmlFor="persist-meetings" className="cursor-pointer">
          Write generated meetings into the live grid
        </label>
      </div>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <p
          className="text-sm text-emerald-700 sm:col-span-2"
          role="status"
          data-testid="generation-result"
        >
          {result}
        </p>
      ) : null}
      {canSubmit ? (
        <Button type="submit" disabled={pending} data-testid="run-generation">
          {pending ? 'Generating…' : persistMeetings ? 'Write to the week' : 'Run generator'}
        </Button>
      ) : (
        <Button type="button" disabled title="Create a bell schedule, section, and teacher first">
          Run generator
        </Button>
      )}
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Write these meetings into the week?"
        description={writeSummary}
        confirmLabel="Write to the week"
        pending={pending}
        testId="confirm-generate"
        onConfirm={() => run(true)}
      >
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(false)}>
          Preview without saving
        </Button>
      </ConfirmActionDialog>
    </form>
  );
}
