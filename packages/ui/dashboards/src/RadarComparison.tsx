/**
 * <RadarComparison /> — Recharts radar wrapper for cross-board / cross-
 * district comparisons.
 *
 * Used by the Board Comparison Dashboard (Design §G.4) which renders six
 * axes — enrollment, attendance, pass rate, PTR, GPI, infrastructure —
 * for up to four boards side by side. Each series gets its color from
 * `useSeriesColor(index)` so the radar tracks the platform's chart
 * tokens in light + dark.
 *
 * Loading state (Property F-8): renders a skeleton block matching the
 * radar's reserved height.
 *
 * Empty state: when `series` is empty after a load, renders an empty
 * message inside the card body.
 *
 * Async announcement (Design L): polite on loading→loaded; assertive on
 * error.
 */

import type { ReactNode } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  ThemedTooltip,
  useChartPalette,
  useSeriesColors,
} from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export interface RadarSeries {
  /** Stable id used as the React key + tooltip name. */
  id: string;
  /** Human-readable series label (e.g. board name). */
  label: string;
  /**
   * Map of axis id → metric value. Missing axes fall back to `0`. Values
   * should be normalised to a comparable scale per axis before being
   * passed in (Recharts does not normalise per axis on its own).
   */
  values: Record<string, number>;
}

export interface RadarComparisonProps {
  /** Card title. */
  title: string;
  /** Optional secondary description. */
  description?: ReactNode;
  /**
   * Axis ids in display order. Must match keys used in
   * `series[i].values`.
   */
  axes: ReadonlyArray<{ id: string; label: string }>;
  /** Series data (one per board / district being compared). */
  series: ReadonlyArray<RadarSeries>;
  /**
   * Maximum value of the radius axis. Pass an explicit number when the
   * raw values already share a comparable scale (e.g. percentage). Pass
   * `'auto'` to let Recharts derive the domain from the data.
   */
  max?: number | 'auto';
  /** Chart height in pixels. Defaults to 320. */
  height?: number;
  /** Whether the chart is loading. */
  loading?: boolean;
  /** Error from the data fetch. */
  error?: unknown;
  /** Empty-state message. */
  emptyMessage?: ReactNode;
  /** Override for the SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class on the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

interface RadarRow {
  axis: string;
  label: string;
  [seriesId: string]: number | string;
}

export function RadarComparison({
  title,
  description,
  axes,
  series,
  max = 'auto',
  height = 320,
  loading = false,
  error,
  emptyMessage = 'No comparison data available',
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: RadarComparisonProps) {
  const colors = useSeriesColors();
  const palette = useChartPalette();

  useAsyncAnnounce({
    loading,
    loadedMessage: loadedMessage ?? `${title} radar loaded`,
    error,
  });

  // Pivot the series into the row shape Recharts expects: one row per
  // axis with one column per series.
  const rows: ReadonlyArray<RadarRow> = axes.map((axis) => {
    const row: RadarRow = { axis: axis.id, label: axis.label };
    for (const s of series) {
      row[s.id] = s.values[axis.id] ?? 0;
    }
    return row;
  });

  const isEmpty = !loading && !error && (series.length === 0 || axes.length === 0);

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-testid="radar-comparison-error"
          >
            Unable to load the comparison radar.
          </p>
        ) : loading ? (
          <Skeleton
            className="w-full rounded-md"
            style={{ height }}
            data-testid="radar-comparison-skeleton"
          />
        ) : isEmpty ? (
          <p
            className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
            data-testid="radar-comparison-empty"
          >
            {emptyMessage}
          </p>
        ) : (
          <div style={{ height }} data-testid="radar-comparison-chart">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={rows as RadarRow[]} outerRadius="70%">
                <PolarGrid stroke={palette.grid} />
                <PolarAngleAxis dataKey="label" tick={{ fill: palette.axisTick, fontSize: 12 }} />
                <PolarRadiusAxis
                  angle={90}
                  domain={max === 'auto' ? undefined : [0, max]}
                  stroke={palette.axis}
                  tick={{ fill: palette.axisTick, fontSize: 11 }}
                />
                <ThemedTooltip />
                {series.map((s, i) => {
                  const color = colors[i % colors.length] ?? colors[0];
                  return (
                    <Radar
                      key={s.id}
                      name={s.label}
                      dataKey={s.id}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.25}
                      isAnimationActive={false}
                    />
                  );
                })}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

RadarComparison.displayName = 'RadarComparison';
