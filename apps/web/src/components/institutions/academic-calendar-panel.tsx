'use client';

/**
 * G-905 — academic calendar for one period: holidays / breaks / grading &
 * exam windows, plus the year-end rollover (dry-run preview → execute).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, CalendarPlus, Loader2, Trash2 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  rolloverAcademicPeriodAction,
  type FieldError,
} from '@/lib/institutions/actions';
import type {
  AcademicPeriod,
  CalendarEvent,
  CalendarEventKind,
  RolloverSummary,
} from '@/lib/institutions/types';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<CalendarEventKind, string> = {
  holiday: 'Holiday',
  break: 'Break',
  grading_window: 'Grading window',
  exam_window: 'Exam window',
  event: 'Event',
};

const KIND_PILL: Record<CalendarEventKind, string> = {
  holiday: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  break: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  grading_window: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  exam_window: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  event: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

function formatDate(d: string): string {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fieldMessage(errors: FieldError[] | undefined, field: string): string | undefined {
  return errors?.find((e) => e.field === field)?.message;
}

interface InstitutionOption {
  id: string;
  name: string;
}

// ─── Calendar events ────────────────────────────────────────────────────────

export interface CalendarEventsCardProps {
  period: AcademicPeriod;
  events: CalendarEvent[];
  institutions: InstitutionOption[];
  loadError?: string | null;
}

const TENANT_WIDE = '__all__';

export function CalendarEventsCard({
  period,
  events,
  institutions,
  loadError,
}: CalendarEventsCardProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<CalendarEventKind>('holiday');
  const [institutionId, setInstitutionId] = useState<string>(TENANT_WIDE);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[] | undefined>();
  const institutionName = new Map(institutions.map((i) => [i.id, i.name]));
  const archived = period.status === 'archived';

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      const result = await createCalendarEventAction(period.id, {
        kind,
        name: String(data.get('name') ?? ''),
        startDate: String(data.get('startDate') ?? ''),
        endDate: String(data.get('endDate') ?? ''),
        institutionId: institutionId === TENANT_WIDE ? '' : institutionId,
        notes: String(data.get('notes') ?? ''),
      });
      if (!result.success) {
        setError(result.error);
        setFieldErrors(result.fieldErrors);
        return;
      }
      form.reset();
      setKind('holiday');
      setInstitutionId(TENANT_WIDE);
      router.refresh();
    });
  };

  const onDelete = (evt: CalendarEvent) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove "${evt.name}" from the calendar?`)
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteCalendarEventAction(period.id, evt.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Calendar events
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {events.length} {events.length === 1 ? 'entry' : 'entries'}
          </span>
        </CardTitle>
        <CardDescription>
          Holidays, breaks and grading / exam windows between {formatDate(period.startDate)} and{' '}
          {formatDate(period.endDate)}. Leave the institution blank for a tenant-wide entry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(error || loadError) && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="calendar-error"
          >
            {error ?? loadError}
          </div>
        )}

        {!archived && (
          <form
            onSubmit={onSubmit}
            className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-6"
            data-testid="calendar-event-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            aria-label="Add calendar event"
          >
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ce-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input id="ce-name" name="name" required maxLength={200} disabled={isPending} />
              {fieldMessage(fieldErrors, 'name') && (
                <p className="text-sm text-destructive">{fieldMessage(fieldErrors, 'name')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as CalendarEventKind)}
                disabled={isPending}
              >
                <SelectTrigger id="ce-kind" data-testid="calendar-event-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as CalendarEventKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-start">
                From <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ce-start"
                name="startDate"
                type="date"
                required
                min={period.startDate}
                max={period.endDate}
                disabled={isPending}
              />
              {fieldMessage(fieldErrors, 'startDate') && (
                <p className="text-sm text-destructive">{fieldMessage(fieldErrors, 'startDate')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-end">
                To <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ce-end"
                name="endDate"
                type="date"
                required
                min={period.startDate}
                max={period.endDate}
                disabled={isPending}
              />
              {fieldMessage(fieldErrors, 'endDate') && (
                <p className="text-sm text-destructive">{fieldMessage(fieldErrors, 'endDate')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-institution">Institution</Label>
              <Select value={institutionId} onValueChange={setInstitutionId} disabled={isPending}>
                <SelectTrigger id="ce-institution" data-testid="calendar-event-institution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TENANT_WIDE}>All institutions</SelectItem>
                  {institutions.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-5">
              <Label htmlFor="ce-notes">Notes</Label>
              <Textarea id="ce-notes" name="notes" rows={2} maxLength={2000} disabled={isPending} />
            </div>
            <div className="flex items-end md:col-span-1">
              <Button
                type="submit"
                className="w-full"
                disabled={isPending}
                data-testid="add-calendar-event"
              >
                {isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CalendarPlus className="me-1.5 h-4 w-4" aria-hidden="true" />
                )}
                Add
              </Button>
            </div>
          </form>
        )}

        {events.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="calendar-empty"
          >
            No calendar entries yet for {period.name}.
          </p>
        ) : (
          <Table aria-label="Calendar events">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold">Entry</TableHead>
                <TableHead className="font-semibold">Kind</TableHead>
                <TableHead className="font-semibold">Dates</TableHead>
                <TableHead className="font-semibold">Scope</TableHead>
                <TableHead className="text-end font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((evt) => (
                <TableRow key={evt.id} data-testid="calendar-event-row" data-event-kind={evt.kind}>
                  <TableCell>
                    <p className="font-medium text-foreground">{evt.name}</p>
                    {evt.notes && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{evt.notes}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        KIND_PILL[evt.kind],
                      )}
                    >
                      {KIND_LABELS[evt.kind]}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {evt.startDate === evt.endDate
                      ? formatDate(evt.startDate)
                      : `${formatDate(evt.startDate)} – ${formatDate(evt.endDate)}`}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {evt.institutionId
                      ? (institutionName.get(evt.institutionId) ?? evt.institutionId)
                      : 'All institutions'}
                  </TableCell>
                  <TableCell className="text-end">
                    {!archived && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => onDelete(evt)}
                        disabled={isPending}
                        aria-label={`Remove ${evt.name}`}
                        data-testid="remove-calendar-event"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Rollover ───────────────────────────────────────────────────────────────

export interface RolloverCardProps {
  source: AcademicPeriod;
  /** Candidate target years (start after the source, not archived). */
  targets: AcademicPeriod[];
  institutions: InstitutionOption[];
}

