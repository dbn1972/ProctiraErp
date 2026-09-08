/**
 * BoardComparisonDashboard — side-by-side comparison of up to 4 boards.
 *
 * Implements Task 52.3 / Requirement 40.4 / Design §G.4. Renders:
 *   - Configurable board selector (max 4) and metric toggles.
 *   - One <KpiCard> grid per selected board summarising its KPIs.
 *   - <RadarComparison> plotting the selected boards across the
 *     selected metrics.
 *   - Multi-year trend <LineChart> for one selected metric across the
 *     selected boards (themed via `useSeriesColors`).
 *   - <DataTableCard> with the detailed board × metric × year rows.
 *
 * Data flow: the page consumes `useBoardComparisonData(boardCodes)`
 * which today returns a deterministic mock; task 60.3 swaps that hook
 * to call `/api/v1/dashboard/board-comparison`. Page rendering does
 * not change.
 */

import { useMemo, useState } from 'react';
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
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useSeriesColors,
} from '@proctira/ui-components';
import {
  DashboardSection,
  DataTableCard,
  KpiCard,
  RadarComparison,
  type DataTableCardColumn,
} from '@proctira/ui-dashboards';

import { useBoardComparisonData } from '../api';
import type {
  BoardComparisonBoard,
  BoardComparisonDetailRow,
  BoardComparisonMetric,
  BoardComparisonMetricId,
} from '../api';

const MAX_SELECTED_BOARDS = 4;
const DEFAULT_BOARDS: ReadonlyArray<string> = ['cbse', 'state', 'icse', 'ib'];
const DEFAULT_METRICS: ReadonlyArray<BoardComparisonMetricId> = [
  'attendance',
  'passRate',
  'ptr',
  'gpi',
];

const DETAIL_COLUMNS: ReadonlyArray<DataTableCardColumn<BoardComparisonDetailRow>> = [
  { id: 'board', header: 'Board', cell: (row) => row.boardName },
  { id: 'metric', header: 'Metric', cell: (row) => row.metricLabel },
  { id: 'year', header: 'Year', cell: (row) => row.year },
  {
    id: 'value',
    header: 'Value',
    cell: (row) => row.value,
    headerClassName: 'text-end',
    className: 'text-end',
  },
];

/* ------------------------------------------------------------------ */
/* Trend chart                                                         */
/* ------------------------------------------------------------------ */

interface TrendChartCardProps {
  title: string;
  description: string;
  metricLabel: string;
  data: ReadonlyArray<Record<string, number | string>>;
  series: ReadonlyArray<{ id: string; name: string }>;
  loading: boolean;
}

