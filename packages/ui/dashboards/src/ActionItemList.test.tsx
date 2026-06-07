import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import { LiveRegion } from '@proctira/ui-components';

import { ActionItemList, type ActionItem } from './ActionItemList';

const items: ReadonlyArray<ActionItem> = [
  {
    id: 'a',
    title: 'Approve transfer for Aarav S.',
    dueLabel: 'Due tomorrow',
    priority: 'high',
  },
  {
    id: 'b',
    title: 'Review staff timesheet',
    priority: 'medium',
  },
  {
    id: 'c',
    title: 'Order textbooks',
    priority: 'low',
    href: '/orders/textbooks',
  },
];

describe('<ActionItemList />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one row per item with the priority badge', () => {
    render(
      <ActionItemList
        title="Action items"
        items={items}
        data-testid="list"
      />,
    );

    const card = screen.getByTestId('list');
    expect(card).toHaveAttribute('data-state', 'ready');
    const rendered = screen.getAllByTestId('action-item-list-item');
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toHaveAttribute('data-priority', 'high');
    expect(rendered[1]).toHaveAttribute('data-priority', 'medium');
    expect(rendered[2]).toHaveAttribute('data-priority', 'low');
  });

  it('renders skeleton rows while loading', () => {
    render(
      <ActionItemList
        title="Action items"
        items={[]}
        loading
        loadingRowCount={2}
        data-testid="list"
      />,
    );

    const card = screen.getByTestId('list');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card).toHaveAttribute('aria-busy', 'true');
    const skel = screen.getByTestId('action-item-list-skeleton');
    expect(skel.children).toHaveLength(2);
  });

  it('renders the empty-state message when items is empty', () => {
    render(
      <ActionItemList
        title="Action items"
        items={[]}
        emptyMessage="All clear"
        data-testid="list"
      />,
    );

    expect(screen.getByTestId('action-item-list-empty')).toBeInTheDocument();
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('renders an inline error with role="alert" when error is set', () => {
    render(
      <ActionItemList
        title="Action items"
        items={[]}
        error={new Error('boom')}
        data-testid="list"
      />,
    );

    expect(screen.getByTestId('list')).toHaveAttribute('data-state', 'error');
    const err = screen.getByTestId('action-item-list-error');
    expect(err).toHaveAttribute('role', 'alert');
  });

  it('renders deep-link items as anchors and click handlers as buttons', () => {
    const onSelect = vi.fn();
    render(
      <ActionItemList
        title="Action items"
        items={items}
        onSelect={onSelect}
      />,
    );

    // The href item renders as an anchor.
    const link = screen.getByRole('link', {
      name: /Order textbooks/,
    });
    expect(link).toHaveAttribute('href', '/orders/textbooks');

    // Items without href use the click handler.
    fireEvent.click(
      screen.getByRole('button', {
        name: /Review staff timesheet/,
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it('announces high-priority items assertively after the loading→loaded transition', () => {
    render(<LiveRegion />);

    const { rerender } = render(
      <ActionItemList title="Action items" items={[]} loading />,
    );

    rerender(<ActionItemList title="Action items" items={items} />);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-assertive').textContent).toBe(
      '1 high-priority action item requires attention',
    );
  });
});
