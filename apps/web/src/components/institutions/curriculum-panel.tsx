'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  createLearningOutcomeAction,
  createLessonPlanAction,
  createSyllabusUnitAction,
  markUnitTaughtAction,
} from '@/app/(dashboard)/institutions/[id]/curriculum/actions';
import { useHydrated } from '@/hooks/useHydrated';
import type { CoverageSummary, LearningOutcome, LessonPlan, SyllabusUnit } from '@/lib/api/curriculum';
import type { AcademicPeriod, Grade } from '@/lib/institutions/types';
import type { SubjectSummary } from '@/lib/institutions/api';
import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { cn } from '@/lib/utils';

export function CurriculumPanel({
  institutionId,
  subjects,
  grades,
  periods,
  units,
  plansByUnit,
  outcomes,
  coverage,
  coverageRows,
  defaultSubjectId,
  defaultGradeId,
  defaultPeriodId,
}: {
  institutionId: string;
  subjects: SubjectSummary[];
  grades: Grade[];
  periods: AcademicPeriod[];
  units: SyllabusUnit[];
  plansByUnit: Record<string, LessonPlan[]>;
  outcomes: LearningOutcome[];
  coverage: CoverageSummary | null;
  coverageRows: Array<{ unitId: string; taughtAt: string }>;
  defaultSubjectId: string;
  defaultGradeId: string;
  defaultPeriodId: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState({
    subjectId: defaultSubjectId,
    gradeId: defaultGradeId,
    academicPeriodId: defaultPeriodId,
  });

  const taught = useMemo(() => new Set(coverageRows.map((c) => c.unitId)), [coverageRows]);

  const applyScope = () => {
    const params = new URLSearchParams();
    if (scope.subjectId) params.set('subjectId', scope.subjectId);
    if (scope.gradeId) params.set('gradeId', scope.gradeId);
    if (scope.academicPeriodId) params.set('academicPeriodId', scope.academicPeriodId);
    router.push(`/institutions/${institutionId}/curriculum?${params.toString()}`);
  };

  const percent = coverage?.percent ?? 0;

  return (
    <div className="space-y-6" data-testid="curriculum-panel" data-hydrated={hydrated ? 'true' : 'false'}>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Subject</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            data-testid="curriculum-subject"
            value={scope.subjectId}
            onChange={(e) => setScope((s) => ({ ...s, subjectId: e.target.value }))}
          >
            <option value="">Select</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Grade</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            data-testid="curriculum-grade"
            value={scope.gradeId}
            onChange={(e) => setScope((s) => ({ ...s, gradeId: e.target.value }))}
          >
            <option value="">Select</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Period</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            data-testid="curriculum-period"
            value={scope.academicPeriodId}
            onChange={(e) => setScope((s) => ({ ...s, academicPeriodId: e.target.value }))}
          >
            <option value="">Select</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="button" variant="secondary" data-testid="curriculum-apply-scope" onClick={applyScope}>
            Apply scope
          </Button>
        </div>
      </div>

      <div
        className="space-y-2 rounded-lg border border-border p-4"
        data-testid="curriculum-coverage"
        data-percent={String(percent)}
      >
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Coverage</span>
          <span className="tabular-nums" data-testid="coverage-percent">
            {coverage ? `${coverage.taught} / ${coverage.planned} · ${percent}%` : 'Select subject, grade, and period'}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full bg-emerald-500')}
            style={{ width: `${Math.min(100, percent)}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Coverage ${percent}%`}
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert" data-testid="curriculum-error">
          {error}
        </p>
      ) : null}

      <form
        className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2"
        data-testid="syllabus-unit-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          setError(null);
          startTransition(async () => {
            const result = await createSyllabusUnitAction(institutionId, {
              subjectId: scope.subjectId,
              gradeId: scope.gradeId,
              academicPeriodId: scope.academicPeriodId,
              code: String(fd.get('code') ?? ''),
              name: String(fd.get('name') ?? ''),
              notes: String(fd.get('notes') ?? ''),
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
        <h3 className="text-sm font-semibold sm:col-span-2">Add syllabus unit</h3>
        <div className="space-y-1.5">
          <Label htmlFor="unit-code">Code</Label>
          <Input id="unit-code" name="code" required maxLength={50} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unit-name">Name</Label>
          <Input id="unit-name" name="name" required maxLength={255} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="unit-notes">Notes</Label>
          <Textarea id="unit-notes" name="notes" rows={2} maxLength={4000} />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending || !scope.subjectId || !scope.gradeId || !scope.academicPeriodId}
          data-testid="add-syllabus-unit"
        >
          {pending ? 'Saving…' : 'Add unit'}
        </Button>
      </form>

      {units.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="curriculum-empty">
          No syllabus units in this scope yet.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="syllabus-unit-list">
          {units.map((unit) => {
            const plans = plansByUnit[unit.id] ?? [];
            const isTaught = taught.has(unit.id);
            return (
              <li
                key={unit.id}
                className="space-y-3 rounded-lg border border-border p-4"
                data-testid="syllabus-unit-row"
                data-unit-code={unit.code}
                data-taught={isTaught ? 'true' : 'false'}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {unit.code} · {unit.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sequence {unit.sequence}
                      {unit.planned ? ' · planned' : ''}
                      {isTaught ? ' · taught' : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isTaught ? 'secondary' : 'default'}
                    disabled={pending || isTaught}
                    data-testid={`mark-taught-${unit.id}`}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const result = await markUnitTaughtAction(institutionId, { unitId: unit.id });
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        router.refresh();
                      });
                    }}
                  >
                    {isTaught ? 'Taught' : 'Mark taught'}
                  </Button>
                </div>
                {plans.length > 0 ? (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {plans.map((plan) => (
                      <li key={plan.id} data-testid="lesson-plan-row">
                        {plan.title}
                        {plan.plannedDate ? ` · ${plan.plannedDate}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No lesson plans yet.</p>
                )}
                <form
                  className="flex flex-wrap items-end gap-2"
                  data-testid={`lesson-plan-form-${unit.id}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const fd = new FormData(event.currentTarget);
                    setError(null);
                    startTransition(async () => {
                      const result = await createLessonPlanAction(institutionId, {
                        unitId: unit.id,
                        title: String(fd.get('title') ?? ''),
                        plannedDate: String(fd.get('plannedDate') ?? ''),
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
                  <div className="space-y-1.5">
                    <Label htmlFor={`lp-title-${unit.id}`}>Lesson title</Label>
                    <Input id={`lp-title-${unit.id}`} name="title" required maxLength={255} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`lp-date-${unit.id}`}>Planned date</Label>
                    <Input id={`lp-date-${unit.id}`} name="plannedDate" type="date" />
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={pending} data-testid={`add-lesson-${unit.id}`}>
                    Add lesson
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2"
        data-testid="learning-outcome-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          setError(null);
          startTransition(async () => {
            const result = await createLearningOutcomeAction(institutionId, {
              subjectId: scope.subjectId,
              gradeId: scope.gradeId,
              code: String(fd.get('code') ?? ''),
              statement: String(fd.get('statement') ?? ''),
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
        <h3 className="text-sm font-semibold sm:col-span-2">Learning outcomes</h3>
        <div className="space-y-1.5">
          <Label htmlFor="lo-code">Code</Label>
          <Input id="lo-code" name="code" required maxLength={50} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="lo-statement">Statement</Label>
          <Textarea id="lo-statement" name="statement" required rows={2} maxLength={2000} />
        </div>
        <Button type="submit" size="sm" disabled={pending || !scope.subjectId} data-testid="add-learning-outcome">
          Add outcome
        </Button>
      </form>
      {outcomes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No learning outcomes in this subject yet.</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="learning-outcome-list">
          {outcomes.map((row) => (
            <li key={row.id}>
              <span className="font-medium">{row.code}</span> — {row.statement}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
