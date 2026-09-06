'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Bell, CalendarClock, CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { AcademicPeriodFormDialog } from './academic-period-form-dialog';
import { deleteAcademicPeriodAction } from '@/lib/institutions/actions';
import type { AcademicPeriod } from '@/lib/institutions/types';

export interface AcademicPeriodsManagerProps {
  periods: AcademicPeriod[];
  loadError?: string | null;
}

/** Count working days (Mon–Fri) inclusive between two ISO dates. */
function workingDays(start: string, end: string): number | null {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function formatDate(d: string): string {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_PILL: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  scheduled: 'bg-sky-50     text-sky-700     dark:bg-sky-950/40     dark:text-sky-400',
  draft:     'bg-sky-50     text-sky-700     dark:bg-sky-950/40     dark:text-sky-400',
  archived:  'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function AcademicPeriodsManager({
  periods,
  loadError,
}: AcademicPeriodsManagerProps) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    initial?: AcademicPeriod;
  }>({ open: false });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = (period: AcademicPeriod) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Delete academic period "${period.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteAcademicPeriodAction(period.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          All periods
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {periods.length} {periods.length === 1 ? 'period' : 'periods'}
          </span>
        </CardTitle>
        <Button
          size="sm"
          onClick={() => setDialogState({ open: true })}
          disabled={isPending}
        >
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" /> New period
        </Button>
      </CardHeader>
      <CardContent className="space-y-0 px-0">
        {(error || loadError) && (
          <div
            role="alert"
            className="mx-6 mb-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error ?? loadError}
          </div>
        )}

        {periods.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-base font-semibold">No academic periods yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create one to enable enrollment, attendance, and assessments for the
              school year.
            </p>
          </div>
        ) : (
          <Table aria-label="Academic periods">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold">Period</TableHead>
                <TableHead className="font-semibold">Date range</TableHead>
                <TableHead className="text-end font-semibold">Working days</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="text-end font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => {
                const status = period.status.toLowerCase();
                const isActive = status === 'active';
                const isArchived = status === 'archived';
                const days = workingDays(period.startDate, period.endDate);
                const Icon = isActive ? CalendarDays : isArchived ? Archive : CalendarClock;
                const iconCls = isActive
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : isArchived
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400';
                return (
                  <TableRow key={period.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconCls)}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{period.name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{period.code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(period.startDate)} – {formatDate(period.endDate)}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums text-foreground">
                      {days !== null ? days.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          STATUS_PILL[status] ?? 'bg-zinc-100 text-zinc-600',
                        )}
                      >
                        {titleCase(period.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <Link
                            href={`/academic-periods/${period.id}/bell-schedules`}
                            aria-label={`Bell schedules for ${period.name}`}
                          >
                            <Bell className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 p-0"
                          onClick={() => setDialogState({ open: true, initial: period })}
                          disabled={isPending}
                          aria-label={`Edit ${period.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(period)}
                          disabled={isPending || isActive}
                          aria-label={`Delete ${period.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AcademicPeriodFormDialog
        open={dialogState.open}
        onOpenChange={(open) =>
          setDialogState((prev) => ({ open, initial: open ? prev.initial : undefined }))
        }
        initialValue={dialogState.initial}
      />
    </Card>
  );
}
