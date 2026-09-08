/**
 * TeacherDashboard — teacher default dashboard surface
 * (Task 52.4 / Requirement 40.7 / Design §G.7).
 *
 * Surfaces the teacher overview at `/app/dashboard/teacher` with:
 *   - Assigned classes summary
 *   - Today's schedule via `<TimelineSchedule>`
 *   - Attendance still pending entry (with deep links into the
 *     attendance marking flow)
 *   - Pending assessment tasks via `<TaskChecklist>`
 *
 * Real data wiring lands in Task 60.3 — the page consumes
 * `useTeacherDashboard()` (mock today, `useQuery` then) so the swap is
 * mechanical.
 */

import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react';

import {
  Badge,
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
  TimelineSchedule,
  type ChecklistTask,
} from '@proctira/ui-dashboards';

import { useTeacherDashboard } from '../api';

const NUMBER_FORMAT = new Intl.NumberFormat();

export default function TeacherDashboard() {
  const { data, isLoading, error } = useTeacherDashboard();

  const totalClasses = data?.assignedClasses.length ?? 0;
  const totalStudents = (data?.assignedClasses ?? []).reduce((sum, c) => sum + c.studentCount, 0);
  const pendingAttendanceCount = data?.attendancePending.length ?? 0;

  const tasks: ReadonlyArray<ChecklistTask> = (data?.pendingAssessments ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.className,
    meta: t.due ? `Due ${t.due}` : undefined,
    completed: t.completed,
  }));

  return (
    <div className="space-y-6 p-6" data-testid="teacher-dashboard">
      <header>
        <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Teacher Dashboard</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Today&apos;s classes, attendance, and pending assessment work.
        </p>
      </header>

      {/* KPI strip */}
      <DashboardSection title="At a glance">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KpiCard
            label="Assigned classes"
            value={NUMBER_FORMAT.format(totalClasses)}
            icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
            description={`${NUMBER_FORMAT.format(totalStudents)} students total`}
            loading={isLoading}
            error={error}
            data-testid="kpi-assigned-classes"
          />
          <KpiCard
            label="Attendance pending"
            value={NUMBER_FORMAT.format(pendingAttendanceCount)}
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            description="Classes still to mark today"
            loading={isLoading}
            error={error}
            data-testid="kpi-attendance-pending"
          />
          <KpiCard
            label="Pending assessment tasks"
            value={NUMBER_FORMAT.format(data?.pendingAssessments.length ?? 0)}
            icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
            description="Items awaiting submission"
            loading={isLoading}
            error={error}
            data-testid="kpi-pending-assessments"
          />
        </div>
      </DashboardSection>

      {/* Today's schedule */}
      <DashboardSection title="Today's schedule" description="Your classes for the day, in order">
        <Card>
          <CardContent className="p-6">
            <TimelineSchedule
              items={data?.todaySchedule ?? []}
              loading={isLoading}
              error={error}
              data-testid="today-schedule"
            />
          </CardContent>
        </Card>
      </DashboardSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Attendance pending entry */}
        <DashboardSection
          title="Attendance — pending entry"
          description="Classes you still need to mark today"
          loading={isLoading}
        >
          {data && (
            <Card data-testid="attendance-pending">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Mark attendance</CardTitle>
                <CardDescription>Tap a class to open the attendance marking flow</CardDescription>
              </CardHeader>
              <CardContent>
                {data.attendancePending.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    All attendance entered for today.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.attendancePending.map((cls) => (
                      <li key={cls.classId} data-testid="attendance-pending-item">
                        <Button
                          asChild
                          variant="outline"
                          className="h-auto w-full justify-between py-3"
                        >
                          <Link to={`/app/attendance/today?class=${cls.classId}`}>
                            <span className="flex items-center gap-3 text-start">
                              <CalendarCheck
                                className="h-4 w-4 text-[hsl(var(--muted-foreground))]"
                                aria-hidden="true"
                              />
                              <span className="space-y-0.5">
                                <span className="block text-sm font-medium">{cls.className}</span>
                                <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                                  Scheduled at {cls.scheduledAt}
                                </span>
                              </span>
                            </span>
                            <Badge variant="warning">Pending</Badge>
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </DashboardSection>

        {/* Pending assessment tasks */}
        <DashboardSection title="Pending assessment tasks">
          <TaskChecklist
            title="Assessments"
            description="Mark complete as you submit each item"
            tasks={tasks}
            loading={isLoading}
            error={error}
            data-testid="pending-assessments"
          />
        </DashboardSection>
      </div>
    </div>
  );
}
