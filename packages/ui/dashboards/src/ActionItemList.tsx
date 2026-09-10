/**
 * <ActionItemList /> — list of action items with severity badges and deep
 * links.
 *
 * Used by every dashboard variant that surfaces "things needing your
 * attention" — pending approvals, overdue assessments, expired
 * affiliations. Each row carries a title, an optional due date, and a
 * priority badge; clicking the row deep-links into the detail screen.
 *
 * Token usage:
 *   - Severity badge → `<Badge>` from `@proctira/ui-components`, mapping
 *     priority → variant (`destructive` / `warning` / `secondary`).
 *   - Card surface → `--card` / `--border` / `--card-foreground`.
 *
 * Loading state (Property F-8): renders skeleton rows matching the live
 * layout.
 *
 * Empty state: when `items` is empty after a load, renders a reassuring
 * "All clear" message inside the card body.
 *
 * Async announcement (Design L): polite announcement reporting the
 * number of action items; assertive announcement when at least one
 * `high`-priority item exists so SR users hear about urgent work.
 */

import { ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useAnnounce,
} from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export type ActionItemPriority = 'high' | 'medium' | 'low';

export interface ActionItem {
  /** Stable item id. */
  id: string;
  /** Item title (e.g. `"Approve transfer for Aarav S."`). */
  title: ReactNode;
  /** Optional secondary description. */
  description?: ReactNode;
  /** Optional pre-formatted due date label. */
  dueLabel?: ReactNode;
  /** Priority drives the badge variant. Defaults to `'medium'`. */
  priority?: ActionItemPriority;
  /**
   * Optional deep-link href. When set, the row renders as an `<a>`. If
   * `onSelect` is also provided, the link wins (clicks navigate); use
   * `onSelect` only when there is no static URL.
   */
  href?: string;
}

export interface ActionItemListProps {
  /** Card title. */
  title: string;
  /** Optional secondary description. */
  description?: ReactNode;
  /** Items in display order (most urgent first). */
  items: ReadonlyArray<ActionItem>;
  /**
   * Optional click handler. Used when an item lacks `href` (e.g. opens a
   * modal). Receives the item.
   */
  onSelect?: (item: ActionItem) => void;
  /** Whether the list is loading. */
  loading?: boolean;
  /** Number of skeleton rows. Defaults to `3`. */
  loadingRowCount?: number;
  /** Error from the data fetch. */
  error?: unknown;
  /** Empty-state message. Defaults to `"You're all caught up"`. */
  emptyMessage?: ReactNode;
  /** Override for the polite SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class applied to the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

function priorityVariant(
  p: ActionItemPriority | undefined,
): 'destructive' | 'warning' | 'secondary' {
  switch (p) {
    case 'high':
      return 'destructive';
    case 'low':
      return 'secondary';
    case 'medium':
    default:
      return 'warning';
  }
}

function priorityLabel(p: ActionItemPriority | undefined): string {
  switch (p) {
    case 'high':
      return 'High priority';
    case 'low':
      return 'Low priority';
    case 'medium':
    default:
      return 'Medium priority';
  }
}

export function ActionItemList({
  title,
  description,
  items,
  onSelect,
  loading = false,
  loadingRowCount = 3,
  error,
  emptyMessage = "You're all caught up",
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: ActionItemListProps) {
  const announce = useAnnounce();
  const highCount = items.filter((i) => i.priority === 'high').length;
  const wasLoadingRef = useRef<boolean>(loading);

  useAsyncAnnounce({
    loading,
    loadedMessage:
      loadedMessage ??
      (items.length === 1
        ? `${title} loaded: 1 action item`
        : `${title} loaded: ${items.length} action items`),
    error,
  });

  // Extra assertive announcement when the loaded payload contains any
  // high-priority items so SR users hear the urgency separately from the
  // generic "loaded" message.
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    if (wasLoading && !loading && !error && highCount > 0) {
      announce(
        highCount === 1
          ? `1 high-priority action item requires attention`
          : `${highCount} high-priority action items require attention`,
        'assertive',
      );
    }
    wasLoadingRef.current = loading;
  }, [loading, error, highCount, announce]);

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-testid="action-item-list-error"
          >
            Unable to load action items.
          </p>
        ) : loading ? (
          <ul className="space-y-3" data-testid="action-item-list-skeleton">
            {Array.from({ length: Math.max(1, loadingRowCount) }).map((_, i) => (
              <li key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 flex-1 rounded" />
                <Skeleton className="h-5 w-16 rounded" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 py-8 text-center"
            data-testid="action-item-list-empty"
          >
            <CheckCircle2 className="h-8 w-8 text-[hsl(var(--success))]" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{emptyMessage}</p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label={title}>
            {items.map((item) => {
              const variant = priorityVariant(item.priority);
              const ariaLabel = `${priorityLabel(item.priority)}: ${
                typeof item.title === 'string' ? item.title : 'action item'
              }`;
              const inner = (
                <span className="flex flex-1 items-center justify-between gap-3">
                  <span className="flex-1 space-y-0.5 text-start">
                    <span className="block text-sm font-medium text-[hsl(var(--foreground))]">
                      {item.title}
                    </span>
                    {item.description ? (
                      <span className="block text-sm text-[hsl(var(--muted-foreground))]">
                        {item.description}
                      </span>
                    ) : null}
                    {item.dueLabel ? (
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                        {item.dueLabel}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant={variant} aria-label={priorityLabel(item.priority)}>
                    {item.priority ?? 'medium'}
                  </Badge>
                  <ChevronRight
                    className="h-4 w-4 text-[hsl(var(--muted-foreground))]"
                    aria-hidden="true"
                  />
                </span>
              );

              const className =
                'flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-start transition-colors hover:bg-[hsl(var(--accent))]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]';

              return (
                <li
                  key={item.id}
                  data-testid="action-item-list-item"
                  data-priority={item.priority ?? 'medium'}
                >
                  {item.href ? (
                    <a href={item.href} className={className} aria-label={ariaLabel}>
                      {inner}
                    </a>
                  ) : onSelect ? (
                    <button
                      type="button"
                      className={className}
                      onClick={() => onSelect(item)}
                      aria-label={ariaLabel}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={className} aria-label={ariaLabel}>
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

ActionItemList.displayName = 'ActionItemList';
