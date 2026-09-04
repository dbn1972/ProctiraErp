'use client';

/**
 * Attendance Marking form (Client Component).
 *
 * Layout per redesign/web/attendance-mark.html:
 *  - Context pickers (institution / class / period / date) + Load roster
 *  - Roster summary chips + Mark all present
 *  - Segmented Present / Absent / Late / Excused toggles
 *  - Draft autosave footer + Submit attendance
 *
 * Auto-saves the in-progress marking grid to `localStorage` every
 * 30 s (Task 60.5, Requirement 38 AC 8). The draft slot is keyed
 * `attendance-marking-<academicPeriodId>`. Cleared on successful bulk save.
 */
import { CheckCheck, Save } from 'lucide-react';
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
  /** Optional heading for the loaded roster (class · date). */
  rosterTitle?: string;
}

interface RowState {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | '';
  comment: string;
}

const STATUS_OPTIONS: { value: AttendanceStatusValue; label: string }[] = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'EXCUSED', label: 'Excused' },
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
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/* ── Segmented attendance status toggle ── */
const TOGGLE_ON: Record<AttendanceStatusValue, string> = {
  PRESENT: 'bg-emerald-500 text-white',
  ABSENT:  'bg-red-500 text-white',
  LATE:    'bg-amber-500 text-white',
  EXCUSED: 'bg-sky-500 text-white',
};

function StatusToggle({
  value,
  onChange,
  studentName,
}: {
  value: AttendanceStatusValue | '';
  onChange: (v: AttendanceStatusValue) => void;
  studentName: string;
}) {
  return (
    <div
      role="group"
      aria-label={`Attendance status for ${studentName}`}
      className="inline-flex gap-1 rounded-full bg-muted p-1"
    >
      {STATUS_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              active ? TOGGLE_ON[opt.value] : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
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
    status:
      (entry.attendance?.status as AttendanceStatusValue | undefined) ?? '',
    comment: entry.attendance?.comment ?? '',
  }));
}

