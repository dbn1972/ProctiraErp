import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { KpiCardWithTrend } from './KpiCardWithTrend';

describe('<KpiCardWithTrend />', () => {
  it('renders the KPI value, trend, and sparkline when data is loaded', () => {
    render(
      <KpiCardWithTrend
        label="Attendance"
        value="92.4%"
        trend={{ direction: 'up', label: '+1.1%' }}
        series={[80, 82, 88, 90, 91, 92]}
        data-testid="kpi"
      />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('kpi-value').textContent).toBe('92.4%');
    expect(screen.getByTestId('kpi-trend')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-sparkline')).toBeInTheDocument();
  });

  it('renders skeletons (including the sparkline placeholder) while loading', () => {
    render(
      <KpiCardWithTrend
        label="Attendance"
        value="92.4%"
        loading
        data-testid="kpi"
      />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('kpi-sparkline-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-value')).toBeNull();
    expect(screen.queryByTestId('kpi-sparkline')).toBeNull();
  });

  it('hides the sparkline when fewer than two data points are available (empty/short series)', () => {
    render(
      <KpiCardWithTrend
        label="Attendance"
        value="92.4%"
        series={[]}
        data-testid="kpi"
      />,
    );
    expect(screen.queryByTestId('kpi-sparkline')).toBeNull();

    // Single-point series is treated the same way — there's nothing to draw.
    render(
      <KpiCardWithTrend
        label="Attendance"
        value="92.4%"
        series={[42]}
        data-testid="kpi-single"
      />,
    );
    expect(screen.queryByTestId('kpi-sparkline')).toBeNull();
  });

  it('renders an error state with role="alert" when error is set', () => {
    render(
      <KpiCardWithTrend
        label="Attendance"
        value="—"
        error={new Error('boom')}
        data-testid="kpi"
      />,
    );

    const card = screen.getByTestId('kpi');
    expect(card).toHaveAttribute('data-state', 'error');
    expect(card).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('kpi-sparkline')).toBeNull();
  });
});
