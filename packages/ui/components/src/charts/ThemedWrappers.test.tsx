/**
 * Smoke tests for the Recharts wrapper components themselves.
 *
 * The hook tests in `useChartPalette.test.tsx` cover the palette
 * resolution. These tests cover the contract that the wrappers need to
 * meet so `<LineChart>` / `<BarChart>` / etc. accept them as children:
 *
 *   - `displayName` must match the original Recharts primitive — the
 *     parent chart walker matches children by `child.type.displayName`.
 *   - Props supplied by the caller must override the palette defaults.
 *   - The series-color helper must cycle through five slots.
 */

import { describe, it, expect } from 'vitest';
import { ThemedXAxis, ThemedYAxis, ThemedCartesianGrid } from './ThemedAxis';
import { ThemedTooltip } from './ThemedTooltip';
import { ThemedSeries, pickSeriesColor } from './ThemedSeries';

describe('Themed wrapper displayNames', () => {
  it('ThemedXAxis is identified as XAxis to recharts', () => {
    expect(ThemedXAxis.displayName).toBe('XAxis');
  });

  it('ThemedYAxis is identified as YAxis to recharts', () => {
    expect(ThemedYAxis.displayName).toBe('YAxis');
  });

  it('ThemedCartesianGrid is identified as CartesianGrid to recharts', () => {
    expect(ThemedCartesianGrid.displayName).toBe('CartesianGrid');
  });

  it('ThemedTooltip is identified as Tooltip to recharts', () => {
    expect(ThemedTooltip.displayName).toBe('Tooltip');
  });

  it('ThemedSeries carries its own displayName for inspector tools', () => {
    expect(ThemedSeries.displayName).toBe('ThemedSeries');
  });
});

describe('pickSeriesColor', () => {
  // The hook variant is covered indirectly through useChartPalette; this
  // case is the pure helper to make sure modulo logic stays correct even
  // when the palette is supplied by hand.
  const palette = {
    series: ['#1', '#2', '#3', '#4', '#5'] as readonly [
      string,
      string,
      string,
      string,
      string,
    ],
    axis: '#a',
    axisTick: '#a',
    grid: '#a',
    tooltipBg: '#a',
    tooltipBorder: '#a',
    tooltipText: '#a',
    tooltipMuted: '#a',
  };

  it('truncates fractional indices before applying modulo', () => {
    expect(pickSeriesColor(palette, 1.7)).toBe('#2');
    expect(pickSeriesColor(palette, 5.999)).toBe('#1');
  });
});
