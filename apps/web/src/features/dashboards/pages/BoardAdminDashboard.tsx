/**
 * BoardAdminDashboard — board-level overview for board administrators.
 *
 * Implements Task 52.2 / Requirement 40.3 / Design §G.3. Renders the
 * board KPI grid (schools, students, teachers, board exam pass rate,
 * average attendance, affiliations expiring), the regional breakdown
 * (North/South/East/West/Central), affiliation status badges
 * (active / provisional / expiring), the 5-year enrollment growth
 * widget, and the action items list.
 *
 * Data flow: the page consumes `useBoardAdminDashboardData(boardCode)`
 * which today returns a deterministic mock; task 60.3 swaps that hook
 * to call `/api/v1/boards/:id/consolidation` +
 * `/api/v1/affiliations?status=...` +
 * `/api/v1/analytics/transfers?scope=board`. Page rendering does not
 * change.
 */

import {
  AlertTriangle,
  Briefcase,
  Calendar,
  School,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useSeriesColor,
} from '@proctira/ui-components';
import {
  ActionItemList,
  DashboardSection,
  DataTableCard,
  KpiCard,
  type ActionItem,
  type DataTableCardColumn,
  type KpiCardProps,
  type KpiTrendDirection,
} from '@proctira/ui-dashboards';

import { useBoardAdminDashboardData } from '../api';
import type {
  AffiliationCount,
  AffiliationStatus,
  BoardActionItem,
  DashboardKpi,
  EnrollmentGrowthPoint,
  RegionRow,
} from '../api';

const ICONS: Record<string, KpiCardProps['icon']> = {
  schools: <School className="h-5 w-5" aria-hidden="true" />,
  students: <Users className="h-5 w-5" aria-hidden="true" />,
  teachers: <Briefcase className="h-5 w-5" aria-hidden="true" />,
  attendance: <Calendar className="h-5 w-5" aria-hidden="true" />,
  'pass-rate': <TrendingUp className="h-5 w-5" aria-hidden="true" />,
  expiring: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
};

function kpiTrend(kpi: DashboardKpi) {
  if (!kpi.delta || !kpi.direction) return undefined;
  const direction: KpiTrendDirection = kpi.direction;
  return { direction, label: kpi.delta };
}

const REGION_COLUMNS: ReadonlyArray<DataTableCardColumn<RegionRow>> = [
  { id: 'name', header: 'Region', cell: (row) => row.name },
  {
    id: 'states',
    header: 'States',
    cell: (row) => (
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {row.states}
      </span>
    ),
  },
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
    id: 'class-x-pass',
    header: 'Class X Pass%',
    cell: (row) => row.classXPass,
    headerClassName: 'text-end',
    className: 'text-end',
  },
  {
    id: 'class-xii-pass',
    header: 'Class XII Pass%',
    cell: (row) => row.classXIIPass,
    headerClassName: 'text-end',
    className: 'text-end',
  },
];

/* ------------------------------------------------------------------ */
/* Affiliation status badges                                           */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<AffiliationStatus, string> = {
  active: 'Active',
  provisional: 'Provisional',
  expiring: 'Expiring',
};

function statusVariant(
  status: AffiliationStatus,
): 'default' | 'secondary' | 'warning' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default';
    case 'provisional':
      return 'warning';
    case 'expiring':
      return 'destructive';
    default:
      return 'secondary';
  }
}

interface AffiliationStatusCardProps {
  affiliations: ReadonlyArray<AffiliationCount>;
  loading: boolean;
}

function AffiliationStatusCard({
  affiliations,
  loading,
}: AffiliationStatusCardProps) {
  const total = affiliations.reduce((sum, a) => sum + a.count, 0);
  return (
    <Card data-testid="affiliation-status-card">
      <CardHeader>
        <CardTitle>Affiliation Status</CardTitle>
        <CardDescription>
          Distribution of affiliated schools by current status
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" data-testid="affiliation-status-skeleton">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : (
          <ul className="space-y-3" data-testid="affiliation-status-list">
            {affiliations.map((row) => {
              const pct = total > 0 ? ((row.count / total) * 100).toFixed(1) : '0.0';
              return (
                <li
                  key={row.status}
                  className="flex items-center justify-between gap-3"
                  data-testid={`affiliation-row-${row.status}`}
                >
                  <Badge variant={statusVariant(row.status)}>
                    {STATUS_LABELS[row.status]}
                  </Badge>
                  <span className="text-sm text-[hsl(var(--foreground))]">
                    {row.count.toLocaleString()}{' '}
                    <span className="text-[hsl(var(--muted-foreground))]">
                      ({pct}%)
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Enrollment growth widget                                            */
/* ------------------------------------------------------------------ */

interface EnrollmentGrowthCardProps {
  data: ReadonlyArray<EnrollmentGrowthPoint>;
  loading: boolean;
}

function EnrollmentGrowthCard({ data, loading }: EnrollmentGrowthCardProps) {
  const color = useSeriesColor(0);
  return (
    <Card data-testid="enrollment-growth-card">
      <CardHeader>
        <CardTitle>Enrollment Growth</CardTitle>
        <CardDescription>Students (millions), last 5 years</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton
            className="h-[280px] w-full rounded-md"
            data-testid="enrollment-growth-skeleton"
          />
        ) : (
          <div style={{ height: 280 }} data-testid="enrollment-growth-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...data]}>
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
                <Line
                  type="monotone"
                  dataKey="students"
                  name="Students (M)"
                  stroke={color}
                  strokeWidth={3}
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

function toActionItems(items: ReadonlyArray<BoardActionItem>): ActionItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    priority: item.priority,
    dueLabel: item.dueLabel,
  }));
}

export default function BoardAdminDashboard() {
  const { data, isLoading } = useBoardAdminDashboardData();

  const kpis = data?.kpis ?? [];
  const regions = data?.regions ?? [];
  const affiliations = data?.affiliations ?? [];
  const enrollmentGrowth = data?.enrollmentGrowth ?? [];
  const actionItems = data?.actionItems ?? [];
  const boardName = data?.boardName ?? 'Board Administration';

  return (
    <div className="space-y-6 p-6" data-testid="board-admin-dashboard">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {boardName}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Affiliated schools, students, teachers, and pending action items.
          </p>
        </div>
      </header>

      <DashboardSection
        title="Board KPIs"
        description="Schools, students, teachers, exam pass rate, attendance, and affiliations"
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
            data-testid={`board-kpi-${kpi.id}`}
          />
        ))}
      </DashboardSection>

      <DataTableCard
        title="Regional Breakdown"
        description="Affiliated schools by region (North, South, East, West)"
        columns={REGION_COLUMNS}
        rows={regions}
        rowKey={(row) => row.id}
        loading={isLoading}
        data-testid="board-region-table"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EnrollmentGrowthCard data={enrollmentGrowth} loading={isLoading} />
        <AffiliationStatusCard
          affiliations={affiliations}
          loading={isLoading}
        />
      </div>

      <ActionItemList
        title="Pending Action Items"
        description="Items needing attention from board administrators"
        items={toActionItems(actionItems)}
        loading={isLoading}
        data-testid="board-action-items"
      />
    </div>
  );
}