export function RolloverCard({ source, targets, institutions }: RolloverCardProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [targetPeriodId, setTargetPeriodId] = useState<string>(targets[0]?.id ?? '');
  const [institutionId, setInstitutionId] = useState<string>(TENANT_WIDE);
  const [promote, setPromote] = useState(true);
  const [copyFees, setCopyFees] = useState(true);
  const [copyTimetable, setCopyTimetable] = useState(true);
  const [copyLms, setCopyLms] = useState(true);
  const [summary, setSummary] = useState<RolloverSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (dryRun: boolean) => {
    if (
      !dryRun &&
      typeof window !== 'undefined' &&
      !window.confirm(
        'Execute the rollover? Class sections will be cloned and students promoted into the target year. This can be re-run safely but not undone from here.',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rolloverAcademicPeriodAction(source.id, {
        targetPeriodId,
        institutionId: institutionId === TENANT_WIDE ? '' : institutionId,
        promoteEnrollments: promote,
        copyFeeStructures: copyFees,
        copyTimetable,
        copyLmsAssignments: copyLms,
        idempotencyKey: dryRun ? undefined : `rollover-${source.id}-${targetPeriodId}`,
        dryRun,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSummary(result.data);
      if (!dryRun) router.refresh();
    });
  };

  const targetName = targets.find((t) => t.id === targetPeriodId)?.name;

  return (
    <Card data-testid="rollover-card">
      <CardHeader>
        <CardTitle className="text-base">Year-end rollover</CardTitle>
        <CardDescription>
          Clone {source.name}&apos;s class sections into the next academic year and promote enrolled
          students one grade up. Preview first — nothing is written until you execute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" data-hydrated={hydrated ? 'true' : 'false'}>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="rollover-error"
          >
            {error}
          </div>
        )}

        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="rollover-no-target">
            Create the next academic year (starting after {formatDate(source.startDate)}) to enable
            rollover.
          </p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ro-target">Target year</Label>
                <Select
                  value={targetPeriodId}
                  onValueChange={setTargetPeriodId}
                  disabled={isPending}
                >
                  <SelectTrigger id="ro-target" data-testid="rollover-target">
                    <SelectValue placeholder="Select the next academic year" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ro-institution">Institution</Label>
                <Select value={institutionId} onValueChange={setInstitutionId} disabled={isPending}>
                  <SelectTrigger id="ro-institution" data-testid="rollover-institution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TENANT_WIDE}>All institutions</SelectItem>
                    {institutions.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="ro-promote"
                checked={promote}
                onCheckedChange={(v) => setPromote(v === true)}
                disabled={isPending}
                data-testid="rollover-promote"
              />
              <Label htmlFor="ro-promote" className="font-normal">
                Promote enrolled students to the next grade (graduating grade is left for graduation
                handling)
              </Label>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Also copy into the target year
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ro-fees"
                  checked={copyFees}
                  onCheckedChange={(v) => setCopyFees(v === true)}
                  disabled={isPending}
                  data-testid="rollover-copy-fees"
                />
                <Label htmlFor="ro-fees" className="font-normal">
                  Fee structures
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ro-tt"
                  checked={copyTimetable}
                  onCheckedChange={(v) => setCopyTimetable(v === true)}
                  disabled={isPending}
                  data-testid="rollover-copy-timetable"
                />
                <Label htmlFor="ro-tt" className="font-normal">
                  Timetable sections &amp; meetings
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ro-lms"
                  checked={copyLms}
                  onCheckedChange={(v) => setCopyLms(v === true)}
                  disabled={isPending}
                  data-testid="rollover-copy-lms"
                />
                <Label htmlFor="ro-lms" className="font-normal">
                  LMS assignments (as drafts)
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => run(true)}
                disabled={isPending || !targetPeriodId}
                data-testid="rollover-preview"
              >
                {isPending && (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Preview
              </Button>
              <Button
                type="button"
                onClick={() => run(false)}
                disabled={isPending || !targetPeriodId || !summary || !summary.dryRun}
                data-testid="rollover-execute"
              >
                <ArrowRightLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
                Execute rollover
              </Button>
            </div>

            {summary && (
              <dl
                className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2"
                data-testid="rollover-summary"
                data-dry-run={summary.dryRun ? 'true' : 'false'}
              >
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {summary.dryRun ? 'Preview' : 'Executed'} →{' '}
                    {targetName ?? summary.targetPeriodId}
                  </dt>
                </div>
                <Stat
                  label="Sections to create"
                  value={summary.dryRun ? summary.classes.toCreate : summary.classes.created}
                  testId="rollover-classes"
                />
                <Stat label="Sections already present" value={summary.classes.existing} />
                <Stat label="Students considered" value={summary.enrollments.considered} />
                <Stat
                  label={summary.dryRun ? 'Students to promote' : 'Students promoted'}
                  value={
                    summary.dryRun ? summary.enrollments.toPromote : summary.enrollments.promoted
                  }
                  testId="rollover-promoted"
                />
                <Stat label="Graduating (no next grade)" value={summary.enrollments.graduating} />
                <Stat label="Already in target year" value={summary.enrollments.alreadyInTarget} />
                {summary.feeStructures && (
                  <Stat
                    label={summary.dryRun ? 'Fee structures to clone' : 'Fee structures cloned'}
                    value={summary.feeStructures.cloned}
                    testId="rollover-fees"
                  />
                )}
                {summary.timetable && (
                  <Stat
                    label={summary.dryRun ? 'Timetable sections to clone' : 'Timetable sections cloned'}
                    value={summary.timetable.sectionsCloned}
                    testId="rollover-timetable"
                  />
                )}
                {summary.lmsAssignments && (
                  <Stat
                    label={summary.dryRun ? 'LMS assignments to clone' : 'LMS assignments cloned'}
                    value={summary.lmsAssignments.cloned}
                    testId="rollover-lms"
                  />
                )}
              </dl>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-foreground" data-testid={testId}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
