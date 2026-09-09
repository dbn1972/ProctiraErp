/**
 * Academic calendar for one period — G-905.
 *
 * Route: /academic-periods/[id]/calendar
 *
 * Holidays / breaks / grading & exam windows for the period, the term
 * hierarchy under an academic year, and the year-end rollover
 * (dry-run preview → execute) into the following year.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarRange } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';
import {
  CalendarEventsCard,
  RolloverCard,
} from '@/components/institutions/academic-calendar-panel';
import { listInstitutions } from '@/lib/api/institutions';
import { ApiClientError, listAcademicPeriods, listCalendarEvents } from '@/lib/institutions/api';
import type { AcademicPeriod, CalendarEvent } from '@/lib/institutions/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(d: string): string {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const KIND_LABELS: Record<AcademicPeriod['kind'], string> = {
  year: 'Academic year',
  semester: 'Semester',
  term: 'Term',
  quarter: 'Quarter',
};

export default async function AcademicCalendarPage(props: PageProps) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) notFound();

  let periods: AcademicPeriod[] = [];
  try {
    periods = await listAcademicPeriods();
  } catch {
    periods = [];
  }
  const period = periods.find((p) => p.id === id);
  if (!period) notFound();

  const kind = period.kind ?? 'year';
  const parent = period.parentId ? periods.find((p) => p.id === period.parentId) : undefined;
  const children = periods
    .filter((p) => p.parentId === period.id)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const rolloverTargets = periods
    .filter(
      (p) =>
        p.id !== period.id &&
        (p.kind ?? 'year') === 'year' &&
        p.status !== 'archived' &&
        p.startDate > period.startDate,
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  let events: CalendarEvent[] = [];
  let eventsError: string | null = null;
  try {
    events = await listCalendarEvents(period.id);
  } catch (error) {
    eventsError =
      error instanceof ApiClientError
        ? error.message
        : 'The academic calendar service is currently unavailable.';
  }

  let institutions: Array<{ id: string; name: string }> = [];
  try {
    institutions = (await listInstitutions({ pageSize: 50 })).map((i) => ({
      id: i.id,
      name: i.name,
    }));
  } catch {
    institutions = [];
  }

  return (
    <section aria-labelledby="calendar-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/academic-periods">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to academic periods
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
          >
            <CalendarRange className="h-6 w-6" />
          </span>
          <div>
            <h1
              id="calendar-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground"
              data-testid="calendar-period-name"
            >
              {period.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {KIND_LABELS[kind]} · <span className="font-mono text-xs">{period.code}</span> ·{' '}
              {formatDate(period.startDate)} – {formatDate(period.endDate)}
              {parent && (
                <>
                  {' '}
                  · part of{' '}
                  <Link
                    href={`/academic-periods/${parent.id}/calendar`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {parent.name}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {kind === 'year' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Terms
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                {children.length} {children.length === 1 ? 'sub-period' : 'sub-periods'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No terms yet — add them from the academic periods list with &ldquo;Add term&rdquo;.
              </p>
            ) : (
              <ul className="divide-y" data-testid="term-list">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <Link
                        href={`/academic-periods/${child.id}/calendar`}
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {child.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {KIND_LABELS[child.kind ?? 'term']} ·{' '}
                        <span className="font-mono">{child.code}</span>
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(child.startDate)} – {formatDate(child.endDate)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <CalendarEventsCard
        period={period}
        events={events}
        institutions={institutions}
        loadError={eventsError}
      />

      {kind === 'year' && (
        <RolloverCard source={period} targets={rolloverTargets} institutions={institutions} />
      )}
    </section>
  );
}
