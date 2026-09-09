'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@proctira/ui/components';

import { runGenerationJobAction } from '@/app/(dashboard)/timetable-actions';

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
  bellScheduleId?: string;
  sectionOptions: { id: string; label: string }[];
  staffOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState(props.sectionOptions[0]?.id ?? '');
  const [staffId, setStaffId] = useState(props.staffOptions[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState('math');
  const [periodsPerWeek, setPeriodsPerWeek] = useState('4');
  const [persistMeetings, setPersistMeetings] = useState(false);

  const canSubmit = Boolean(props.academicPeriodId && sectionId && staffId);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-testid="timetable-generate-form"
      onSubmit={(event) => {
        event.preventDefault();
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
            bellScheduleId: props.bellScheduleId,
            persistMeetings,
            demands: [parsed.data],
          });
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }
          setResult(
            `Job ${outcome.id} assigned ${outcome.assignedCount ?? 0} slots with ${outcome.clashCount ?? 0} hard clashes.`,
          );
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Section</span>
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
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
          className="rounded-md border border-border bg-background px-3 py-2"
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
          className="rounded-md border border-border bg-background px-3 py-2"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Periods per week</span>
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          type="number"
          min={1}
          max={20}
          value={periodsPerWeek}
          onChange={(e) => setPeriodsPerWeek(e.target.value)}
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={persistMeetings}
          onChange={(e) => setPersistMeetings(e.target.checked)}
        />
        Write generated meetings into the live grid
      </label>
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
          {pending ? 'Generating…' : 'Run generator'}
        </Button>
      ) : (
        <Button type="button" disabled title="Create a bell schedule, section, and teacher first">
          Run generator
        </Button>
      )}
    </form>
  );
}
