/**
 * <KpiCardWithTrend /> — KpiCard variant with an embedded sparkline.
 *
 * Renders the same label + big-number + trend-chip layout as <KpiCard>
 * but appends a small Recharts <Line> (no axes, no grid, no tooltip — pure
 * visual cue) underneath the value. The line color comes from
 * `useSeriesColor(seriesIndex)` so it tracks the active theme's
 * `--chart-1` … `--chart-5` tokens.
 *
 * Loading state (Property F-8): the entire card — label, value, trend
 * chip, and sparkline — is replaced with skeleton blocks matching the
 * loaded layout.
 *
 * Async announcement (Design L): on the loading→loaded transition, a
 * polite SR announcement (`${label} loaded`) fires through the global
 * `<LiveRegion>`. Errors fire an assertive announcement and swap into
 * an inline error state with `role="alert"`.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  useSeriesColor,
} from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';
import type { KpiTrend } from './KpiCard';

export interface KpiCardWithTrendProps {
  /** Short metric name. */
  label: string;
  /** The KPI value (already formatted by the caller). */
  value: ReactNode;
  /** Optional icon badge in the header (typically a 20×20 lucide icon). */
  icon?: ReactNode;
  /** Optional period description (e.g. `"Last 30 days"`). */
  description?: ReactNode;
  /** Optional trend chip (delta + arrow). */
  trend?: KpiTrend;
  /**
   * Y-values of the sparkline in chronological order. Empty / undefined
   * series hides the sparkline (the card still renders the KPI).
   */
  series?: ReadonlyArray<number>;
  /**
   * Slot index of the chart palette. Defaults to `0`. Pass distinct
   * indices to side-by-side cards so the colors differ in light + dark.
   */
  seriesIndex?: number;
  /** Height of the sparkline area. Defaults to 48 px to keep cards compact. */
  sparklineHeight?: number;
  /** Whether the card is loading. Renders a skeleton when `true`. */
  loading?: boolean;
  /** Error from the data fetch, if any. Renders an inline error state. */
  error?: unknown;
  /**
   * Override for the SR announcement fired on loading→loaded. Defaults
   * to `"${label} loaded"`.
   */
  loadedMessage?: string;
  /** Extra class names applied to the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

interface SparkPoint {
  i: number;
  v: number;
}

function TrendChip({ trend }: { trend: KpiTrend }) {
  const Icon =
    trend.direction === 'up'
      ? ArrowUpRight
      : trend.direction === 'down'
        ? ArrowDownRight
        : Minus;
  const tone =
    trend.direction === 'up'
      ? 'text-[hsl(var(--success))]'
      : trend.direction === 'down'
        ? 'text-[hsl(var(--destructive))]'
        : 'text-[hsl(var(--muted-foreground))]';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium',
        tone,
      )}
      aria-label={trend.ariaLabel ?? trend.label}
      data-testid="kpi-trend"
      data-direction={trend.direction}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{trend.label}</span>
    </span>
  );
}

export function KpiCardWithTrend({
  label,
  value,
  icon,
  description,
  trend,
  series,
  seriesIndex = 0,
  sparklineHeight = 48,
  loading = false,
  error,
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: KpiCardWithTrendProps) {
  const color = useSeriesColor(seriesIndex);

  useAsyncAnnounce({
    loading,
    loadedMessage: loadedMessage ?? `${label} loaded`,
    error,
  });

  if (loading) {
    return (
      <Card
        className={cn('overflow-hidden', className)}
        aria-busy="true"
        data-testid={dataTestId}
        data-state="loading"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          {icon ? <Skeleton className="h-6 w-6 rounded-full" /> : null}
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton
            className="w-full rounded-md"
            style={{ height: sparklineHeight }}
            data-testid="kpi-sparkline-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        className={cn('overflow-hidden', className)}
        role="alert"
        data-testid={dataTestId}
        data-state="error"
      >
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-[hsl(var(--destructive))]">
            Unable to load this metric.
          </p>
        </CardContent>
      </Card>
    );
  }

  const data: ReadonlyArray<SparkPoint> = (series ?? []).map((v, i) => ({
    i,
    v,
  }));
  const showSparkline = data.length >= 2;

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state="ready"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          {label}
        </CardTitle>
        {icon ? (
          <span
            className="text-[hsl(var(--muted-foreground))]"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div
          className="text-3xl font-semibold tracking-tight text-[hsl(var(--card-foreground))]"
          data-testid="kpi-value"
        >
          {value}
        </div>
        {trend ? <TrendChip trend={trend} /> : null}
        {description ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        ) : null}
        {showSparkline ? (
          <div
            style={{ height: sparklineHeight }}
            data-testid="kpi-sparkline"
            aria-hidden="true"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data as SparkPoint[]}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

KpiCardWithTrend.displayName = 'KpiCardWithTrend';
