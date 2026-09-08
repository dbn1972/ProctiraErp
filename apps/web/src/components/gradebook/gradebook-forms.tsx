'use client';

import { useState, useTransition } from 'react';

import {
  computeGpaAction,
  createReportCardJobAction,
  upsertGradeEntryAction,
} from '@/app/(dashboard)/gradebook-actions';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { Button, Input, Label } from '@proctira/ui/components';
import type { EntityLabelOption } from '@/lib/entity-label';

export function GradeEntryForm({
  institutionId,
  sectionId,
  defaultStudentId = '',
  studentOptions = [],
}: {
  institutionId: string;
  sectionId: string;
  defaultStudentId?: string;
  studentOptions?: EntityLabelOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const studentId = String(fd.get('studentId') ?? '').trim();
        const assessmentCode = String(fd.get('assessmentCode') ?? '').trim();
        const scoreRaw = String(fd.get('numericScore') ?? '').trim();
        const creditRuleCode = String(fd.get('creditRuleCode') ?? '').trim();
        const numericScore = scoreRaw === '' ? null : Number(scoreRaw);
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await upsertGradeEntryAction({
            institutionId,
            sectionId,
            studentId,
            assessmentCode: assessmentCode || null,
            numericScore,
            creditRuleCode: creditRuleCode || 'CBSE-CORE',
          });
          if (!result.ok) {
            setError(
              result.code === 'GRADEBOOK_SCHEMA_MISSING'
                ? `${result.error} (apply db/sql/003_sis_timetable_schedule_schema.sql)`
                : result.error,
            );
            return;
          }
          setMessage(`Saved grade entry ${result.id}`);
          event.currentTarget.reset();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <EntitySearchSelect
          id="studentId"
          name="studentId"
          label="Student"
          options={studentOptions}
          defaultValue={defaultStudentId}
          required
        />
        <div className="space-y-1.5">
          <Label htmlFor="assessmentCode">Assessment / course code</Label>
          <Input id="assessmentCode" name="assessmentCode" defaultValue="MATH" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="numericScore">Numeric score (0–100)</Label>
          <Input
            id="numericScore"
            name="numericScore"
            type="number"
            min={0}
            max={100}
            step="0.01"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creditRuleCode">Credit rule code</Label>
          <Input id="creditRuleCode" name="creditRuleCode" defaultValue="CBSE-CORE" />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save grade'}
      </Button>
      {message ? <p className="text-sm text-foreground">{message}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ComputeGpaForm({
  institutionId,
  defaultStudentId = '',
  boardId,
  studentOptions = [],
}: {
  institutionId: string;
  defaultStudentId?: string;
  boardId?: string;
  studentOptions?: EntityLabelOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const studentId = String(fd.get('studentId') ?? '').trim();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await computeGpaAction({
            studentId,
            boardId: boardId ?? null,
            institutionId,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(
            `GPA snapshot ${result.id}: weighted=${String(result.extra?.weightedGpa ?? 'n/a')} unweighted=${String(result.extra?.unweightedGpa ?? 'n/a')} credits=${String(result.extra?.creditsEarned ?? 'n/a')}`,
          );
        });
      }}
    >
      <EntitySearchSelect
        id="gpaStudentId"
        name="studentId"
        label="Student"
        options={studentOptions}
        defaultValue={defaultStudentId}
        required
        className="min-w-[18rem] space-y-1.5"
      />
      <Button type="submit" disabled={pending} variant="secondary">
        {pending ? 'Computing…' : 'Compute GPA'}
      </Button>
      {message ? <p className="basis-full text-sm text-foreground">{message}</p> : null}
      {error ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ReportCardTriggerForm({
  institutionId,
  defaultStudentId = '',
  boardId,
  studentOptions = [],
}: {
  institutionId: string;
  defaultStudentId?: string;
  boardId: string;
  studentOptions?: EntityLabelOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const studentId = String(fd.get('studentId') ?? '').trim();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await createReportCardJobAction({
            studentId,
            boardId,
            institutionId,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(
            `Report card job ${result.id} → ${String(result.extra?.status ?? '')} ${String(result.extra?.artifactUri ?? '')}`,
          );
        });
      }}
    >
      <EntitySearchSelect
        id="rcStudentId"
        name="studentId"
        label="Student"
        options={studentOptions}
        defaultValue={defaultStudentId}
        required
        className="min-w-[18rem] space-y-1.5"
      />
      <Button type="submit" disabled={pending} variant="secondary">
        {pending ? 'Queuing…' : 'Generate report card'}
      </Button>
      {message ? <p className="basis-full text-sm text-foreground">{message}</p> : null}
      {error ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