function TrendChartCard({
  title,
  description,
  metricLabel,
  data,
  series,
  loading,
}: TrendChartCardProps) {
  const colors = useSeriesColors();
  return (
    <Card data-testid="board-comparison-trend-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton
            className="h-[300px] w-full rounded-md"
            data-testid="board-comparison-trend-skeleton"
          />
        ) : (
          <div style={{ height: 300 }} data-testid="board-comparison-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...data]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis
                  label={{
                    value: metricLabel,
                    angle: -90,
                    position: 'insideLeft',
                  }}
                />
                <Tooltip />
                <Legend />
                {series.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.name}
                    stroke={colors[i % colors.length]}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
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

export default function BoardComparisonDashboard() {
  const { data, isLoading } = useBoardComparisonData();

  const allBoards: ReadonlyArray<BoardComparisonBoard> = data?.boards ?? [];
  const allMetrics: ReadonlyArray<BoardComparisonMetric> = data?.metrics ?? [];

  // Multi-select up to 4 boards. We initialise from `DEFAULT_BOARDS`
  // intersected with the data so the UI stays usable even if the
  // mock/API changes.
  const [selectedBoardIds, setSelectedBoardIds] = useState<ReadonlyArray<string>>(DEFAULT_BOARDS);
  const [selectedMetricIds, setSelectedMetricIds] =
    useState<ReadonlyArray<BoardComparisonMetricId>>(DEFAULT_METRICS);
  const [trendMetricId, setTrendMetricId] = useState<BoardComparisonMetricId>('passRate');

  const toggleBoard = (boardId: string) => {
    setSelectedBoardIds((prev) => {
      if (prev.includes(boardId)) {
        return prev.filter((id) => id !== boardId);
      }
      if (prev.length >= MAX_SELECTED_BOARDS) {
        return prev;
      }
      return [...prev, boardId];
    });
  };

  const toggleMetric = (metricId: BoardComparisonMetricId) => {
    setSelectedMetricIds((prev) =>
      prev.includes(metricId) ? prev.filter((id) => id !== metricId) : [...prev, metricId],
    );
  };

  // Memoise derived collections so the radar / table / chart only
  // re-render when the selection actually changes.
  const selectedBoards = useMemo(
    () => allBoards.filter((b) => selectedBoardIds.includes(b.id)),
    [allBoards, selectedBoardIds],
  );
  const selectedMetrics = useMemo(
    () => allMetrics.filter((m) => selectedMetricIds.includes(m.id)),
    [allMetrics, selectedMetricIds],
  );

  const radarAxes = useMemo(
    () => selectedMetrics.map((m) => ({ id: m.id, label: m.label })),
    [selectedMetrics],
  );
  const radarSeries = useMemo(
    () =>
      selectedBoards.map((b) => {
        const values: Record<string, number> = {};
        for (const metric of selectedMetrics) {
          values[metric.id] = b.radar[metric.id] ?? 0;
        }
        return { id: b.id, label: b.name, values };
      }),
    [selectedBoards, selectedMetrics],
  );

  const trendData = useMemo(() => {
    if (!data) return [];
    return data.trend.map((point) => {
      const row: Record<string, number | string> = { year: point.year };
      for (const board of selectedBoards) {
        row[board.id] = point.values[board.id] ?? 0;
      }
      return row;
    });
  }, [data, selectedBoards]);

  const trendSeries = useMemo(
    () => selectedBoards.map((b) => ({ id: b.id, name: b.name })),
    [selectedBoards],
  );

  const trendMetricLabel = allMetrics.find((m) => m.id === trendMetricId)?.label ?? 'Value';

  // Filter the detail rows to the active selection so the table
  // matches the radar / trend visualisation. When the selection drops
  // a metric, the table hides those rows immediately.
  const detailRows = useMemo(() => {
    if (!data) return [];
    return data.detail.filter(
      (row) => selectedBoardIds.includes(row.boardId) && selectedMetricIds.includes(row.metricId),
    );
  }, [data, selectedBoardIds, selectedMetricIds]);

  return (
    <div className="space-y-6 p-6" data-testid="board-comparison-dashboard">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
          Board Performance Comparison
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Compare up to {MAX_SELECTED_BOARDS} education boards across configurable metrics. Select
          boards and metrics, then review the radar, trend lines, and detailed breakdown below.
        </p>
      </header>

      {/* Selection controls */}
      <Card data-testid="board-comparison-controls">
        <CardHeader>
          <CardTitle>Comparison settings</CardTitle>
          <CardDescription>
            Pick up to {MAX_SELECTED_BOARDS} boards and the metrics to compare.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))]">
              <span>Boards</span>
              <Badge variant="secondary" data-testid="board-comparison-selection-count">
                {selectedBoardIds.length}/{MAX_SELECTED_BOARDS}
              </Badge>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <div
                className="grid grid-cols-2 gap-3 md:grid-cols-4"
                data-testid="board-comparison-board-toggles"
              >
                {allBoards.map((board) => {
                  const checked = selectedBoardIds.includes(board.id);
                  const disabled = !checked && selectedBoardIds.length >= MAX_SELECTED_BOARDS;
                  return (
                    <Label
                      key={board.id}
                      htmlFor={`board-toggle-${board.id}`}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${
                        disabled ? 'cursor-not-allowed opacity-60' : ''
                      }`}
                      data-testid={`board-toggle-${board.id}`}
                    >
                      <Checkbox
                        id={`board-toggle-${board.id}`}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={() => toggleBoard(board.id)}
                      />
                      <span>{board.name}</span>
                    </Label>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-[hsl(var(--foreground))]">Metrics</p>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <div
                className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
                data-testid="board-comparison-metric-toggles"
              >
                {allMetrics.map((metric) => {
                  const checked = selectedMetricIds.includes(metric.id);
                  return (
                    <Label
                      key={metric.id}
                      htmlFor={`metric-toggle-${metric.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                      data-testid={`metric-toggle-${metric.id}`}
                    >
                      <Checkbox
                        id={`metric-toggle-${metric.id}`}
                        checked={checked}
                        onCheckedChange={() => toggleMetric(metric.id)}
                      />
                      <span>{metric.label}</span>
                    </Label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium text-[hsl(var(--foreground))]">
              Trend metric
            </Label>
            <Select
              value={trendMetricId}
              onValueChange={(v) => setTrendMetricId(v as BoardComparisonMetricId)}
            >
              <SelectTrigger
                className="w-[180px]"
                data-testid="board-comparison-trend-metric-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allMetrics.map((metric) => (
                  <SelectItem key={metric.id} value={metric.id}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Side-by-side KPI cards per selected board */}
      <DashboardSection
        title="Board KPIs"
        description="Headline metrics for each selected board"
        loading={isLoading}
        loadingPlaceholders={2}
      >
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
          data-testid="board-comparison-kpi-grid"
        >
          {selectedBoards.map((board) => (
            <Card key={board.id} data-testid={`board-comparison-board-card-${board.id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{board.name}</CardTitle>
                <CardDescription>Selected for comparison</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {selectedMetrics.map((metric) => (
                  <KpiCard
                    key={metric.id}
                    label={metric.label}
                    value={board.kpis[metric.id]}
                    data-testid={`board-comparison-kpi-${board.id}-${metric.id}`}
                  />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </DashboardSection>

      {/* Radar comparison */}
      <RadarComparison
        title="Board Performance Profile"
        description="Normalized scores across the selected metrics (0–100)"
        axes={radarAxes}
        series={radarSeries}
        max={100}
        loading={isLoading}
        data-testid="board-comparison-radar"
      />

      {/* Multi-year trend */}
      <TrendChartCard
        title="Multi-year Trend"
        description={`Five-year trend for ${trendMetricLabel.toLowerCase()} across the selected boards.`}
        metricLabel={trendMetricLabel}
        data={trendData}
        series={trendSeries}
        loading={isLoading}
      />

      {/* Detailed comparison table */}
      <DataTableCard
        title="Detailed Comparison"
        description="Board × metric × year rows for the active selection"
        columns={DETAIL_COLUMNS}
        rows={detailRows}
        rowKey={(row) => row.id}
        loading={isLoading}
        emptyMessage="No rows match the current selection. Pick at least one board and one metric."
        data-testid="board-comparison-detail-table"
      />
    </div>
  );
}
