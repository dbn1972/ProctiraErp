/**
 * ThemedSeries — helper for assigning token-driven colors to chart series.
 *
 * Recharts series components (`<Bar>`, `<Line>`, `<Area>`, `<Pie>`) accept
 * a `fill` or `stroke` prop directly. To keep callers free of literal
 * color values, this module exposes:
 *
 *   - `useSeriesColor(index)` — hook returning the color at slot
 *     `index % 5` from `--chart-1` … `--chart-5`.
 *   - `useSeriesColors()` — hook returning the full five-color tuple.
 *
 * Both wrap `useChartPalette()` and re-render automatically when the
 * theme changes. The cycling-by-modulo behaviour matches the convention
 * shadcn/ui's chart helpers use, so authors can declare an arbitrary
 * number of series and still pull from the canonical five-color ramp.
 *
 * Example:
 *   ```tsx
 *   function EnrollmentBars() {
 *     const colors = useSeriesColors();
 *     return (
 *       <BarChart data={data}>
 *         <ThemedXAxis dataKey="year" />
 *         <ThemedYAxis />
 *         <Bar dataKey="primary" fill={colors[0]} />
 *         <Bar dataKey="secondary" fill={colors[1]} />
 *       </BarChart>
 *     );
 *   }
 *   ```
 */

'use client';

import type { ReactElement, ReactNode } from 'react';

import { useChartPalette, type ChartPalette } from './useChartPalette';

/** Canonical length of the chart series ramp (`--chart-1` … `--chart-5`). */
export const CHART_SERIES_LENGTH = 5;

/**
 * Pick the color for a single series slot.
 *
 * @param index Zero-based series index. Negative or out-of-range values are
 *   wrapped via modulo so 0, 5, 10 all map to `--chart-1`. NaN inputs fall
 *   back to slot 0.
 */
export function useSeriesColor(index: number): string {
  const palette = useChartPalette();
  return pickSeriesColor(palette, index);
}

/**
 * Return the full five-color series tuple. Useful when authoring a chart
 * that needs all five colors at once (e.g. a Pie's `<Cell>` array).
 */
export function useSeriesColors(): ChartPalette['series'] {
  return useChartPalette().series;
}

/**
 * Pure version of {@link useSeriesColor} that takes the resolved palette.
 * Exposed so unit tests can drive the modulo logic without rendering.
 */
export function pickSeriesColor(palette: ChartPalette, index: number): string {
  const len = palette.series.length;
  if (!Number.isFinite(index)) return palette.series[0];
  // Force positive modulo so negative indices still resolve safely.
  const slot = ((Math.trunc(index) % len) + len) % len;
  // `noUncheckedIndexedAccess` widens `series[slot]` to `string | undefined`,
  // but the modulo guarantees `slot ∈ [0, len)` — so the lookup is safe.
  // Fall back to the first slot to keep the return type strictly `string`.
  return palette.series[slot] ?? palette.series[0];
}

/**
 * Convenience component that renders a hidden marker carrying a series
 * color via the `--chart-color` CSS variable. Kept for parity with shadcn's
 * `<ChartStyle>` pattern but rarely needed because callers usually pass
 * `fill={useSeriesColor(i)}` directly to `<Bar>` / `<Line>` / etc.
 *
 * Use only when interfacing with third-party recharts add-ons that look
 * for a `<ThemedSeries>` slot in the chart's children. Otherwise prefer
 * the hook form.
 */
export function ThemedSeries({
  index,
  children,
}: {
  index: number;
  children: (color: string) => ReactNode;
}): ReactElement {
  const color = useSeriesColor(index);
  return <>{children(color)}</>;
}
ThemedSeries.displayName = 'ThemedSeries';
