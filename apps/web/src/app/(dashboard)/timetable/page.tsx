/**
 * Timetable operations desk — periods, slots, substitutions.
 * Slot writes reject staff/class/room clashes (HTTP 409).
 */
import Link from 'next/link';
import { CalendarClock, Layers, RefreshCw, Users } from 'lucide-react';

import {
  listBellPeriods,
  listSubstitutions,
  listTimetableSlots,
} from '@/lib/api/timetable';
import {
  Card,
  CardContent,
  CardDescription,
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

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  cancelled: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400',
};

function shortId(id: string) {
  return id.slice(0, 8);
}

function dayLabel(dayOfWeek: number) {
  return DAY_LABELS[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status] ?? STATUS_STYLES.active,
      )}
    >
      {status}
    </span>
  );
}

export default async function TimetablePage() {
  const [periods, slots, substitutions] = await Promise.all([
    listBellPeriods(),
    listTimetableSlots(),
    listSubstitutions(),
  ]);

  const periodById = new Map(periods.map((p) => [p.id, p]));
  const activeSlots = slots.filter((s) => s.status === 'active').length;

  return (
    <section className="space-y-8" aria-labelledby="timetable-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="timetable-heading" className="text-3xl font-extrabold tracking-tight">
            Timetable
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bell periods → slots → substitutions — clash protection on staff, class, and room
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border px-2 py-1">POST /timetables/slots</span>
          <span className="rounded-md border border-border px-2 py-1">
            POST /timetables/substitutions
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bell periods</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{periods.length}</div>
            <p className="text-xs text-muted-foreground">Daily period catalogue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Slots</CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{slots.length}</div>
            <p className="text-xs text-muted-foreground">Class / staff assignments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active slots</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSlots}</div>
            <p className="text-xs text-muted-foreground">Currently scheduled</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Substitutions</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{substitutions.length}</div>
            <p className="text-xs text-muted-foreground">Cover records</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bell periods</CardTitle>
            <CardDescription>Ordered daily periods with start and end times</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No bell periods yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  [...periods]
                    .sort((a, b) => a.periodOrder - b.periodOrder)
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.periodOrder}</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="font-mono text-xs">{p.startTime}</TableCell>
                        <TableCell className="font-mono text-xs">{p.endTime}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Substitutions</CardTitle>
            <CardDescription>Temporary staff cover for a slot and date</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Original</TableHead>
                  <TableHead>Substitute</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {substitutions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No substitutions recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  substitutions.slice(0, 20).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.date}</TableCell>
                      <TableCell className="font-mono text-xs">{shortId(s.slotId)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(s.originalStaffId)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(s.substituteStaffId)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timetable slots</CardTitle>
          <CardDescription>
            Day, period, class, and staff — conflicting writes return HTTP 409
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No slots yet. Create periods, then assign slots.
                  </TableCell>
                </TableRow>
              ) : (
                slots.slice(0, 30).map((slot) => {
                  const period = periodById.get(slot.bellPeriodId);
                  return (
                    <TableRow key={slot.id}>
                      <TableCell>{dayLabel(slot.dayOfWeek)}</TableCell>
                      <TableCell>
                        {period
                          ? `${period.periodOrder}. ${period.name}`
                          : shortId(slot.bellPeriodId)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{shortId(slot.classId)}</TableCell>
                      <TableCell className="font-mono text-xs">{shortId(slot.staffId)}</TableCell>
                      <TableCell>
                        <StatusPill status={slot.status} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Related:{' '}
        <Link className="underline underline-offset-2" href="/finance">
          Finance
        </Link>{' '}
        ·{' '}
        <Link className="underline underline-offset-2" href="/payroll">
          Payroll
        </Link>
      </p>
    </section>
  );
}
