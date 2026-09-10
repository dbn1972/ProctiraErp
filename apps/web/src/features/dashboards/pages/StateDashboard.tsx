/**
 * StateDashboard — state-scoped overview for state administrators.
 *
 * Implements Task 52.2 / Requirement 40.2 / Design §G.2. Renders the
 * state KPI grid, the district performance ranking (horizontal bar
 * chart), the board breakdown radar (cross-board comparison), and the
 * district drill-down table.
 *
 * Data flow: the page consumes `useStateDashboardData(stateCode)` which
 * today returns a deterministic mock; task 60.3 swaps that hook to call
 * `/api/v1/dashboard/metrics?level=state&area_id=...` +
 * `/api/v1/dashboard/drilldown?parent_area_id=...`. Page rendering does
 * not change.
 */

import {
  Briefcase,
  Calendar,
  ChevronRight,
  Home,
  Scale,
  School,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useSeriesColor,
} from '@proctira/ui-components';
import {
  DashboardSection,
  DataTableCard,
  KpiCard,
  RadarComparison,
  type DataTableCardColumn,
  type KpiCardProps,
  type KpiTrendDirection,
} from '@proctira/ui-dashboards';

import { useStateDashboardData } from '../api';
import type { BoardRow, DashboardKpi, DistrictRanking, DistrictRow } from '../api';

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

function buildDistrictColumns(): ReadonlyArray<DataTableCardColumn<DistrictRow>> {
  return [
    { id: 'name', header: 'District', cell: (row) => row.name },
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
      id: 'board-mix',
      header: 'Board Mix',
      cell: (row) => (
        <div
          className="flex h-2 w-24 overflow-hidden rounded"
          aria-label={`Board mix: CBSE ${row.boardMix.cbse}%, State ${row.boardMix.state}%, ICSE ${row.boardMix.icse}%`}
        >
          <span
            className="h-full bg-[hsl(var(--chart-1))]"
            style={{ width: `${row.boardMix.cbse}%` }}
          />
          <span
            className="h-full bg-[hsl(var(--chart-2))]"
            style={{ width: `${row.boardMix.state}%` }}
          />
          <span
            className="h-full bg-[hsl(var(--chart-3))]"
            style={{ width: `${row.boardMix.icse}%` }}
          />
        </div>
      ),
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
/* District ranking chart                                              */
/* ------------------------------------------------------------------ */

interface DistrictRankingCardProps {
  ranking: ReadonlyArray<DistrictRanking>;
  loading: boolean;
}

function DistrictRankingCard({ ranking, loading }: DistrictRankingCardProps) {
  const color = useSeriesColor(1);
  return (
    <Card data-testid="district-ranking-card">
      <CardHeader>
        <CardTitle>District Performance</CardTitle>
        <CardDescription>Pass rate ranking, top to bottom</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton
            className="h-[300px] w-full rounded-md"
            data-testid="district-ranking-skeleton"
          />
        ) : (
          <div style={{ height: 300 }} data-testid="district-ranking-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...ranking]} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis dataKey="district" type="category" width={100} />
                <Tooltip />
                <Bar dataKey="passRate" name="Pass Rate %" fill={color} isAnimationActive={false} />
              </BarChart>
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

export default function StateDashboard() {
  const navigate = useNavigate();
  const params = useParams<{ stateCode?: string }>();
  const { data, isLoading } = useStateDashboardData(params.stateCode);

  const kpis = data?.kpis ?? [];
  const boards = data?.boards ?? [];
  const districts = data?.districts ?? [];
  const ranking = data?.districtRanking ?? [];
  const radar = data?.boardRadar ?? { axes: [], series: [] };
  const stateName = data?.stateName ?? params.stateCode ?? 'State';
  const stateCode = data?.stateCode ?? params.stateCode ?? 'state';

  const handleDistrictClick = (district: DistrictRow) =>
    navigate(`/app/dashboard/state/${stateCode}/district/${district.id}`);

  return (
    <div className="space-y-6 p-6" data-testid="state-dashboard">
      <header className="space-y-1">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"
        >
          <button
            type="button"
            onClick={() => navigate('/app/dashboard/country')}
            className="inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))]"
            data-testid="state-breadcrumb-country"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Country
          </button>
          <span aria-hidden="true">/</span>
          <span className="text-[hsl(var(--foreground))]">{stateName}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
          {stateName} Dashboard
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          State-scoped KPIs, district performance, and board breakdown.
        </p>
      </header>

      <DashboardSection
        title="State KPIs"
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
            data-testid={`state-kpi-${kpi.id}`}
          />
        ))}
      </DashboardSection>

      <DataTableCard
        title="Board Breakdown"
        description="Performance by board within the state"
        columns={BOARD_COLUMNS}
        rows={boards}
        rowKey={(row) => row.id}
        loading={isLoading}
        data-testid="state-board-table"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DistrictRankingCard ranking={ranking} loading={isLoading} />
        <RadarComparison
          title="Board Comparison"
          description="Normalized scores across enrollment, attendance, pass rate, PTR, and GPI"
          axes={radar.axes}
          series={radar.series}
          max={100}
          loading={isLoading}
          data-testid="state-board-radar"
        />
      </div>

      <DataTableCard
        title="Districts"
        description="Click a row to drill down into a district"
        columns={buildDistrictColumns()}
        rows={districts}
        rowKey={(row) => row.id}
        onRowClick={handleDistrictClick}
        loading={isLoading}
        data-testid="state-district-table"
      />
    </div>
  );
}
