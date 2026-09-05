'use client';

/**
 * Attendance Report filters + result panel (Client Component).
 *
 * Layout per redesign/web/attendance-reports.html:
 *  - Scope pickers (institution / class / student) + date range + Run report
 *  - KPI cards (avg attendance, present, absent, chronic-style absent rate)
 *  - Detail breakdown table
 */
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Percent,
  UserX,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
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
import type { AttendancePercentageResult } from '@/lib/api/attendance-types';
import { cn } from '@/lib/utils';

import { getAttendanceReportAction, type ActionState } from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

interface AttendanceReportFiltersProps {
  institutions: InstitutionOption[];
  /** Notifies the page shell when a report result is available for CSV export. */
  onReportLoaded?: (
    result: AttendancePercentageResult | null,
    meta: {
      scope: string;
      institutionId?: string;
      startDate?: string;
      endDate?: string;
    } | null,
  ) => void;
}

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export function AttendanceReportFilters({
  institutions,
  onReportLoaded,
}: AttendanceReportFiltersProps) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [scope, setScope] = useState<'student' | 'class' | 'institution'>(
    'institution',
  );
  const [institutionId, setInstitutionId] = useState('');
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [serverState, setServerState] =
    useState<ActionState<AttendancePercentageResult> | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setServerState(null);
    onReportLoaded?.(null, null);
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
      if (result.status === 'success' && result.data) {
        onReportLoaded?.(result.data, {
          scope,
          institutionId: institutionId || undefined,
          startDate,
          endDate,
        });
      } else {
        onReportLoaded?.(null, null);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
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
            <Label htmlFor="scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(value) =>
                setScope(value as 'student' | 'class' | 'institution')
              }
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
            <Label htmlFor="startDate">From</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1 lg:flex-row lg:items-end lg:gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="endDate">To</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                max={today}
              />
            </div>
            <Button type="submit" disabled={isPending} className="h-[42px] shrink-0">
              {isPending ? 'Calculating…' : 'Run report'}
            </Button>
          </div>

          {scope === 'class' ? (
            <div className="space-y-1 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="classId">Class reference</Label>
              <Input
                id="classId"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                placeholder="Class ID required for class scope"
              />
            </div>
          ) : null}

          {scope === 'student' ? (
            <div className="space-y-1 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="studentId">Student reference</Label>
              <Input
                id="studentId"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="Student ID required for student scope"
              />
            </div>
          ) : null}
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
        <ResultPanel result={serverState.data} />
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: AttendancePercentageResult }) {
  const fmt = (value: number) => `${value.toFixed(1)}%`;
  const pct = result.attendancePercentage;
  const flag =
    pct >= 90 ? 'On track' : pct >= 75 ? 'Watch' : 'Intervention';
  const flagClass =
    pct >= 90
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
      : pct >= 75
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
        : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400';
  const barTone =
    pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Percent className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Avg attendance"
          value={fmt(pct)}
          foot={`${fmt(result.absencePercentage)} absence · scope: ${result.scope}`}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Present records"
          value={result.presentCount.toLocaleString()}
          foot={`of ${result.totalRecords.toLocaleString()} total`}
        />
        <KpiCard
          icon={<UserX className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
          label="Absent records"
          value={result.absentCount.toLocaleString()}
          foot={`${result.lateCount.toLocaleString()} late · ${result.excusedCount.toLocaleString()} excused`}
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label="Status flag"
          value={flag}
          valueClass="text-2xl"
          foot={pct >= 90 ? 'Target ≥ 90%' : 'Below target — follow up'}
        />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Attendance summary
            </h3>
            <p className="text-xs text-muted-foreground">
              Breakdown for the selected scope and date range
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table aria-label="Attendance summary">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="ps-4 font-semibold">Metric</TableHead>
                  <TableHead className="font-semibold text-end">Count</TableHead>
                  <TableHead className="font-semibold">Share</TableHead>
                  <TableHead className="pe-4 font-semibold">Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SummaryRow
                  label="Attendance rate"
                  count={result.presentCount + result.lateCount}
                  total={result.totalRecords}
                  valueLabel={fmt(pct)}
                  barClass={barTone}
                  flag={flag}
                  flagClass={flagClass}
                />
                <SummaryRow
                  label="Present"
                  count={result.presentCount}
                  total={result.totalRecords}
                  barClass="bg-emerald-500"
                />
                <SummaryRow
                  label="Absent"
                  count={result.absentCount}
                  total={result.totalRecords}
                  barClass="bg-red-500"
                />
                <SummaryRow
                  label="Late"
                  count={result.lateCount}
                  total={result.totalRecords}
                  barClass="bg-amber-500"
                />
                <SummaryRow
                  label="Excused"
                  count={result.excusedCount}
                  total={result.totalRecords}
                  barClass="bg-sky-500"
                />
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  count,
  total,
  valueLabel,
  barClass,
  flag,
  flagClass,
}: {
  label: string;
  count: number;
  total: number;
  valueLabel?: string;
  barClass: string;
  flag?: string;
  flagClass?: string;
}) {
  const share = total > 0 ? (count / total) * 100 : 0;
  return (
    <TableRow>
      <TableCell className="ps-4 font-medium">{label}</TableCell>
      <TableCell className="text-end tabular-nums">
        {valueLabel ?? count.toLocaleString()}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', barClass)}
              style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {share.toFixed(1)}%
          </span>
        </div>
      </TableCell>
      <TableCell className="pe-4">
        {flag ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              flagClass,
            )}
          >
            {flag}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  foot,
  valueClass,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div
          className={cn(
            'mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground',
            valueClass,
          )}
        >
          {value}
        </div>
        {foot ? (
          <p className="mt-1 text-xs text-muted-foreground">{foot}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
