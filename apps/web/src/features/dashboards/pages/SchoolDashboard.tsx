/**
 * SchoolDashboard — School / Principal default dashboard surface
 * (Task 52.4 / Requirement 40.6 / Design §G.6).
 *
 * Surfaces the school-scoped overview that lands on
 * `/app/dashboard/school` after `RoleRouter` matches a `principal` role
 * or a `school` scope (Task 52.1).
 *
 * Layout:
 *   - Sticky header strip with the persistent `<ConnectivityIndicator>`
 *     and the page title. The indicator stays in view per Requirement
 *     38.1 even when the page scrolls.
 *   - KPI grid (enrollment, today's attendance %, staff utilization,
 *     pending approvals) using `<KpiCard>` from `@proctira/ui-dashboards`.
 *   - Quick-action shortcuts ("Mark Attendance" → `/app/attendance/today`,
 *     "Add Student" → `/app/students/new`).
 *   - Recent activity feed via `<DashboardSection>`.
 *   - Pending tasks via `<TaskChecklist>`.
 *
 * Real data wiring lands in Task 60.3 — the page consumes
 * `useSchoolDashboard()` (mock today, `useQuery` then) so the swap is
 * mechanical.
 */

import { Link } from 'react-router-dom';
import {
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  UserPlus,
  Users,
  UsersRound,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui-components';
import {
  DashboardSection,
  KpiCard,
  TaskChecklist,
  type ChecklistTask,
} from '@proctira/ui-dashboards';

import ConnectivityIndicator from '@/components/connectivity/ConnectivityIndicator';

import { useSchoolDashboard } from '../api';

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function staffUtilization(staffOnDuty: number, totalStaff: number): number {
  if (totalStaff <= 0) return 0;
  return (staffOnDuty / totalStaff) * 100;
}

export default function SchoolDashboard() {
  const { data, isLoading, error } = useSchoolDashboard();

  const kpis = data?.kpis;
  const utilization = kpis ? staffUtilization(kpis.staffOnDuty, kpis.totalStaff) : 0;

  // Map the API tasks into the `<TaskChecklist>` payload. Toggling is a
  // visual no-op for now (real persistence lands in 60.3); we still
  // pass the handler so the checkboxes are interactive.
  const tasks: ReadonlyArray<ChecklistTask> = (data?.pendingTasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    meta: t.due ? `Due ${t.due}` : undefined,
    completed: t.completed,
  }));

  return (
    <div className="space-y-6 p-6" data-testid="school-dashboard">
      {/* Sticky header — keeps the connectivity indicator and title
          visible while the page scrolls (Req 38.1). */}
      <header
        className="sticky top-0 z-10 -mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 px-6 py-4 backdrop-blur"
        data-testid="school-dashboard-header"
      >
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">School Dashboard</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Principal view — today&apos;s overview for your institution.
          </p>
        </div>
        <div data-testid="school-dashboard-connectivity">
          <ConnectivityIndicator />
        </div>
      </header>

      {/* KPI grid */}
      <DashboardSection title="At a glance" description="Live KPIs for your institution">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total enrollment"
            value={kpis ? NUMBER_FORMAT.format(kpis.totalStudents) : '—'}
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            description="Students currently enrolled"
            loading={isLoading}
            error={error}
            data-testid="kpi-total-students"
          />
          <KpiCard
            label="Today's attendance"
            value={kpis ? formatPercent(kpis.attendanceRate) : '—'}
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            description="Students marked present"
            loading={isLoading}
            error={error}
            data-testid="kpi-attendance"
          />
          <KpiCard
            label="Staff utilization"
            value={kpis ? formatPercent(utilization) : '—'}
            icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}
            description={
              kpis ? `${kpis.staffOnDuty} of ${kpis.totalStaff} staff on duty` : undefined
            }
            loading={isLoading}
            error={error}
            data-testid="kpi-staff-utilization"
          />
          <KpiCard
            label="Pending approvals"
            value={kpis ? NUMBER_FORMAT.format(kpis.pendingApprovals) : '—'}
            icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
            description="Tasks awaiting your review"
            loading={isLoading}
            error={error}
            data-testid="kpi-pending-approvals"
          />
        </div>
      </DashboardSection>

      {/* Quick actions */}
      <DashboardSection title="Quick actions" description="Shortcuts to the workflows you use most">
        <div className="flex flex-wrap gap-3">
          <Button asChild data-testid="action-mark-attendance">
            <Link to="/app/attendance/today">
              <CalendarCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              Mark attendance
            </Link>
          </Button>
          <Button asChild variant="outline" data-testid="action-add-student">
            <Link to="/app/students/new">
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add student
            </Link>
          </Button>
          <Button asChild variant="ghost" data-testid="action-class-roster">
            <Link to="/app/students">
              <GraduationCap className="mr-2 h-4 w-4" aria-hidden="true" />
              View class roster
            </Link>
          </Button>
        </div>
      </DashboardSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <DashboardSection
          title="Recent activity"
          description="Latest changes across the institution"
          loading={isLoading}
        >
          {data && (
            <Card data-testid="recent-activity">
              <CardHeader className="space-y-0 pb-2">
                <CardTitle className="text-base">Latest events</CardTitle>
                <CardDescription>Newest updates appear first</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {data.recentActivity.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    No recent activity yet today.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {data.recentActivity.map((item) => (
                      <li
                        key={item.id}
                        className="border-l-2 border-[hsl(var(--primary))] ps-3"
                        data-testid="recent-activity-item"
                      >
                        <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                          {item.title}
                        </p>
                        {item.description ? (
                          <p className="text-sm text-[hsl(var(--muted-foreground))]">
                            {item.description}
                          </p>
                        ) : null}
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {item.occurredAt}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </DashboardSection>

        {/* Pending tasks */}
        <DashboardSection title="Pending tasks">
          <TaskChecklist
            title="Action items"
            description="Items awaiting your review or approval"
            tasks={tasks}
            loading={isLoading}
            error={error}
            data-testid="pending-tasks"
          />
        </DashboardSection>
      </div>
    </div>
  );
}
