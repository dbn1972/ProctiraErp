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

export function AttendanceReportFilters({
  institutions,
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
            <Label htmlFor="classId">Class UUID</Label>
            <Input
              id="classId"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              placeholder="Required for class scope"
              disabled={scope !== 'class'}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="studentId">Student UUID</Label>
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
        <ResultPanel result={serverState.data} />
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: AttendancePercentageResult }) {
  const fmt = (value: number) => `${value.toFixed(2)}%`;

  return (
    <div
      className="rounded-md border p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold tracking-tight">
          {fmt(result.attendancePercentage)}
        </span>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">
          attendance · {fmt(result.absencePercentage)} absence
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <Stat label="Total records" value={result.totalRecords} />
        <Stat label="Present" value={result.presentCount} />
        <Stat label="Absent" value={result.absentCount} />
        <Stat label="Late" value={result.lateCount} />
        <Stat label="Excused" value={result.excusedCount} />
      </dl>
      <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
        Scope: {result.scope}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="text-lg font-medium">{value.toLocaleString()}</dd>
    </div>
  );
}
