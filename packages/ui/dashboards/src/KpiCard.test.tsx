import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { LiveRegion } from '@proctira/ui-components';

import { KpiCard } from './KpiCard';

/**
 * Validates Task 52.5: the KpiCard widget supports loading / data /
 * error states, renders trend indicators with the correct semantic
 * tone, and announces loading→loaded transitions through the global
 * <LiveRegion>.
 */
describe('<KpiCard />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the label, value, trend, and description when data is loaded', () => {
    render(
      <KpiCard
        label="Total students"
        value="12,480"
        description="vs last term"
        trend={{ direction: 'up', label: '+3.2%' }}
        data-testid="kpi"
      />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(card).not.toHaveAttribute('aria-busy');

    expect(screen.getByText('Total students')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-value').textContent).toBe('12,480');
    expect(screen.getByText('vs last term')).toBeInTheDocument();

    const trend = screen.getByTestId('kpi-trend');
    expect(trend).toHaveAttribute('data-direction', 'up');
    expect(trend.textContent).toContain('+3.2%');
  });

  it('renders skeleton placeholders when loading is true', () => {
    render(
      <KpiCard
        label="Total students"
        value="12,480"
        loading
        icon={<span data-testid="icon" />}
        data-testid="kpi"
      />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('kpi-skeleton-label')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-skeleton-value')).toBeInTheDocument();
    // The live KPI value/trend must not render while loading.
    expect(screen.queryByTestId('kpi-value')).toBeNull();
    expect(screen.queryByTestId('kpi-trend')).toBeNull();
  });

  it('renders an inline error state with role="alert" when error is set', () => {
    render(
      <KpiCard label="Total students" value="12,480" error={new Error('boom')} data-testid="kpi" />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'error');
    expect(card).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Unable to load this metric.')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-value')).toBeNull();
  });

  it('announces loading→loaded transitions through <LiveRegion>', () => {
    render(<LiveRegion />);

    const { rerender } = render(<KpiCard label="Total students" value="12,480" loading />);

    // Still loading — region is empty.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('live-region-polite').textContent).toBe('');

    rerender(<KpiCard label="Total students" value="12,480" />);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('live-region-polite').textContent).toBe('Total students loaded');
  });

  it('announces error transitions assertively', () => {
    render(<LiveRegion />);

    const { rerender } = render(<KpiCard label="Pass rate" value="—" loading />);

    rerender(<KpiCard label="Pass rate" value="—" error={new Error('boom')} />);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('live-region-assertive').textContent).toBe(
      'Pass rate failed to load',
    );
  });
});
