/**
 * <TaskChecklist /> — pending-tasks list with completion checkboxes.
 *
 * Used by the School / Teacher / Parent dashboards (Design §G.6+) to
 * surface short pending-task lists with a quick "mark done" affordance.
 *
 * Behavior:
 *   - The component is uncontrolled-by-default: a parent that supplies
 *     `onToggle` is responsible for persisting state and re-rendering with
 *     the updated `tasks.completed` flag. We intentionally avoid an
 *     internal optimistic state to keep the data-flow predictable in
 *     dashboards that pull state from a server cache (SWR / RTK Query).
 *
 * Loading state (Property F-8): renders skeleton rows.
 *
 * Empty state: renders an empty message inside the card body.
 *
 * Async announcement (Design L): polite on loading→loaded; tasks
 * toggled by the user fire their own `${title}: completed` /
 * `${title}: reopened` announcement so SR users hear immediate feedback.
 */

import { CheckCircle2, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Skeleton,
  useAnnounce,
} from '@proctira/ui-components';

import { cn } from './lib/utils';
import { useAsyncAnnounce } from './lib/useAsyncAnnounce';

export interface ChecklistTask {
  /** Stable task id. */
  id: string;
  /** Task title (e.g. `"Approve enrollment for Aarav S."`). */
  title: ReactNode;
  /** Optional secondary description. */
  description?: ReactNode;
  /** Whether the task is currently completed. */
  completed: boolean;
  /** Optional context string (e.g. due date) rendered next to the title. */
  meta?: ReactNode;
}

export interface TaskChecklistProps {
  /** Card title (e.g. `"Pending tasks"`). */
  title: string;
  /** Optional secondary description. */
  description?: ReactNode;
  /** Tasks in display order. */
  tasks: ReadonlyArray<ChecklistTask>;
  /** Optional toggle handler. When omitted, the checkboxes are read-only. */
  onToggle?: (task: ChecklistTask) => void;
  /** Whether the list is loading. */
  loading?: boolean;
  /** Number of skeleton rows to render. Defaults to `4`. */
  loadingRowCount?: number;
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

export function TaskChecklist({
  title,
  description,
  tasks,
  onToggle,
  loading = false,
  loadingRowCount = 4,
  error,
  emptyMessage = 'No pending tasks',
  loadedMessage,
  className,
  'data-testid': dataTestId,
}: TaskChecklistProps) {
  const announce = useAnnounce();
  const pendingCount = tasks.filter((t) => !t.completed).length;

  useAsyncAnnounce({
    loading,
    loadedMessage:
      loadedMessage ??
      (pendingCount === 1
        ? `${title} loaded: 1 pending task`
        : `${title} loaded: ${pendingCount} pending tasks`),
    error,
  });

  return (
    <Card
      className={cn('overflow-hidden', className)}
      data-testid={dataTestId}
      data-state={loading ? 'loading' : error ? 'error' : 'ready'}
      aria-busy={loading ? 'true' : undefined}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-testid="task-checklist-error"
          >
            Unable to load tasks.
          </p>
        ) : loading ? (
          <ul className="space-y-3" data-testid="task-checklist-skeleton">
            {Array.from({ length: Math.max(1, loadingRowCount) }).map((_, i) => (
              <li key={i} className="flex items-start gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1 rounded" />
              </li>
            ))}
          </ul>
        ) : tasks.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 py-8 text-center"
            data-testid="task-checklist-empty"
          >
            <CheckCircle2 className="h-8 w-8 text-[hsl(var(--success))]" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{emptyMessage}</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label={title}>
            {tasks.map((task) => {
              const handleToggle = () => {
                if (!onToggle) return;
                onToggle(task);
                announce(
                  task.completed
                    ? `Task reopened: ${typeof task.title === 'string' ? task.title : ''}`
                    : `Task completed: ${typeof task.title === 'string' ? task.title : ''}`,
                );
              };
              return (
                <li
                  key={task.id}
                  className="flex items-start gap-3"
                  data-testid="task-checklist-item"
                  data-completed={task.completed ? 'true' : 'false'}
                >
                  <Checkbox
                    checked={task.completed}
                    disabled={!onToggle}
                    onCheckedChange={handleToggle}
                    aria-label={typeof task.title === 'string' ? task.title : 'Toggle task'}
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-0.5">
                    <p
                      className={cn(
                        'text-sm font-medium text-[hsl(var(--foreground))]',
                        task.completed && 'text-[hsl(var(--muted-foreground))] line-through',
                      )}
                    >
                      {task.title}
                    </p>
                    {task.description ? (
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">
                        {task.description}
                      </p>
                    ) : null}
                    {task.meta ? (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">{task.meta}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

TaskChecklist.displayName = 'TaskChecklist';
