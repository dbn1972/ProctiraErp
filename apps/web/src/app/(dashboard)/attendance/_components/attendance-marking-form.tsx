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
import { Save } from 'lucide-react';
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

const STATUS_OPTIONS: { value: AttendanceStatusValue; label: string }[] = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'EXCUSED', label: 'Excused' },
];

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

function rosterToRows(roster: RosterEntry[]): RowState[] {
  return roster.map((entry) => ({
    studentId: entry.studentId,
    studentName: entry.studentName,
    status:
      (entry.attendance?.status as AttendanceStatusValue | undefined) ??
      'PRESENT',
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
        message:
          parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
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
        <Button
          type="button"
          variant="outline"
          onClick={reload}
          disabled={isPending}
        >
          Load roster
        </Button>
        {rows.length > 0 && (
          <>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Bulk set:
            </span>
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => bulkSet(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </>
        )}
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
        <p className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]">
          No roster yet. Choose an institution, class, academic period, and
          date, then click <strong>Load roster</strong>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Attendance roster">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.studentId}>
                  <TableCell className="font-medium">
                    {row.studentName}
                  </TableCell>
                  <TableCell className="min-w-[160px]">
                    <Select
                      value={row.status}
                      onValueChange={(value) =>
                        setRowStatus(
                          row.studentId,
                          value as AttendanceStatusValue,
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label={`Attendance status for ${row.studentName}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="min-w-[280px]">
                    <Input
                      aria-label={`Comment for ${row.studentName}`}
                      value={row.comment}
                      onChange={(e) =>
                        setRowComment(row.studentId, e.target.value)
                      }
                      placeholder="Optional"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            <Save className="me-2 h-4 w-4" aria-hidden="true" />
            {isSaving ? 'Saving…' : 'Save attendance'}
          </Button>
        </div>
      )}
    </div>
  );
}
