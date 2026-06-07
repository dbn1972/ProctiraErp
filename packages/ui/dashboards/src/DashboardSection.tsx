/**
 * <DashboardSection /> — titled grouping for a slab of dashboard widgets.
 *
 * Provides consistent spacing between the section heading, an optional
 * action slot (typically a "View all" link or a date filter), and the
 * content area where the actual widgets live. Optional `collapsible`
 * support flips the body into an accordion-style hide/show.
 *
 * Token usage: text classes pull from `--foreground` and
 * `--muted-foreground` so the section header tracks light/dark theme
 * changes. The body is a plain `<div>` so consumers control their own
 * grid (the dashboards we render are 12-column responsive grids).
 *
 * Loading state (Property F-8): when `loading` is `true`, a skeleton
 * row matching the title bar renders, plus a configurable number of
 * placeholder rows in the body.
 *
 * Async announcement (Design L): on the loading→loaded transition, a
 * polite `${title} loaded` announcement is dispatched.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Skeleton } from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export interface DashboardSectionProps {
  /** Section heading text (renders inside an `<h2>`). */
  title: string;
  /** Optional secondary description below the title. */
  description?: ReactNode;
  /** Optional right-aligned slot, typically an action link or filter. */
  action?: ReactNode;
  /** Section body — usually a grid of widgets. */
  children?: ReactNode;
  /**
   * When `true`, the heading becomes a button that toggles the body
   * visibility. Default `false`. The expanded/collapsed state is
   * uncontrolled; use `defaultExpanded` to set the initial value.
   */
  collapsible?: boolean;
  /** Initial expanded state when `collapsible` is `true`. Defaults to `true`. */
  defaultExpanded?: boolean;
  /** Whether the section is loading. Renders skeleton placeholders. */
  loading?: boolean;
  /**
   * Number of skeleton placeholder rows to render in the body when
   * loading. Defaults to `2`.
   */
  loadingPlaceholders?: number;
  /** Override for the SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Optional class applied to the outer `<section>`. */
  className?: string;
  /** Optional class applied to the body wrapper. */
  bodyClassName?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

export function DashboardSection({
  title,
  description,
  action,
  children,
  collapsible = false,
  defaultExpanded = true,
  loading = false,
  loadingPlaceholders = 2,
  loadedMessage,
  className,
  bodyClassName,
  'data-testid': dataTestId,
}: DashboardSectionProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const headingId = useId();
  const bodyId = useId();

  useAsyncAnnounce({
    loading,
    loadedMessage: loadedMessage ?? `${title} loaded`,
  });

  const heading = collapsible ? (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="inline-flex items-center gap-2 text-start text-lg font-semibold text-[hsl(var(--foreground))]"
      aria-expanded={expanded}
      aria-controls={bodyId}
      id={headingId}
      data-testid="dashboard-section-toggle"
    >
      {expanded ? (
        <ChevronDown className="h-5 w-5" aria-hidden="true" />
      ) : (
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      )}
      {title}
    </button>
  ) : (
    <h2
      id={headingId}
      className="text-lg font-semibold text-[hsl(var(--foreground))]"
    >
      {title}
    </h2>
  );

  return (
    <section
      className={cn('space-y-3', className)}
      aria-labelledby={headingId}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : 'ready'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          {heading}
          {description ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div
            className="flex items-center gap-2"
            data-testid="dashboard-section-action"
          >
            {action}
          </div>
        ) : null}
      </div>

      {(!collapsible || expanded) && (
        <div
          id={bodyId}
          className={cn(bodyClassName)}
          data-testid="dashboard-section-body"
        >
          {loading ? (
            <div
              className="space-y-3"
              aria-busy="true"
              data-testid="dashboard-section-skeleton"
            >
              {Array.from({ length: Math.max(0, loadingPlaceholders) }).map(
                (_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ),
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

DashboardSection.displayName = 'DashboardSection';
