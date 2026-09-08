/**
 * <KpiCard /> — single KPI tile (label + big-number value + optional
 * icon badge and trend indicator).
 *
 * Implements the canonical KPI surface listed in Design §G's reusable
 * widgets table. Used by every dashboard variant to render headline
 * metrics like "Total students: 12,480".
 *
 * Token usage:
 *   - Outer surface: `<Card>` from `@proctira/ui-components` which paints
 *     `--card`, `--card-foreground`, `--border`, and `--shadow` from the
 *     design-token sheet (`packages/ui/styles/theme.css`).
 *   - Trend chip: the `success` / `destructive` / `muted-foreground`
 *     tokens, never literal hex.
 *
 * Loading state (Property F-8):
 *   - When `loading` is `true`, the card renders a Skeleton block matching
 *     the live layout's grid so hydration produces ≤ 0.1 CLS.
 *
 * Async announcement (Design L):
 *   - On the `loading` → `loaded` transition, a polite SR announcement is
 *     pushed through the global `<LiveRegion>` (e.g. `${label} loaded:
 *     12,480`) so non-visual users learn the value arrived.
 *
 * Error state:
 *   - When `error` is set after a load, the card swaps into an inline
 *     error state with `role="alert"` and pushes an assertive
 *     announcement.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

/** Direction of the optional trend indicator. */
export type KpiTrendDirection = 'up' | 'down' | 'flat';

export interface KpiTrend {
  /** Direction of the change vs the previous period. */
  direction: KpiTrendDirection;
  /**
   * Pre-formatted delta label rendered next to the arrow, e.g. `"+3.2%"`,
   * `"-118"`. We accept the formatted string (rather than a raw number)
   * because formatting depends on locale + unit — pushing the responsibility
   * onto the caller keeps this widget locale-agnostic.
   */
  label: string;
  /**
   * Optional accessible description of the trend, e.g. `"+3.2% vs last
   * month"`. Defaults to `label` if omitted.
   */
  ariaLabel?: string;
}

export interface KpiCardProps {
  /** Short metric name, rendered above the value (e.g. `"Total students"`). */
  label: string;
  /**
   * The KPI itself. Accept `ReactNode` (rather than `string` / `number`)
   * so callers can format with currency / locale or compose with units
   * (e.g. `<>1,240<span className="text-base">/2,000</span></>`).
   */
  value: ReactNode;
  /**
   * Optional icon badge rendered in the card header (typically a lucide
   * icon at 20×20 px). Pass an already-rendered element so the caller
   * controls sizing.
   */
  icon?: ReactNode;
  /** Optional secondary description below the value (e.g. `"vs last term"`). */
  description?: ReactNode;
  /** Optional trend indicator rendered below the value. */
  trend?: KpiTrend;
  /** Whether the card is loading async data. Renders a skeleton when `true`. */
  loading?: boolean;
  /**
   * Error from the data fetch, if any. When set, the card flips into an
   * inline error state and announces assertively via `<LiveRegion>`.
   */
  error?: unknown;
  /**
   * Override for the SR announcement fired on loading→loaded. Defaults
   * to `"${label} loaded"`.
   */
  loadedMessage?: string;
  /** Extra class names applied to the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid` to ease unit testing. */
  'data-testid'?: string;
}

/**
 * Inline arrow + delta label. Color picks from the success / destructive /
 * muted-foreground tokens so the chip respects light + dark themes.
 */
function TrendChip({ trend }: { trend: KpiTrend }) {
  const Icon =
    trend.direction === 'up' ? ArrowUpRight : trend.direction === 'down' ? ArrowDownRight : Minus;
  const tone =
    trend.direction === 'up'
      ? 'text-[hsl(var(--success))]'
      : trend.direction === 'down'
        ? 'text-[hsl(var(--destructive))]'
        : 'text-[hsl(var(--muted-foreground))]';
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-sm font-medium', tone)}
      aria-label={trend.ariaLabel ?? trend.label}
      data-testid="kpi-trend"
      data-direction={trend.direction}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{trend.label}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  icon,
  description,
  trend,
  loading = false,
  error,
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: KpiCardProps) {
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
        aria-live="off"
        data-testid={dataTestId}
        data-state="loading"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" data-testid="kpi-skeleton-label" />
          {icon ? <Skeleton className="h-6 w-6 rounded-full" /> : null}
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Skeleton className="h-9 w-32" data-testid="kpi-skeleton-value" />
          <Skeleton className="h-4 w-40" />
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
          <p className="text-sm text-[hsl(var(--destructive))]">Unable to load this metric.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)} data-testid={dataTestId} data-state="ready">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          {label}
        </CardTitle>
        {icon ? (
          <span className="text-[hsl(var(--muted-foreground))]" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <div
          className="text-3xl font-semibold tracking-tight text-[hsl(var(--card-foreground))]"
          data-testid="kpi-value"
        >
          {value}
        </div>
        {trend ? <TrendChip trend={trend} /> : null}
        {description ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

KpiCard.displayName = 'KpiCard';
