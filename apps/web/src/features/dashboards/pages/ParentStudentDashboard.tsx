/**
 * ParentStudentDashboard — personal-scope default dashboard surface
 * (Task 52.4 / Requirement 40.8 / Design §G.8).
 *
 * Surfaces the parent / student "me" view at `/app/dashboard/me`. The
 * `RoleRouter` (Task 52.1) routes `parent` and `student` roles here,
 * and unauthenticated / un-mapped users also fall back to this page so
 * the route always renders something safe.
 *
 * Layout:
 *   - Attendance summary KPI grid (rate %, absent days, late days).
 *   - Recent assessment results table via `<DataTableCard>`.
 *   - Today's schedule via `<TimelineSchedule>`.
 *   - Notifications list (messages from school).
 *
 * Real data wiring lands in Task 60.3 — the page consumes
 * `useParentStudentDashboard()` (mock today, `useQuery` then) so the
 * swap is mechanical.
 */

import { Bell, CalendarCheck, ClockAlert, UserX } from 'lucide-react';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui-components';
import {
  DashboardSection,
  DataTableCard,
  KpiCard,
  TimelineSchedule,
  type DataTableCardColumn,
} from '@proctira/ui-dashboards';

import { useParentStudentDashboard, type ParentAssessmentResult } from '../api';

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

const RESULT_COLUMNS: ReadonlyArray<DataTableCardColumn<ParentAssessmentResult>> = [
  {
    id: 'subject',
    header: 'Subject',
    cell: (row) => <span className="font-medium text-[hsl(var(--foreground))]">{row.subject}</span>,
  },
  {
    id: 'score',
    header: 'Score',
    headerClassName: 'text-end',
    className: 'text-end font-semibold',
    cell: (row) => `${row.score}%`,
  },
  {
    id: 'grade',
    header: 'Grade',
    headerClassName: 'text-end',
    className: 'text-end',
    cell: (row) => <Badge variant="secondary">{row.grade}</Badge>,
  },
  {
    id: 'date',
    header: 'Date',
    headerClassName: 'text-end',
    className: 'text-end text-[hsl(var(--muted-foreground))]',
    cell: (row) => row.date,
  },
];

export default function ParentStudentDashboard() {
  const { data, isLoading, error } = useParentStudentDashboard();

  const attendance = data?.attendance;

  return (
    <div className="space-y-6 p-6" data-testid="parent-student-dashboard">
      <header>
        <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">My Dashboard</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {data
            ? `${data.studentName} — ${data.gradeLabel}`
            : 'Personal attendance summary, recent results, schedule, and notifications.'}
        </p>
      </header>

      {/* Attendance summary KPIs */}
      <DashboardSection title="Attendance summary" description="Current term overview">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Attendance rate"
            value={attendance ? formatPercent(attendance.ratePercent) : '—'}
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            description="Attendance for the current term"
            loading={isLoading}
            error={error}
            data-testid="kpi-attendance-rate"
          />
          <KpiCard
            label="Days present"
            value={attendance ? NUMBER_FORMAT.format(attendance.daysPresent) : '—'}
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            loading={isLoading}
            error={error}
            data-testid="kpi-days-present"
          />
          <KpiCard
            label="Days absent"
            value={attendance ? NUMBER_FORMAT.format(attendance.daysAbsent) : '—'}
            icon={<UserX className="h-5 w-5" aria-hidden="true" />}
            loading={isLoading}
            error={error}
            data-testid="kpi-days-absent"
          />
          <KpiCard
            label="Days late"
            value={attendance ? NUMBER_FORMAT.format(attendance.daysLate) : '—'}
            icon={<ClockAlert className="h-5 w-5" aria-hidden="true" />}
            loading={isLoading}
            error={error}
            data-testid="kpi-days-late"
          />
        </div>
      </DashboardSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent results */}
        <DashboardSection title="Recent results">
          <DataTableCard
            title="Recent assessments"
            description="Latest scores from the current term"
            columns={RESULT_COLUMNS}
            rows={data?.recentResults ?? []}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={error}
            emptyMessage="No assessment results yet."
            data-testid="recent-results"
          />
        </DashboardSection>

        {/* Schedule */}
        <DashboardSection title="Today's schedule">
          <Card>
            <CardContent className="p-6">
              <TimelineSchedule
                items={data?.schedule ?? []}
                loading={isLoading}
                error={error}
                data-testid="today-schedule"
              />
            </CardContent>
          </Card>
        </DashboardSection>
      </div>

      {/* Notifications */}
      <DashboardSection
        title="Notifications"
        description="Messages from the school"
        loading={isLoading}
      >
        {data && (
          <Card data-testid="notifications">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                Latest messages
              </CardTitle>
              <CardDescription>Unread items appear at the top</CardDescription>
            </CardHeader>
            <CardContent>
              {data.notifications.length === 0 ? (
                <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  No new messages.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.notifications.map((n) => (
                    <li
                      key={n.id}
                      className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] p-3"
                      data-testid="notification-item"
                      data-unread={n.unread ? 'true' : 'false'}
                    >
                      <div className="flex-1 space-y-0.5">
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                          {n.sender}
                        </p>
                        <p className="text-sm text-[hsl(var(--foreground))]">{n.subject}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {n.receivedAt}
                        </p>
                      </div>
                      {n.unread ? <Badge variant="default">New</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </DashboardSection>
    </div>
  );
}
