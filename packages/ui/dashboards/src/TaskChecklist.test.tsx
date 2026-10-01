import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { LiveRegion } from '@proctira/ui-components';

import { TaskChecklist, type ChecklistTask } from './TaskChecklist';

const tasks: ReadonlyArray<ChecklistTask> = [
  { id: 'a', title: 'Approve enrolment for Aarav S.', completed: false },
  { id: 'b', title: 'Review staff timesheet', completed: true },
];

describe('<TaskChecklist />', () => {
  it('renders one row per task with the right completion state', () => {
    render(<TaskChecklist title="Pending tasks" tasks={tasks} data-testid="checklist" />);

    expect(screen.getByTestId('checklist')).toHaveAttribute('data-state', 'ready');
    const rendered = screen.getAllByTestId('task-checklist-item');
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveAttribute('data-completed', 'false');
    expect(rendered[1]).toHaveAttribute('data-completed', 'true');
    expect(screen.getByText('Approve enrolment for Aarav S.')).toBeInTheDocument();
  });

  it('renders skeleton placeholders while loading', () => {
    render(
      <TaskChecklist
        title="Pending tasks"
        tasks={[]}
        loading
        loadingRowCount={3}
        data-testid="checklist"
      />,
    );

    const card = screen.getByTestId('checklist');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card).toHaveAttribute('aria-busy', 'true');
    const skel = screen.getByTestId('task-checklist-skeleton');
    expect(within(skel).getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders the empty state when tasks is empty', () => {
    render(<TaskChecklist title="Pending tasks" tasks={[]} emptyMessage="All caught up" />);
    expect(screen.getByTestId('task-checklist-empty')).toBeInTheDocument();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });

  it('renders an inline error message when error is set', () => {
    render(
      <TaskChecklist
        title="Pending tasks"
        tasks={[]}
        error={new Error('boom')}
        data-testid="checklist"
      />,
    );

    expect(screen.getByTestId('checklist')).toHaveAttribute('data-state', 'error');
    const err = screen.getByTestId('task-checklist-error');
    expect(err).toHaveAttribute('role', 'alert');
  });

  it('invokes onToggle when a task checkbox is activated', () => {
    const onToggle = vi.fn();
    render(<TaskChecklist title="Pending tasks" tasks={tasks} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Approve enrolment for Aarav S.' }));
    expect(onToggle).toHaveBeenCalledWith(tasks[0]);
  });

  describe('async toggle (PRC-L199)', () => {
    it('announces completion only after onToggle resolves and shows pending state', async () => {
      render(<LiveRegion />);
      let resolve: () => void = () => {};
      const onToggle = vi.fn(() => new Promise<void>((r) => (resolve = r)));
      render(<TaskChecklist title="Pending tasks" tasks={tasks} onToggle={onToggle} />);
      const box = screen.getByRole('checkbox', { name: 'Approve enrolment for Aarav S.' });
      fireEvent.click(box);
      const item = screen.getAllByTestId('task-checklist-item')[0];
      await waitFor(() => expect(item).toHaveAttribute('aria-busy', 'true'));
      expect(box).toBeDisabled();
      expect(screen.getByTestId('live-region-polite').textContent).not.toContain('Task completed');
      resolve();
      await waitFor(() =>
        expect(screen.getByTestId('live-region-polite').textContent).toBe(
          'Task completed: Approve enrolment for Aarav S.',
        ),
      );
      expect(item).not.toHaveAttribute('aria-busy');
    });

    it('announces failure assertively, not completion, when onToggle rejects', async () => {
      render(<LiveRegion />);
      const onToggle = vi.fn().mockRejectedValue(new Error('offline'));
      render(<TaskChecklist title="Pending tasks" tasks={tasks} onToggle={onToggle} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Approve enrolment for Aarav S.' }));
      await waitFor(() =>
        expect(screen.getByTestId('live-region-assertive').textContent).toBe(
          'Could not update task: Approve enrolment for Aarav S.',
        ),
      );
      expect(screen.getByTestId('live-region-polite').textContent).not.toContain('Task completed');
      expect(screen.getByTestId('task-checklist-toggle-error')).toHaveTextContent(
        'Could not update task. Try again.',
      );
      expect(
        screen.getByRole('checkbox', { name: 'Approve enrolment for Aarav S.' }),
      ).not.toBeDisabled();
    });
  });
});
