'use client';
/**
 * Client layout for /staff/[id]/assignments/new (PRC-L051).
 *
 * Holds the selected class + subject so the Section coverage card reflects the
 * live staff-service assignments for that section.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { AssignmentForm } from '../../../_components/assignment-form';
import { loadSectionCoverageAction, type SectionCoverageState } from '../../../coverage-actions';

type AssignmentFormProps = Parameters<typeof AssignmentForm>[0];

export function AssignmentWorkspace({
  formProps,
  workloadCard,
}: {
  formProps: Omit<AssignmentFormProps, 'onSectionChange'>;
  workloadCard: ReactNode;
}) {
  const [selection, setSelection] = useState({ classId: '', subjectId: '' });
  const onSectionChange = useCallback((next: { classId: string; subjectId: string }) => {
    setSelection((prev) =>
      prev.classId === next.classId && prev.subjectId === next.subjectId ? prev : next,
    );
  }, []);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignment details</CardTitle>
          <CardDescription>
            Staff member, school, class, subject, schedule, and effective dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignmentForm {...formProps} onSectionChange={onSectionChange} />
        </CardContent>
      </Card>
      <aside className="flex flex-col gap-5" aria-label="Assignment context sidebar">
        {workloadCard}
        <SectionCoverageCard
          staffId={formProps.staffId}
          classId={selection.classId}
          subjectId={selection.subjectId}
        />
      </aside>
    </div>
  );
}

export function SectionCoverageCard({
  staffId,
  classId,
  subjectId,
}: {
  staffId: string;
  classId: string;
  subjectId: string;
}) {
  const [state, setState] = useState<SectionCoverageState | null>(null);
  const [loading, setLoading] = useState(false);
  const ready = Boolean(classId && subjectId);
  useEffect(() => {
    if (!ready) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadSectionCoverageAction(classId, subjectId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Section coverage is unavailable.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, classId, subjectId]);

  let body: ReactNode;
  if (!ready) {
    body = (
      <p className="text-xs text-muted-foreground">
        Select a class and subject to see who already teaches this section.
      </p>
    );
  } else if (loading || !state) {
    body = (
      <p className="text-xs text-muted-foreground" role="status">
        Checking coverage…
      </p>
    );
  } else if (state.status === 'error') {
    body = (
      <p className="text-xs text-destructive" role="alert">
        {state.message}
      </p>
    );
  } else if (state.rows.length === 0) {
    body = (
      <p className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
        Coverage gap: no active teacher is assigned to this class and subject.
      </p>
    );
  } else {
    const total = state.rows.reduce((sum, row) => sum + row.allocationPercentage, 0);
    body = (
      <div role="status">
        <ul className="space-y-1.5" aria-label="Current section teachers">
          {state.rows.map((row) => (
            <li key={`${row.staffId}-${row.startDate}`} className="flex justify-between text-xs">
              <span className="truncate text-muted-foreground">
                {row.staffLabel}
                {row.staffId === staffId ? ' (this staff member)' : ''}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {row.allocationPercentage}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          {state.rows.length} active assignment{state.rows.length === 1 ? '' : 's'} · {total}%
          combined allocation
        </p>
      </div>
    );
  }
  return (
    <Card data-testid="section-coverage-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Section coverage</CardTitle>
        <CardDescription className="text-xs">
          Active staff assignments for the selected class and subject
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">{body}</CardContent>
    </Card>
  );
}
