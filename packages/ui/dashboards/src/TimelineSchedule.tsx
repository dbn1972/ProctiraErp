/**
 * <TimelineSchedule /> — vertical timeline grouping events under date
 * headers, with a current-time marker.
 *
 * Used by the School / Teacher dashboards (Design §G.6, §G.7) for
 * "Today's schedule" and the Cross-Board Transfer dashboard's
 * `<ApprovalWorkflow>` step indicator.
 *
 * Token usage:
 *   - Heading typography pulls from `--foreground` / `--muted-foreground`.
 *   - The current-time marker uses `--primary` so it tracks the active
 *     theme.
 *   - Item border / dot uses `--border` and `--accent`.
 *
 * Loading state (Property F-8): renders skeleton rows that match the
 * timeline row layout.
 *
 * Empty state: when `items` is empty after a load, renders a centered
 * "No events" message.
 *
 * Async announcement (Design L): polite on loading→loaded.
 */

import type { ReactNode } from 'react';

import { Skeleton } from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export type TimelineItemStatus =
  | 'completed'
  | 'active'
  | 'upcoming'
  | 'cancelled';

export interface TimelineItem {
  /** Stable id used as the React key. */
  id: string;
  /** Time label rendered in the leading column (e.g. `"08:30"`). */
  time: string;
  /** Primary item label (e.g. lesson name, approval step). */
  title: ReactNode;
  /** Optional secondary description. */
  description?: ReactNode;
  /**
   * Optional ISO date the item belongs to. Items sharing the same
   * `date` are rendered under a single date header. Pass an
   * already-localized display date because grouping is done by raw
   * value (no Intl conversion).
   */
  date?: string;
  /** Status drives the dot color + a11y label. */
  status?: TimelineItemStatus;
}

export interface TimelineScheduleProps {
  /** Optional title rendered above the timeline. */
  title?: string;
  /** Optional description below the title. */
  description?: ReactNode;
  /** Timeline items in display order (oldest → newest). */
  items: ReadonlyArray<TimelineItem>;
  /**
   * Optional id of the item to mark as "now". When set, an extra
   * `<div data-testid="timeline-now-marker" />` renders above that item.
   */
  nowId?: string;
  /** Whether the timeline is loading. */
  loading?: boolean;
  /** Number of skeleton rows to render. Defaults to `4`. */
  loadingRowCount?: number;
  /** Error from the data fetch. */
  error?: unknown;
  /** Empty-state message. */
  emptyMessage?: ReactNode;
  /** Override for the SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class on the outer container. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

function statusToTone(status: TimelineItemStatus | undefined): {
  dot: string;
  label: string;
} {
  switch (status) {
    case 'completed':
      return {
        dot: 'bg-[hsl(var(--success))]',
        label: 'completed',
      };
    case 'active':
      return {
        dot: 'bg-[hsl(var(--primary))]',
        label: 'in progress',
      };
    case 'cancelled':
      return {
        dot: 'bg-[hsl(var(--destructive))]',
        label: 'cancelled',
      };
    case 'upcoming':
    default:
      return {
        dot: 'bg-[hsl(var(--muted-foreground))]',
        label: 'upcoming',
      };
  }
}

export function TimelineSchedule({
  title,
  description,
  items,
  nowId,
  loading = false,
  loadingRowCount = 4,
  error,
  emptyMessage = 'No scheduled events',
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: TimelineScheduleProps) {
  useAsyncAnnounce({
    loading,
    loadedMessage:
      loadedMessage ??
      `${title ?? 'Schedule'} loaded: ${items.length} ${
        items.length === 1 ? 'event' : 'events'
      }`,
    error,
  });

  if (error) {
    return (
      <div
        className={cn('space-y-3', className)}
        role="alert"
        data-testid={dataTestId}
        data-state="error"
      >
        {title ? (
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {title}
          </h2>
        ) : null}
        <p className="text-sm text-[hsl(var(--destructive))]">
          Unable to load schedule.
        </p>
      </div>
    );
  }

  // Group items by date label, preserving insertion order.
  const groups = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const key = item.date ?? '__no_date__';
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return (
    <div
      className={cn('space-y-4', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
    >
      {title ? (
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {description}
        </p>
      ) : null}

      {loading ? (
        <ul
          className="space-y-3"
          data-testid="timeline-schedule-skeleton"
        >
          {Array.from({ length: Math.max(1, loadingRowCount) }).map((_, i) => (
            <li key={i} className="flex items-start gap-3">
              <Skeleton className="h-3 w-12 rounded" />
              <Skeleton className="h-12 flex-1 rounded" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p
          className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
          data-testid="timeline-schedule-empty"
        >
          {emptyMessage}
        </p>
      ) : (
        <ol className="space-y-4" aria-label={title ?? 'Schedule'}>
          {Array.from(groups.entries()).map(([date, dateItems]) => (
            <li key={date} className="space-y-2">
              {date !== '__no_date__' ? (
                <h3
                  className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
                  data-testid="timeline-date-header"
                >
                  {date}
                </h3>
              ) : null}
              <ul className="relative ms-2 space-y-3 border-s border-[hsl(var(--border))] ps-4">
                {dateItems.map((item) => {
                  const tone = statusToTone(item.status);
                  const isNow = item.id === nowId;
                  return (
                    <li
                      key={item.id}
                      className="relative"
                      data-testid="timeline-item"
                      data-status={item.status ?? 'upcoming'}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -start-[22px] top-2 inline-block h-3 w-3 rounded-full ring-2 ring-[hsl(var(--background))]',
                          tone.dot,
                        )}
                      />
                      {isNow ? (
                        <span
                          data-testid="timeline-now-marker"
                          className="absolute -start-[34px] top-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--primary))]"
                          aria-label="Current time"
                        >
                          Now
                        </span>
                      ) : null}
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
                        <span className="w-16 shrink-0 text-sm font-medium text-[hsl(var(--muted-foreground))]">
                          {item.time}
                        </span>
                        <div className="flex-1 space-y-0.5">
                          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                            {item.title}
                          </p>
                          {item.description ? (
                            <p className="text-sm text-[hsl(var(--muted-foreground))]">
                              {item.description}
                            </p>
                          ) : null}
                          <span className="sr-only">
                            Status: {tone.label}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

TimelineSchedule.displayName = 'TimelineSchedule';
