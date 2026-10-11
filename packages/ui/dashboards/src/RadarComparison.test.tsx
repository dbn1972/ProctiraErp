import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RadarComparison, buildRadarRows, type RadarSeries } from './RadarComparison';

const axes = [
  { id: 'enrollment', label: 'Enrollment' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'pass_rate', label: 'Pass rate' },
];

const series: ReadonlyArray<RadarSeries> = [
  {
    id: 'cbse',
    label: 'CBSE',
    values: { enrollment: 80, attendance: 92, pass_rate: 88 },
  },
  {
    id: 'icse',
    label: 'ICSE',
    values: { enrollment: 65, attendance: 90, pass_rate: 91 },
  },
];

describe('<RadarComparison />', () => {
  it('renders the chart container when data is supplied', () => {
    render(
      <RadarComparison
        title="Board comparison"
        description="6-axis comparison"
        axes={axes}
        series={series}
        data-testid="radar"
      />,
    );

    const card = screen.getByTestId('radar');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(screen.getByText('Board comparison')).toBeInTheDocument();
    expect(screen.getByTestId('radar-comparison-chart')).toBeInTheDocument();
  });

  it('renders a skeleton when loading', () => {
    render(
      <RadarComparison
        title="Board comparison"
        axes={axes}
        series={[]}
        loading
        data-testid="radar"
      />,
    );

    expect(screen.getByTestId('radar')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('radar-comparison-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('radar-comparison-chart')).toBeNull();
  });

  it('renders the empty-state message when series is empty', () => {
    render(
      <RadarComparison
        title="Board comparison"
        axes={axes}
        series={[]}
        emptyMessage="No boards selected"
      />,
    );

    expect(screen.getByTestId('radar-comparison-empty').textContent).toBe('No boards selected');
  });

  it('renders an error state with role="alert" when error is set', () => {
    render(
      <RadarComparison
        title="Board comparison"
        axes={axes}
        series={[]}
        error={new Error('boom')}
        data-testid="radar"
      />,
    );

    expect(screen.getByTestId('radar')).toHaveAttribute('data-state', 'error');
    const err = screen.getByTestId('radar-comparison-error');
    expect(err).toHaveAttribute('role', 'alert');
  });
});

describe('buildRadarRows (PRC-M456)', () => {
  it('maps a missing metric to null, not 0', () => {
    const partial: ReadonlyArray<RadarSeries> = [
      { id: 'cbse', label: 'CBSE', values: { enrollment: 80 } }, // attendance/pass_rate missing
    ];
    const rows = buildRadarRows(axes, partial);
    const attendanceRow = rows.find((r) => r['axis'] === 'attendance')!;
    const enrollmentRow = rows.find((r) => r['axis'] === 'enrollment')!;
    expect(attendanceRow['cbse']).toBeNull();
    expect(attendanceRow['cbse']).not.toBe(0);
    expect(enrollmentRow['cbse']).toBe(80);
  });

  it('keeps real zero values distinct from missing ones', () => {
    const withZero: ReadonlyArray<RadarSeries> = [
      { id: 'icse', label: 'ICSE', values: { enrollment: 0 } },
    ];
    const rows = buildRadarRows(axes, withZero);
    const enrollmentRow = rows.find((r) => r['axis'] === 'enrollment')!;
    const passRow = rows.find((r) => r['axis'] === 'pass_rate')!;
    expect(enrollmentRow['icse']).toBe(0);
    expect(passRow['icse']).toBeNull();
  });
});
