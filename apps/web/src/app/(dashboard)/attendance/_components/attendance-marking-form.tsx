'use client';

/**
 * Attendance Marking form (Client Component).
 *
 * - Picks institution, class, academic period, date — pushes the selection
 *   to the URL so the server reloads the roster.
 * - Renders the pre-populated roster as a status grid (PRESENT/ABSENT/LATE/
 *   EXCUSED) with optional comments.
 * - Submits via the `markAttendanceAction` Server Action.
 * - Auto-saves the in-progress marking grid to `localStorage` every
 *   30 s (Task 60.5, Requirement 38 AC 8). The draft slot is keyed
 *   `attendance-marking-<academicPeriodId>` so a clerk who loses
 *   power, closes the tab, or drops connectivity can resume the
 *   day's roster on remount. The draft is cleared on a successful
 *   bulk save.
 */
import { CheckCheck, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  Button,
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
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import type { BulkAttendanceResponse, RosterEntry } from '@/lib/api/attendance';
import { useDraftAutosave } from '@/lib/draft/useDraftAutosave';
import {
  attendanceMarkingFormSchema,
  type AttendanceStatusValue,
} from '@/lib/validation/attendance-schema';

import { markAttendanceAction, type ActionState } from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

interface ClassOption {
  id: string;
  name: string;
}

interface AcademicPeriodOption {
  id: string;
  name: string;
  isActive?: boolean;
}

interface AttendanceMarkingFormProps {
  institutions: InstitutionOption[];
  /** Class sections for the selected institution (empty until one is chosen). */
  classes?: ClassOption[];
  /** Academic periods for the selected institution. */
  academicPeriods?: AcademicPeriodOption[];
  defaults: {
    institutionId: string;
    classId: string;
    academicPeriodId: string;
    date: string;
  };
  roster: RosterEntry[];
}

interface RowState {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue;
  comment: string;
}

/**
 * Status order is the keyboard order (UX AT-2) and the message key is the label (UX AT-4).
 *
 * Labels were English literals here, which made the five statuses untranslatable — the one part
 * of this screen a teacher reads on every row.
 */
const STATUS_OPTIONS: { value: AttendanceStatusValue; labelKey: string }[] = [
  { value: 'PRESENT', labelKey: 'statusPresent' },
  { value: 'ABSENT', labelKey: 'statusAbsent' },
  { value: 'LATE', labelKey: 'statusLate' },
  { value: 'EXCUSED', labelKey: 'statusExcused' },
  { value: 'EARLY_DEPARTURE', labelKey: 'statusEarly' },
];

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

/* ── Avatar palette (literal class names for Tailwind purge) ── */
const AVATAR_PALETTES = [
  'bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100   text-rose-700   dark:bg-rose-900   dark:text-rose-300',
  'bg-amber-100  text-amber-700  dark:bg-amber-900  dark:text-amber-300',
  'bg-teal-100   text-teal-700   dark:bg-teal-900   dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/* ── Segmented attendance status toggle ── */
const TOGGLE_ON: Record<AttendanceStatusValue, string> = {
  PRESENT: 'bg-emerald-500 text-white',
  ABSENT: 'bg-red-500 text-white',
  LATE: 'bg-amber-500 text-white',
  EXCUSED: 'bg-sky-500 text-white',
  EARLY_DEPARTURE: 'bg-violet-500 text-white',
};

/**
 * One student's attendance status — a real radio group (UX AT-2).
 *
 * ## What was wrong
 *
 * This was a `role="group"` of five `<button aria-pressed>` elements. Two consequences, both
 * costly on the product's highest-frequency screen:
 *
 * 1. **Five tab stops per student.** A 40-student roster was ~200 tab stops before the first
 *    comment field. Marking six classes a day by keyboard was not realistic.
 * 2. **Wrong semantics.** Assistive technology heard five independent toggle buttons rather
 *    than one five-way choice, so a screen-reader user was never told "2 of 5" or that picking
 *    one clears the others.
 *
 * The mobile form in `features/attendance/` already used `radiogroup`/`radio`/`aria-checked`.
 * The live desktop grid did not, so the better pattern existed and was unused.
 *
 * ## The model now
 *
 * Standard WAI-ARIA radio group with a roving tabindex:
 *
 * - **one tab stop per row** — only the checked option is tabbable, so Tab moves student to
 *   student and the 40-row roster costs 40 stops, not 200
 * - **arrow keys move *and* select**, wrapping at both ends, which is the expected radio
 *   behaviour and means marking a row is one keystroke
 * - **Home / End** jump to first / last
 * - **type-ahead on the first letter** — `p`, `a`, `l`, `e` (cycles Excused → Early)
 * - **Space** selects the focused option, for users who expect button semantics
 *
 * Focus follows selection so the announcement and the visible ring stay together.
 */
function StatusToggle({
  value,
  onChange,
  studentName,
}: {
  value: AttendanceStatusValue;
  onChange: (v: AttendanceStatusValue) => void;
  studentName: string;
}) {
  const t = useTranslations('attendance');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Select `next` and move focus to it, so the ring and the announcement agree. */
  function selectAndFocus(next: AttendanceStatusValue) {
    onChange(next);
    refs.current[next]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = STATUS_OPTIONS.findIndex((o) => o.value === value);
    const last = STATUS_OPTIONS.length - 1;
    const at = (i: number) => STATUS_OPTIONS[i]!.value;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAndFocus(at(index >= last ? 0 : index + 1));
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAndFocus(at(index <= 0 ? last : index - 1));
        return;
      case 'Home':
        event.preventDefault();
        selectAndFocus(at(0));
        return;
      case 'End':
        event.preventDefault();
        selectAndFocus(at(last));
        return;
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        selectAndFocus(value);
        return;
      default:
        break;
    }

    // Type-ahead. `e` matches Excused then Early, so search forward from the current
    // position and wrap — repeated presses cycle rather than sticking on the first match.
    if (event.key.length !== 1) return;
    const letter = event.key.toLowerCase();
    if (!/[a-z]/.test(letter)) return;
    for (let step = 1; step <= STATUS_OPTIONS.length; step += 1) {
      const candidate = STATUS_OPTIONS[(index + step) % STATUS_OPTIONS.length]!;
      // Matched against the *translated* label, so type-ahead follows the user's language
      // rather than the English source.
      if (t(candidate.labelKey).toLowerCase().startsWith(letter)) {
        event.preventDefault();
        selectAndFocus(candidate.value);
        return;
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('statusLabel', { name: studentName })}
      onKeyDown={handleKeyDown}
      className="inline-flex gap-1 rounded-full bg-muted p-1"
    >
      {STATUS_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(node) => {
              refs.current[opt.value] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex — the whole point of the fix. Only the checked option is
            // reachable by Tab, so one row costs one tab stop.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? TOGGLE_ON[opt.value] : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function rosterToRows(roster: RosterEntry[]): RowState[] {
  return roster.map((entry) => ({
    studentId: entry.studentId,
    studentName: entry.studentName,
    status: (entry.attendance?.status as AttendanceStatusValue | undefined) ?? 'PRESENT',
    comment: entry.attendance?.comment ?? '',
  }));
}

/**
 * The full snapshot persisted by `useDraftAutosave` for this form.
 * Captures both the selection (so the user does not have to retype
 * institution/class/period/date on remount) and the per-row status
 * grid (so partial markings survive a refresh).
 */
interface AttendanceDraftSnapshot {
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  rows: RowState[];
}

export function AttendanceMarkingForm({
  institutions,
  classes = [],
  academicPeriods = [],
  defaults,
  roster,
}: AttendanceMarkingFormProps) {
  const t = useTranslations('attendance');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [institutionId, setInstitutionId] = useState(defaults.institutionId);
  const [classId, setClassId] = useState(defaults.classId);
  const [academicPeriodId, setAcademicPeriodId] = useState(defaults.academicPeriodId);
  const [date, setDate] = useState(defaults.date);
  const [rows, setRows] = useState<RowState[]>(() => rosterToRows(roster));
  const [serverState, setServerState] = useState<ActionState<BulkAttendanceResponse> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Draft autosave (Task 60.5 / Requirement 38.8). The slot key
  // includes the academic period so two periods open in different
  // tabs do not clobber each other; an empty period falls back to
  // `default` so the slot remains stable while the clerk picks a
  // period for the first time.
  const draftFormId = `attendance-marking-${academicPeriodId || 'default'}`;
  const draft = useDraftAutosave<AttendanceDraftSnapshot>(draftFormId);

  // Hydrate from the persisted draft once after the autosave layer
  // re-reads on mount (it returns `null` during SSR / first render).
  // We only seed once so subsequent edits are not clobbered if the
  // hook re-emits.
  const hasHydratedDraftRef = useRef<boolean>(false);
  /**
   * UX AT-2 — focus moves to the error when a submit is rejected.
   *
   * Previously the `role="alert"` appeared above the grid and focus stayed on the submit button
   * at the bottom of a 40-row roster. A screen-reader user heard the message but had no way to
   * reach it; a sighted keyboard user had no idea the page had changed 40 rows above them.
   */
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hasHydratedDraftRef.current) return;
    if (draft.values === null) return;
    const snap = draft.values;
    setInstitutionId(snap.institutionId);
    setClassId(snap.classId);
    setAcademicPeriodId(snap.academicPeriodId);
    setDate(snap.date);
    if (snap.rows.length > 0) {
      setRows(snap.rows);
    }
    hasHydratedDraftRef.current = true;
  }, [draft.values]);

  // Re-sync rows whenever the roster prop changes (new selection loaded by RSC).
  useEffect(() => {
    setRows(rosterToRows(roster));
  }, [roster]);

  // UX AT-2 — pull focus to the rejection so it is reachable, not just announced.
  useEffect(() => {
    if (serverState?.status === 'error') errorRef.current?.focus();
  }, [serverState]);

  // Autosave the live snapshot on every change. The hook itself
  // debounces to 30 s so this is cheap.
  useEffect(() => {
    draft.save({
      institutionId,
      classId,
      academicPeriodId,
      date,
      rows,
    });
  }, [draft, institutionId, classId, academicPeriodId, date, rows]);

  function pushSelection(selection: {
    institutionId: string;
    classId: string;
    academicPeriodId: string;
    date: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(selection)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.replace(`/attendance?${params.toString()}`);
    });
  }

  function reload() {
    pushSelection({ institutionId, classId, academicPeriodId, date });
  }

  /**
   * Institution drives the class/period option lists (loaded server-side
   * from the URL), so switching it clears the dependent selections and
   * reloads immediately to fetch fresh options.
   */
  function handleInstitutionChange(value: string) {
    setInstitutionId(value);
    setClassId('');
    setAcademicPeriodId('');
    pushSelection({
      institutionId: value,
      classId: '',
      academicPeriodId: '',
      date,
    });
  }

  function setRowStatus(studentId: string, status: AttendanceStatusValue) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, status } : r)));
  }

  function setRowComment(studentId: string, comment: string) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)));
  }

  function bulkSet(status: AttendanceStatusValue) {
    setRows((prev) => prev.map((r) => ({ ...r, status })));
  }

  async function handleSave() {
    const values = {
      institutionId,
      classId,
      academicPeriodId,
      date,
      records: rows.map((r) => ({
        studentId: r.studentId,
        status: r.status,
        comment: r.comment ?? '',
      })),
    };
    const parsed = attendanceMarkingFormSchema.safeParse(values);
    if (!parsed.success) {
      setServerState({
        status: 'error',
        message: parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
      });
      return;
    }
    setIsSaving(true);
    setServerState(null);
    // Flush before submission so a crash mid-network leaves the
    // current snapshot recoverable.
    draft.flush({ institutionId, classId, academicPeriodId, date, rows });
    try {
      const result = await markAttendanceAction(parsed.data);
      setServerState(result);
      if (result.status === 'success') {
        // Successful bulk save — discard the persisted draft so the
        // next visit starts from the server-supplied roster.
        draft.clear();
      }
    } finally {
      setIsSaving(false);
    }
  }

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, EARLY_DEPARTURE: 0 } as Record<
      AttendanceStatusValue,
      number
    >,
  );

  return (
    <div
      className="space-y-6"
      data-testid="attendance-marking-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="institutionId">{t('institution')}</Label>
          <Select value={institutionId || undefined} onValueChange={handleInstitutionChange}>
            <SelectTrigger id="institutionId">
              <SelectValue placeholder={t('selectInstitution')} />
            </SelectTrigger>
            <SelectContent>
              {institutions.length === 0 ? (
                <SelectItem value={ZERO_UUID} disabled>
                  {t('noInstitutions')}
                </SelectItem>
              ) : (
                institutions.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="classId">{t('class')}</Label>
          <Select value={classId || undefined} onValueChange={(value) => setClassId(value)}>
            <SelectTrigger id="classId" aria-label={t('class')}>
              <SelectValue
                placeholder={institutionId ? t('selectClass') : t('selectInstitutionFirst')}
              />
            </SelectTrigger>
            <SelectContent>
              {classId && !classes.some((c) => c.id === classId) && (
                <SelectItem value={classId}>{t('selectedClass')}</SelectItem>
              )}
              {classes.length === 0 && !classId ? (
                <SelectItem value={ZERO_UUID} disabled>
                  {institutionId
                    ? 'No classes for this institution'
                    : 'Select an institution first'}
                </SelectItem>
              ) : (
                classes.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="academicPeriodId">{t('academicPeriod')}</Label>
          <Select
            value={academicPeriodId || undefined}
            onValueChange={(value) => setAcademicPeriodId(value)}
          >
            <SelectTrigger id="academicPeriodId" aria-label={t('academicPeriod')}>
              <SelectValue
                placeholder={institutionId ? 'Select period' : 'Select institution first'}
              />
            </SelectTrigger>
            <SelectContent>
              {academicPeriodId && !academicPeriods.some((p) => p.id === academicPeriodId) && (
                <SelectItem value={academicPeriodId}>{t('selectedPeriod')}</SelectItem>
              )}
              {academicPeriods.length === 0 && !academicPeriodId ? (
                <SelectItem value={ZERO_UUID} disabled>
                  {institutionId ? 'No academic periods' : 'Select an institution first'}
                </SelectItem>
              ) : (
                academicPeriods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.name}
                    {period.isActive ? ' · active' : ''}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={reload} disabled={isPending}>
          Load roster
        </Button>
      </div>

      {serverState?.status === 'error' && serverState.message && (
        <div
          ref={errorRef}
          // `-1` so it can receive programmatic focus without becoming a Tab stop of its own.
          tabIndex={-1}
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="alert"
          data-testid="attendance-marking-error"
        >
          {serverState.message}
        </div>
      )}
      {serverState?.status === 'success' && serverState.message && (
        <div
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
          role="status"
          aria-live="polite"
          data-testid="attendance-marking-success"
        >
          {serverState.message}
        </div>
      )}

      {rows.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]"
          data-testid="attendance-marking-empty"
        >
          {t('emptyRoster')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* Summary header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <SummaryChip color="bg-emerald-500" count={counts.PRESENT} label="present" />
              <SummaryChip color="bg-red-500" count={counts.ABSENT} label="absent" />
              <SummaryChip color="bg-amber-500" count={counts.LATE} label="late" />
              <SummaryChip color="bg-sky-500" count={counts.EXCUSED} label="excused" />
              <SummaryChip color="bg-violet-500" count={counts.EARLY_DEPARTURE} label="early" />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => bulkSet('PRESENT')}>
              <CheckCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('markAllPresent')}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table aria-label={t('rosterLabel')}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-semibold">{t('columnStudent')}</TableHead>
                  <TableHead className="font-semibold">{t('columnToday')}</TableHead>
                  <TableHead className="font-semibold">{t('columnNote')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.studentId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            avatarPalette(row.studentName),
                          )}
                        >
                          {initials(row.studentName)}
                        </span>
                        <span className="font-medium text-foreground">{row.studentName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[280px]">
                      <StatusToggle
                        value={row.status}
                        studentName={row.studentName}
                        onChange={(v) => setRowStatus(row.studentId, v)}
                      />
                    </TableCell>
                    <TableCell className="min-w-[240px]">
                      <Input
                        aria-label={t('commentLabel', { name: row.studentName })}
                        value={row.comment}
                        onChange={(e) => setRowComment(row.studentId, e.target.value)}
                        placeholder={t('commentPlaceholder')}
                        className="h-9"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/90 px-5 py-3 shadow-lg backdrop-blur">
        <span className="me-auto text-xs text-muted-foreground">
          {/*
            UX AT-4 — the count was `${n} ${n === 1 ? 'student' : 'students'}`, a binary plural
            baked into a template literal. That is correct for English and wrong for Arabic
            (six plural categories) and several Indic languages. ICU `plural` in the catalogue
            lets each locale declare its own rule.
          */}
          {rows.length > 0 ? t('rosterCount', { count: rows.length }) : t('selectBeforeSubmit')}
        </span>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          data-testid="attendance-marking-submit"
        >
          <Save className="me-1.5 h-4 w-4" aria-hidden="true" />
          {isSaving ? t('submitting') : t('submit')}
        </Button>
      </div>
    </div>
  );
}

function SummaryChip({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', color)} />
      <b className="text-foreground tabular-nums">{count}</b> {label}
    </span>
  );
}
