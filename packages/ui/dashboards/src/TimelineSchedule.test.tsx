import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { TimelineSchedule, type TimelineItem } from './TimelineSchedule';

const items: ReadonlyArray<TimelineItem> = [
  {
    id: 'a',
    time: '08:30',
    title: 'Morning assembly',
    date: 'Today',
    status: 'completed',
  },
  {
    id: 'b',
    time: '09:30',
    title: 'Math — Grade 6',
    description: 'Room 12',
    date: 'Today',
    status: 'active',
  },
  {
    id: 'c',
    time: '11:00',
    title: 'Recess',
    date: 'Today',
    status: 'upcoming',
  },
];

describe('<TimelineSchedule />', () => {
  it('renders one row per item, grouped under date headers', () => {
    render(
      <TimelineSchedule
        title="Today's schedule"
        items={items}
        data-testid="schedule"
      />,
    );

    expect(screen.getByTestId('schedule')).toHaveAttribute(
      'data-state',
      'ready',
    );
    const dateHeaders = screen.getAllByTestId('timeline-date-header');
    expect(dateHeaders).toHaveLength(1);
    expect(dateHeaders[0].textContent).toBe('Today');

    const rendered = screen.getAllByTestId('timeline-item');
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toHaveAttribute('data-status', 'completed');
    expect(rendered[1]).toHaveAttribute('data-status', 'active');
    expect(rendered[2]).toHaveAttribute('data-status', 'upcoming');
  });

  it('renders skeleton rows while loading', () => {
    render(
      <TimelineSchedule
        title="Today's schedule"
        items={[]}
        loading
        loadingRowCount={2}
        data-testid="schedule"
      />,
    );

    expect(screen.getByTestId('schedule')).toHaveAttribute(
      'data-state',
      'loading',
    );
    const skel = screen.getByTestId('timeline-schedule-skeleton');
    expect(within(skel).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryAllByTestId('timeline-item')).toHaveLength(0);
  });

  it('renders the empty-state message when items is empty', () => {
    render(
      <TimelineSchedule
        title="Today's schedule"
        items={[]}
        emptyMessage="Nothing scheduled"
      />,
    );
    expect(screen.getByTestId('timeline-schedule-empty').textContent).toBe(
      'Nothing scheduled',
    );
  });

  it('renders an error state with role="alert" when error is set', () => {
    render(
      <TimelineSchedule
        title="Today's schedule"
        items={[]}
        error={new Error('boom')}
        data-testid="schedule"
      />,
    );

    const root = screen.getByTestId('schedule');
    expect(root).toHaveAttribute('role', 'alert');
    expect(root).toHaveAttribute('data-state', 'error');
  });

  it('shows a "now" marker on the active item when nowId is supplied', () => {
    render(
      <TimelineSchedule
        title="Today's schedule"
        items={items}
        nowId="b"
      />,
    );

    const marker = screen.getByTestId('timeline-now-marker');
    expect(marker).toBeInTheDocument();
  });
});
