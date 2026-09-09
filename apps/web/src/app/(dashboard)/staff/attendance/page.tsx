/**
 * Daily staff attendance + monthly summary (G-918).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listStaff, listStaffAttendance, listStaffAttendanceSummary } from '@/lib/api/staff';

import { StaffAttendanceGrid } from '../_components/staff-attendance-grid';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readStr(params: Awaited<PageProps['searchParams']>, key: string, fallback = ''): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

export default async function StaffAttendancePage(props: PageProps) {
  await requireSession();
  const searchParams = await props.searchParams;
  const date = readStr(searchParams, 'date', todayIso()) || todayIso();
  const month = readStr(searchParams, 'month', monthOf(date)) || monthOf(date);

  const [staff, marks, summary] = await Promise.all([
    listStaff({ pageSize: 100 }),
    listStaffAttendance({ date }),
    listStaffAttendanceSummary(month),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Staff attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily present / absent / leave / half-day marks and a monthly summary.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">Back to staff</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mark {date}</CardTitle>
          <CardDescription>Choose a date then save marks for the staff directory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-sm" htmlFor="att-date">
              Date
              <input
                id="att-date"
                name="date"
                type="date"
                defaultValue={date}
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <Button type="submit" variant="outline" size="sm">
              Load date
            </Button>
          </form>
          <StaffAttendanceGrid date={date} staff={staff.data} marks={marks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly summary ({month})</CardTitle>
          <CardDescription>Payable days = present + half-day × 0.5.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No marks this month.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {summary.map((row) => (
                <li key={row.staffId} className="py-2 text-sm" data-testid="staff-attendance-summary-row">
                  Staff {row.staffId.slice(0, 8)}… · present {row.present} · leave {row.leave} ·
                  half-day {row.halfDay} · payable {row.payableDays}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