/**
 * The full snapshot persisted by `useDraftAutosave` for this form.
 * Captures both the selection and the per-row status grid.
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
  rosterTitle,
}: AttendanceMarkingFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [institutionId, setInstitutionId] = useState(defaults.institutionId);
  const [classId, setClassId] = useState(defaults.classId);
  const [academicPeriodId, setAcademicPeriodId] = useState(
    defaults.academicPeriodId,
  );
  const [date, setDate] = useState(defaults.date);
  const [rows, setRows] = useState<RowState[]>(() => rosterToRows(roster));
  const [serverState, setServerState] =
    useState<ActionState<BulkAttendanceResponse> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const draftFormId = `attendance-marking-${academicPeriodId || 'default'}`;
  const draft = useDraftAutosave<AttendanceDraftSnapshot>(draftFormId);

  const hasHydratedDraftRef = useRef<boolean>(false);
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

  useEffect(() => {
    setRows(rosterToRows(roster));
  }, [roster]);

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
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, status } : r)),
    );
  }

  function setRowComment(studentId: string, comment: string) {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)),
    );
  }

  function bulkSet(status: AttendanceStatusValue) {
    setRows((prev) => prev.map((r) => ({ ...r, status })));
  }

  function handleSaveDraft() {
    draft.flush({ institutionId, classId, academicPeriodId, date, rows });
  }

  async function handleSave() {
    const values = {
      institutionId,
      classId,
      academicPeriodId,
      date,
      records: rows
        .filter((r): r is RowState & { status: AttendanceStatusValue } => r.status !== '')
        .map((r) => ({
          studentId: r.studentId,
          status: r.status,
          comment: r.comment ?? '',
        })),
    };
    if (values.records.length === 0) {
      setServerState({
        status: 'error',
        message: 'Mark at least one student before submitting.',
      });
      return;
    }
    const parsed = attendanceMarkingFormSchema.safeParse(values);
    if (!parsed.success) {
      setServerState({
        status: 'error',
        message:
          parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
      });
      return;
    }
    setIsSaving(true);
    setServerState(null);
    draft.flush({ institutionId, classId, academicPeriodId, date, rows });
    try {
      const result = await markAttendanceAction(parsed.data);
      setServerState(result);
      if (result.status === 'success') {
        draft.clear();
      }
    } finally {
      setIsSaving(false);
    }
  }

  const counts = rows.reduce(
    (acc, r) => {
      if (r.status === '') {
        acc.UNMARKED += 1;
      } else {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
      }
      return acc;
    },
    { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, UNMARKED: 0 } as Record<
      AttendanceStatusValue | 'UNMARKED',
      number
    >,
  );

  return (
    <div className="space-y-6">
      {/* Context pickers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="institutionId">Institution</Label>
          <Select
            value={institutionId || undefined}
            onValueChange={handleInstitutionChange}
          >
            <SelectTrigger id="institutionId">
              <SelectValue placeholder="Select institution" />
            </SelectTrigger>
            <SelectContent>
              {institutions.length === 0 ? (
                <SelectItem value={ZERO_UUID} disabled>
                  No institutions
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
          <Label htmlFor="classId">Class</Label>
          <Select
            value={classId || undefined}
            onValueChange={(value) => setClassId(value)}
          >
            <SelectTrigger id="classId" aria-label="Class">
              <SelectValue
                placeholder={
                  institutionId ? 'Select class' : 'Select institution first'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {classId && !classes.some((c) => c.id === classId) && (
                <SelectItem value={classId}>Selected class</SelectItem>
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
          <Label htmlFor="academicPeriodId">Academic period</Label>
          <Select
            value={academicPeriodId || undefined}
            onValueChange={(value) => setAcademicPeriodId(value)}
          >
            <SelectTrigger id="academicPeriodId" aria-label="Academic period">
              <SelectValue
                placeholder={
                  institutionId ? 'Select period' : 'Select institution first'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {academicPeriodId &&
                !academicPeriods.some((p) => p.id === academicPeriodId) && (
                  <SelectItem value={academicPeriodId}>
                    Selected period
                  </SelectItem>
                )}
              {academicPeriods.length === 0 && !academicPeriodId ? (
                <SelectItem value={ZERO_UUID} disabled>
                  {institutionId
                    ? 'No academic periods'
                    : 'Select an institution first'}
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
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1 lg:flex-row lg:items-end lg:gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={reload}
            disabled={isPending}
            className="h-[42px] shrink-0"
          >
            {isPending ? 'Loading…' : 'Load roster'}
          </Button>
        </div>
      </div>

      {serverState?.status === 'error' && serverState.message && (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          {serverState.message}
        </div>
      )}
      {serverState?.status === 'success' && serverState.message && (
        <div
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
          role="status"
          aria-live="polite"
        >
          {serverState.message}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No roster yet. Choose an institution, class, academic period, and
          date, then click <strong>Load roster</strong>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* Summary header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
            <div>
              {rosterTitle ? (
                <h2 className="text-sm font-semibold text-foreground">
                  {rosterTitle}
                </h2>
              ) : null}
              <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', rosterTitle && 'mt-1.5')}>
                <SummaryChip color="bg-emerald-500" count={counts.PRESENT} label="present" />
                <SummaryChip color="bg-red-500" count={counts.ABSENT} label="absent" />
                <SummaryChip color="bg-amber-500" count={counts.LATE} label="late" />
                {counts.EXCUSED > 0 ? (
                  <SummaryChip color="bg-sky-500" count={counts.EXCUSED} label="excused" />
                ) : null}
                <SummaryChip color="bg-slate-300 dark:bg-slate-600" count={counts.UNMARKED} label="unmarked" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => bulkSet('PRESENT')}>
              <CheckCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              Mark all present
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table aria-label="Attendance roster">
              <TableHeader>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableHead className="ps-4 font-semibold">Student</TableHead>
                  <TableHead className="pe-4 text-end font-semibold">Today</TableHead>
                  <TableHead className="font-semibold">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.studentId}>
                    <TableCell className="ps-4">
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
                    <TableCell className="pe-4 text-end">
                      <div className="flex justify-end">
                        <StatusToggle
                          value={row.status}
                          studentName={row.studentName}
                          onChange={(v) => setRowStatus(row.studentId, v)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[200px]">
                      <Input
                        aria-label={`Comment for ${row.studentName}`}
                        value={row.comment}
                        onChange={(e) => setRowComment(row.studentId, e.target.value)}
                        placeholder="Optional note"
                        className="h-9"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
            <span className="me-auto text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'student' : 'students'} on roster
              {draft.savedAt
                ? ` · draft saved ${formatRelative(draft.savedAt)}`
                : ' · draft autosaves locally'}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="me-1.5 h-4 w-4" aria-hidden="true" />
              {isSaving ? 'Submitting…' : 'Submit attendance'}
            </Button>
          </div>
        </div>
      )}
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

function formatRelative(isoOrMs: string | number): string {
  try {
    const then = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(then));
  } catch {
    return 'just now';
  }
}
