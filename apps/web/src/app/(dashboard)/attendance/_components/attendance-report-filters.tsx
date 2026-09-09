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
import type { AttendancePercentageResult } from '@/lib/api/attendance';

import { getAttendanceReportAction, type ActionState } from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

interface AttendanceReportFiltersProps {
  institutions: InstitutionOption[];
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AttendanceReportFilters({ institutions }: AttendanceReportFiltersProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [scope, setScope] = useState<'student' | 'class' | 'institution'>('institution');
  const [institutionId, setInstitutionId] = useState('');
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [serverState, setServerState] = useState<ActionState<AttendancePercentageResult> | null>(
    null,
  );
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setServerState(null);
    try {
      const result = await getAttendanceReportAction({
        scope,
        institutionId,
        classId,
        studentId,
        startDate,
        endDate,
      });
      setServerState(result);
    } finally {
      setIsPending(false);
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
              onValueChange={(value) => setInstitutionId(value)}
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
            <Label htmlFor="classId">Class reference</Label>
            <Input
              id="classId"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              placeholder="Required for class scope"
              disabled={scope !== 'class'}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="studentId">Student reference</Label>
            <Input
              id="studentId"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="Required for student scope"
              disabled={scope !== 'student'}
            />
          </div>

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

      {serverState?.status === 'success' && serverState.data && (
        <ResultPanel
          result={serverState.data}
          range={{ startDate, endDate }}
          scopeId={scope === 'student' ? studentId : scope === 'class' ? classId : institutionId}
        />
      )}
    </div>
  );
}

/** G-925 — CSV of the computed report (one row per metric), downloaded client-side. */
function toReportCsv(
  result: AttendancePercentageResult,
  range: { startDate: string; endDate: string },
  scopeId: string,
): string {
  const rows: Array<[string, string | number]> = [
    ['scope', result.scope],
    ['scope_id', scopeId],
    ['start_date', range.startDate],
    ['end_date', range.endDate],
    ['total_records', result.totalRecords],
    ['present', result.presentCount],
    ['absent', result.absentCount],
    ['late', result.lateCount],
    ['early_departure', result.earlyDepartureCount ?? 0],
    ['excused', result.excusedCount],
    ['attendance_percentage', result.attendancePercentage.toFixed(2)],
    ['absence_percentage', result.absencePercentage.toFixed(2)],
  ];
  const cell = (v: string | number) => {
    const str = String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const metricCsv = `${['metric,value', ...rows.map(([k, v]) => `${k},${cell(v)}`)].join('\n')}\n`;
  const studentRows = result.studentRows ?? [];
  if (studentRows.length === 0) return metricCsv;
  const studentHeader =
    'student_id,total_records,present,absent,late,excused,early_departure,attendance_percentage';
  const studentLines = studentRows.map((r) =>
    [
      cell(r.studentId),
      r.totalRecords,
      r.presentCount,
      r.absentCount,
      r.lateCount,
      r.excusedCount,
      r.earlyDepartureCount,
      r.attendancePercentage.toFixed(2),
    ].join(','),
  );
  return `${metricCsv}\n${[studentHeader, ...studentLines].join('\n')}\n`;
}

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
  range,
  scopeId,
}: {
  result: AttendancePercentageResult;
  range: { startDate: string; endDate: string };
  scopeId: string;
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
            onClick={() =>
              downloadCsv(
                `attendance-${result.scope}-${range.startDate}-${range.endDate}.csv`,
                toReportCsv(result, range, scopeId),
              )
            }
            data-testid="export-attendance-csv"
          >
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            Export CSV
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
                  <td className="px-2 py-2 font-mono text-xs">{row.studentId.slice(0, 8)}…</td>
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
