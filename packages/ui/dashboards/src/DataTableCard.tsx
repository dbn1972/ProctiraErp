/**
 * <DataTableCard /> — Card-wrapped data table for dashboard drill-down rows.
 *
 * Used by the Country / State / Board Admin dashboards to render the
 * region or board breakdown table with click-to-drill rows. The inner
 * `<Table>` primitives come from `@proctira/ui-components` so the
 * platform's table styling stays consistent.
 *
 * Generic over the row type so the column accessor returns a typed value.
 *
 * Token usage:
 *   - Outer `<Card>` paints from `--card` / `--card-foreground` /
 *     `--border`.
 *   - Row hover state is provided by the shared `<TableRow>` styles
 *     which use `--muted` from the design tokens.
 *
 * Loading state (Property F-8): renders a skeleton table with the same
 * column count as the live layout (read from `columns.length`).
 *
 * Empty state: when `rows` is empty after a successful load, renders
 * `emptyMessage` (default `"No data available"`) inside the card body.
 *
 * Error state: when `error` is set, renders an inline error with
 * `role="alert"`.
 *
 * Async announcement (Design L): polite announcement on
 * loading→loaded; assertive on error.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui-components';
import type { ReactNode } from 'react';

import { useAsyncAnnounce } from './lib/useAsyncAnnounce';
import { cn } from './lib/utils';

/** Elements whose own activation must not also trigger the row click. */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

export interface DataTableCardColumn<T> {
  /** Stable id used as React key + a11y label hook. */
  id: string;
  /** Column header text. */
  header: ReactNode;
  /** Cell renderer for a row. */
  cell: (row: T, index: number) => ReactNode;
  /** Optional column class (e.g. `"text-end"` for numeric alignment). */
  className?: string;
  /** Optional class for the column header cell. */
  headerClassName?: string;
}

export interface DataTableCardProps<T> {
  /** Card title (e.g. `"Region breakdown"`). */
  title: string;
  /** Optional secondary description rendered under the title. */
  description?: ReactNode;
  /** Optional right-aligned action slot (e.g. an export button). */
  action?: ReactNode;
  /** Column definitions. */
  columns: ReadonlyArray<DataTableCardColumn<T>>;
  /** Row data. */
  rows: ReadonlyArray<T>;
  /** Function returning a stable row key. */
  rowKey: (row: T, index: number) => string | number;
  /** Optional click handler (drill-down). When set, rows become buttons. */
  onRowClick?: (row: T) => void;
  /** Whether the card is loading. Renders a skeleton table. */
  loading?: boolean;
  /** Number of skeleton rows to render while loading. Defaults to `5`. */
  loadingRowCount?: number;
  /** Error from the data fetch. */
  error?: unknown;
  /** Empty-state message rendered when `rows.length === 0`. */
  emptyMessage?: ReactNode;
  /** Override for the SR announcement on loading→loaded. */
  loadedMessage?: string;
  /** Extra class names applied to the outer `<Card>`. */
  className?: string;
  /** Optional `data-testid`. */
  'data-testid'?: string;
}

export function DataTableCard<T>({
  title,
  description,
  action,
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  loadingRowCount = 5,
  error,
  emptyMessage = 'No data available',
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: DataTableCardProps<T>) {
  useAsyncAnnounce({
    loading,
    loadedMessage:
      loadedMessage ??
      (loading
        ? `${title} loaded`
        : `${title} loaded: ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`),
    error,
  });

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
      role={error ? 'alert' : undefined}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div data-testid="data-table-card-action">{action}</div> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p className="text-sm text-[hsl(var(--destructive))]" data-testid="data-table-card-error">
            Unable to load {title.toLowerCase()}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.id} className={col.headerClassName}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: Math.max(1, loadingRowCount) }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} data-testid="data-table-card-skeleton-row">
                    {columns.map((col) => (
                      <TableCell key={col.id} className={col.className}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
                    data-testid="data-table-card-empty"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, rowIndex) => {
                  const interactive = Boolean(onRowClick);
                  // The <tr> keeps its native row semantics. Keyboard / AT
                  // activation goes through a real <button> in the first
                  // cell; the row-level click is a mouse convenience only
                  // and ignores clicks on interactive cell content.
                  return (
                    <TableRow
                      key={rowKey(row, rowIndex)}
                      onClick={
                        interactive
                          ? (e) => {
                              const target = e.target as HTMLElement;
                              // Only interactive content inside this row counts;
                              // ancestors such as the focusable scroll wrapper
                              // (PRC-L197) must not swallow row clicks.
                              const hit = target.closest(INTERACTIVE_SELECTOR);
                              if (hit && e.currentTarget.contains(hit)) return;
                              onRowClick?.(row);
                            }
                          : undefined
                      }
                      className={cn(interactive && 'cursor-pointer')}
                    >
                      {columns.map((col, colIndex) => (
                        <TableCell key={col.id} className={col.className}>
                          {interactive && colIndex === 0 ? (
                            <button
                              type="button"
                              data-testid="data-table-card-row-action"
                              className="text-start font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 rounded-sm"
                              onClick={() => onRowClick?.(row)}
                            >
                              {col.cell(row, rowIndex)}
                            </button>
                          ) : (
                            col.cell(row, rowIndex)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// Stable display name so devtools / tests don't see a generic component.
(DataTableCard as { displayName?: string }).displayName = 'DataTableCard';
