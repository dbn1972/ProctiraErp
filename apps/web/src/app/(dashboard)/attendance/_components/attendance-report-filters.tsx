'use client';

/**
 * Attendance Report filters + result panel (Client Component).
 *
 * - Scope: student / class / institution.
 * - Date range mandatory; end ≥ start.
 * - Submits via the `getAttendanceReportAction` Server Action and renders
 *   percentage breakdown rounded to 2 decimal places.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';
import { addDaysToIsoDate, todayInTimeZone } from '@/lib/datetime/tenant-zoned';
import {
  exportAttendanceReportAction,
  getAttendanceReportAction,
  type ActionState,
  type AttendanceReportView,
} from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

/** Class with its owning institution, for the cascading picker (PRC-M082). */
export interface ReportClassOption {
  id: string;
  name: string;
  institutionId: string;
}

interface AttendanceReportFiltersProps {
  institutions: InstitutionOption[];
  classes?: ReportClassOption[];
  studentOptions?: EntityLabelOption[];
  /** Student directory size when `studentOptions` is a capped page. */
  studentTotal?: number;
  /** PRC-M078: today in the tenant timezone (server-computed). */
  today?: string;
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AttendanceReportFilters({
  institutions,
  classes = [],
  studentOptions = [],
  studentTotal,
  today: tenantToday,
}: AttendanceReportFiltersProps) {
  const today = tenantToday ?? todayInTimeZone();
  const monthAgo = addDaysToIsoDate(today, -30);
  const [scope, setScope] = useState<'student' | 'class' | 'institution'>('institution');
  const [institutionId, setInstitutionId] = useState('');
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [studentLabel, setStudentLabel] = useState('');
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [serverState, setServerState] = useState<ActionState<AttendanceReportView> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [exportState, setExportState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  // Cascading picker: only classes of the chosen institution.
  const classChoices = institutionId
    ? classes.filter((c) => c.institutionId === institutionId)
    : [];

  // Values of the last successful run, so Export always matches what is shown.
  const [lastRun, setLastRun] = useState<{
    values: Parameters<typeof getAttendanceReportAction>[0];
    scopeLabel: string;
  } | null>(null);

  function currentScopeLabel(): string {
    if (scope === 'student') return studentLabel || 'Student';
    if (scope === 'class') return classes.find((c) => c.id === classId)?.name ?? 'Class';
    return institutions.find((i) => i.id === institutionId)?.name ?? 'Institution';
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setServerState(null);
    const values = { scope, institutionId, classId, studentId, startDate, endDate };
    try {
      const result = await getAttendanceReportAction(values);
      setServerState(result);
      if (result.status === 'success') setLastRun({ values, scopeLabel: currentScopeLabel() });
    } finally {
      setIsPending(false);
    }
  }

  async function onExport() {
    if (!lastRun) return;
    setExportState({ busy: true, error: null });
    try {
      const result = await exportAttendanceReportAction(lastRun.values, lastRun.scopeLabel);
      if (result.status !== 'success' || !result.data) {
        setExportState({ busy: false, error: result.message ?? 'Export failed' });
        return;
      }
      downloadCsv(result.data.filename, result.data.csv);
      setExportState({ busy: false, error: null });
    } catch {
      setExportState({ busy: false, error: 'Export failed' });
    }
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as 'student' | 'class' | 'institution')}
            >
              <SelectTrigger id="scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="institution">Institution</SelectItem>
                <SelectItem value="class">Class</SelectItem>
                <SelectItem value="student">Student</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="institutionId">Institution</Label>
            <Select
              value={institutionId || undefined}
              onValueChange={(value) => {
                setInstitutionId(value);
                setClassId('');
              }}
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
          {scope === 'class' ? (
            <div className="space-y-1">
              <Label htmlFor="classId">Class</Label>
              <Select
                value={classId || undefined}
                onValueChange={(value) => setClassId(value)}
                disabled={!institutionId}
              >
                <SelectTrigger id="classId">
                  <SelectValue
                    placeholder={institutionId ? 'Select class' : 'Select institution first'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {classChoices.length === 0 ? (
                    <SelectItem value={ZERO_UUID} disabled>
                      {institutionId
                        ? 'No classes for this institution'
                        : 'Select institution first'}
                    </SelectItem>
                  ) : (
                    classChoices.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {scope === 'student' ? (
            <EntitySearchSelect
              id="studentId"
              name="studentId"
              label="Student"
              options={studentOptions}
              remoteSearch="student"
              totalAvailable={studentTotal}
              onValueChange={setStudentId}
              onOptionSelected={(option) => setStudentLabel(option?.label ?? '')}
              placeholder="Search by name or admission number…"
            />
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="startDate">Start date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endDate">End date</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              max={today}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Calculating…' : 'Run report'}
          </Button>
        </div>
      </form>
      {serverState?.status === 'error' && serverState.message && (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          {serverState.message}
        </div>
      )}
      {exportState.error ? (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
          data-testid="export-attendance-error"
        >
          {exportState.error}
        </div>
      ) : null}
      {serverState?.status === 'success' && serverState.data && (
        <ResultPanel result={serverState.data} onExport={onExport} exporting={exportState.busy} />
      )}
    </div>
  );
}

/** Save the server-built CSV (the export itself is audited server-side). */
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ResultPanel({
  result,
  onExport,
  exporting,
}: {
  result: AttendanceReportView;
  onExport: () => void;
  exporting: boolean;
}) {
  const fmt = (value: number) => `${value.toFixed(2)}%`;
  const pct = result.attendancePercentage;
  const tone =
    pct >= 90
      ? 'text-emerald-600 dark:text-emerald-400'
      : pct >= 75
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';
  const barTone = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      {/* Headline */}
      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className={`text-4xl font-extrabold tabular-nums tracking-tight ${tone}`}>
              {fmt(pct)}
            </span>
            <span className="text-sm text-muted-foreground">
              attendance · {fmt(result.absencePercentage)} absence · scope: {result.scope}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting}
            data-testid="export-attendance-csv"
          >
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${barTone}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Attendance percentage"
          />
        </div>
      </div>

      {/* KPI breakdown */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total records" value={result.totalRecords} />
        <Stat
          label="Present"
          value={result.presentCount}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <Stat label="Absent" value={result.absentCount} accent="text-red-600 dark:text-red-400" />
        <Stat label="Late" value={result.lateCount} accent="text-amber-600 dark:text-amber-400" />
        <Stat
          label="Early departure"
          value={result.earlyDepartureCount ?? 0}
          accent="text-violet-600 dark:text-violet-400"
        />
        <Stat label="Excused" value={result.excusedCount} accent="text-sky-600 dark:text-sky-400" />
      </dl>

      {(result.studentRows ?? []).length > 0 ? (
        <div className="overflow-x-auto" data-testid="attendance-student-rows">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Per-student attendance rows</caption>
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="px-2 py-2 font-medium">Student</th>
                <th className="px-2 py-2 font-medium">Present</th>
                <th className="px-2 py-2 font-medium">Absent</th>
                <th className="px-2 py-2 font-medium">Late</th>
                <th className="px-2 py-2 font-medium">Early</th>
                <th className="px-2 py-2 font-medium">Excused</th>
                <th className="px-2 py-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {(result.studentRows ?? []).map((row) => (
                <tr key={row.studentId} className="border-b border-border/60">
                  <td className="px-2 py-2">
                    {result.studentLabels[row.studentId] ?? 'Unknown student'}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{row.presentCount}</td>
                  <td className="px-2 py-2 tabular-nums">{row.absentCount}</td>
                  <td className="px-2 py-2 tabular-nums">{row.lateCount}</td>
                  <td className="px-2 py-2 tabular-nums">{row.earlyDepartureCount}</td>
                  <td className="px-2 py-2 tabular-nums">{row.excusedCount}</td>
                  <td className="px-2 py-2 tabular-nums">{row.attendancePercentage.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-0.5 text-xl font-bold tabular-nums ${accent ?? 'text-foreground'}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
