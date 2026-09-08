/**
 * CountryDashboard — national/country-level overview for ministry users.
 *
 * Implements Task 52.2 / Requirement 40.1 / Design §G.1. Renders the
 * national KPI grid (schools, students, teachers, attendance %, pass %,
 * GPI), the 5-year multi-line enrollment trend, the board-wise summary
 * table, and the state drill-down table that links to the State
 * Dashboard.
 *
 * Data flow: the page consumes `useCountryDashboardData()` which today
 * returns a deterministic mock; task 60.3 swaps that hook to call the
 * real `/api/v1/dashboard/metrics?level=country` +
 * `/api/v1/dashboard/drilldown?parent_area_id=null` +
 * `/api/v1/dashboard/board-comparison` endpoints. Page rendering does
 * not change.
 *
 * Widgets: every visible surface comes from `@proctira/ui-dashboards` so
 * the dashboard tracks Design §G's reusable widget table:
 *   - <DashboardSection> for grouping
 *   - <KpiCard> for each KPI tile
 *   - <DataTableCard> for the board-wise summary and the state
 *     drill-down (the latter wires `onRowClick` to navigate to
 *     `/app/dashboard/state/:stateCode`)
 *   - Recharts `<LineChart>` (themed via `useSeriesColor`) for the
 *     enrollment trend, wrapped in a <Card> from ui-components
 */

import { Briefcase, Calendar, ChevronRight, Scale, School, TrendingUp, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useSeriesColors,
} from '@proctira/ui-components';
import {
  DashboardSection,
  DataTableCard,
  KpiCard,
  type DataTableCardColumn,
  type KpiCardProps,
  type KpiTrendDirection,
} from '@proctira/ui-dashboards';

import { useCountryDashboardData } from '../api';
import type { BoardRow, DashboardKpi, EnrollmentTrendPoint, StateRow } from '../api';

const ICONS: Record<string, KpiCardProps['icon']> = {
  schools: <School className="h-5 w-5" aria-hidden="true" />,
  students: <Users className="h-5 w-5" aria-hidden="true" />,
  teachers: <Briefcase className="h-5 w-5" aria-hidden="true" />,
  attendance: <Calendar className="h-5 w-5" aria-hidden="true" />,
  'pass-rate': <TrendingUp className="h-5 w-5" aria-hidden="true" />,
  gpi: <Scale className="h-5 w-5" aria-hidden="true" />,
};

function kpiTrend(kpi: DashboardKpi) {
  if (!kpi.delta || !kpi.direction) return undefined;
  const direction: KpiTrendDirection = kpi.direction;
  return { direction, label: kpi.delta };
}

/* ------------------------------------------------------------------ */
/* Board-wise summary columns                                          */
/* ------------------------------------------------------------------ */

const BOARD_COLUMNS: ReadonlyArray<DataTableCardColumn<BoardRow>> = [
  { id: 'name', header: 'Board', cell: (row) => row.name },
  {
    id: 'schools',
    header: 'Schools',
    cell: (row) => row.schools,
    headerClassName: 'text-end',
    className: 'text-end',
  },
  {
    id: 'students',
    header: 'Students',
    cell: (row) => row.students,
    headerClassName: 'text-end',
    className: 'text-end',
  },
  {
    id: 'attendance',
    header: 'Attendance',
    cell: (row) => row.attendance,
    headerClassName: 'text-end',
    className: 'text-end',
  },
  {
    id: 'pass-rate',
    header: 'Pass Rate',
    cell: (row) => row.passRate,
    headerClassName: 'text-end',
    className: 'text-end',
  },
  {
    id: 'ptr',
    header: 'PTR',
    cell: (row) => row.ptr,
    headerClassName: 'text-end',
    className: 'text-end',
  },
];

/* ------------------------------------------------------------------ */
/* State drill-down columns                                            */
/* ------------------------------------------------------------------ */

function buildStateColumns(): ReadonlyArray<DataTableCardColumn<StateRow>> {
  return [
    { id: 'name', header: 'State', cell: (row) => row.name },
    {
      id: 'schools',
      header: 'Schools',
      cell: (row) => row.schools,
      headerClassName: 'text-end',
      className: 'text-end',
    },
    {
      id: 'students',
      header: 'Students',
      cell: (row) => row.students,
      headerClassName: 'text-end',
      className: 'text-end',
    },
    {
      id: 'attendance',
      header: 'Attendance',
      cell: (row) => row.attendance,
      headerClassName: 'text-end',
      className: 'text-end',
    },
    {
      id: 'pass-rate',
      header: 'Pass Rate',
      cell: (row) => row.passRate,
      headerClassName: 'text-end',
      className: 'text-end',
    },
    {
      id: 'drill',
      header: '',
      cell: () => (
        <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      ),
      headerClassName: 'text-end',
      className: 'text-end',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Enrollment trend chart                                              */
/* ------------------------------------------------------------------ */

interface EnrollmentTrendCardProps {
  trend: ReadonlyArray<EnrollmentTrendPoint>;
  loading: boolean;
}

function EnrollmentTrendCard({ trend, loading }: EnrollmentTrendCardProps) {
  const colors = useSeriesColors();
  return (
    <Card data-testid="enrollment-trend-card">
      <CardHeader>
        <CardTitle>Enrollment Trend</CardTitle>
        <CardDescription>Students (millions) by board, last 5 academic years</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton
            className="h-[300px] w-full rounded-md"
            data-testid="enrollment-trend-skeleton"
          />
        ) : (
          <div style={{ height: 300 }} data-testid="enrollment-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...trend]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis
                  label={{
                    value: 'Students (M)',
                    angle: -90,
                    position: 'insideLeft',
                  }}
                />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="cbse"
                  name="CBSE"
                  stroke={colors[0]}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="state"
                  name="State Boards"
                  stroke={colors[1]}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="icse"
                  name="ICSE"
                  stroke={colors[2]}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ib"
                  name="IB"
                  stroke={colors[3]}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CountryDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useCountryDashboardData();

  const kpis = data?.kpis ?? [];
  const boards = data?.boards ?? [];
  const states = data?.states ?? [];
  const enrollmentTrend = data?.enrollmentTrend ?? [];

  return (
    <div className="space-y-6 p-6" data-testid="country-dashboard">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
          Country Dashboard
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          National-level KPIs across all states and boards. Click a state to drill down.
        </p>
      </header>

      <DashboardSection
        title="National KPIs"
        description="Schools, students, teachers, attendance, pass rate, and gender parity"
        loading={isLoading}
        loadingPlaceholders={2}
        bodyClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            icon={ICONS[kpi.id]}
            trend={kpiTrend(kpi)}
            description={kpi.description}
            data-testid={`country-kpi-${kpi.id}`}
          />
        ))}
      </DashboardSection>

      <DataTableCard
        title="Board-wise Summary"
        description="Performance breakdown across CBSE, State Boards, ICSE, and IB"
        columns={BOARD_COLUMNS}
        rows={boards}
        rowKey={(row) => row.id}
        loading={isLoading}
        data-testid="country-board-table"
      />

      <EnrollmentTrendCard trend={enrollmentTrend} loading={isLoading} />

      <DataTableCard
        title="States"
        description="Click a row to drill down into a state dashboard"
        columns={buildStateColumns()}
        rows={states}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/app/dashboard/state/${row.id}`)}
        loading={isLoading}
        data-testid="country-state-table"
      />
    </div>
  );
}
