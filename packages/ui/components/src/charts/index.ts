/**
 * @proctira/ui-components/charts — token-driven Recharts wrappers
 *
 * This module owns the bridge between the platform's CSS design tokens
 * (defined in `packages/ui/styles/theme.css`) and the Recharts primitives
 * used across dashboard surfaces. Wrappers read `--chart-1` … `--chart-5`,
 * `--foreground`, `--muted-foreground`, and `--border` at render time via
 * `getComputedStyle(document.documentElement)` and re-render whenever the
 * active theme class on `<html>` changes (Task 47.3, Requirement 36.5/36.6).
 *
 * Files:
 *   - `useChartPalette.ts` — hook exposing the resolved palette and the
 *     re-evaluation logic (MutationObserver + matchMedia listener).
 *   - `ThemedAxis.tsx` — `ThemedXAxis`, `ThemedYAxis`, `ThemedCartesianGrid`
 *     wrappers that paint stroke / tick colors from the palette.
 *   - `ThemedTooltip.tsx` — `ThemedTooltip` wrapper that paints
 *     `contentStyle`, `labelStyle`, and `itemStyle` from the palette.
 *   - `ThemedSeries.tsx` — `useSeriesColor`, `useSeriesColors`, and the
 *     optional `<ThemedSeries>` render-prop helper.
 *
 * ## Usage pattern
 *
 * Always wrap a recharts chart in `<ResponsiveContainer>` (sized by its
 * parent) and use the themed primitives in place of raw recharts axes,
 * grid, and tooltip components. Series get their fill from
 * `useSeriesColor(index)` so colors track the active theme.
 *
 * ```tsx
 * import {
 *   BarChart, Bar, ResponsiveContainer,
 * } from 'recharts';
 * import {
 *   ThemedXAxis, ThemedYAxis, ThemedCartesianGrid,
 *   ThemedTooltip, useSeriesColor,
 * } from '@proctira/ui-components/charts';
 *
 * export function EnrollmentBars({ data }: { data: Row[] }) {
 *   const primaryColor = useSeriesColor(0);
 *   const secondaryColor = useSeriesColor(1);
 *   return (
 *     <ResponsiveContainer width="100%" height={300}>
 *       <BarChart data={data}>
 *         <ThemedCartesianGrid />
 *         <ThemedXAxis dataKey="year" />
 *         <ThemedYAxis />
 *         <ThemedTooltip />
 *         <Bar dataKey="primary"   fill={primaryColor} />
 *         <Bar dataKey="secondary" fill={secondaryColor} />
 *       </BarChart>
 *     </ResponsiveContainer>
 *   );
 * }
 * ```
 *
 * ## Why wrappers, not className overrides
 *
 * Recharts emits SVG attributes (`stroke`, `fill`) directly; CSS variables
 * cannot be applied to SVG presentational attributes in older browsers.
 * Reading the resolved tokens once per theme change and passing literal
 * color strings to the recharts API is the only portable, dark-mode-safe
 * path. The `displayName` of each wrapper matches the original primitive
 * (`'XAxis'`, `'YAxis'`, `'Tooltip'`, `'CartesianGrid'`) so the recharts
 * chart-parent walker still discovers them as children — see the comment
 * blocks at the top of each component for details.
 *
 * Validates Task 47.3.
 */

export {
  CHART_TOKEN_NAMES,
  resolveChartPalette,
  useChartPalette,
  type ChartPalette,
  type ChartTokenName,
} from './useChartPalette';

export {
  ThemedXAxis,
  ThemedYAxis,
  ThemedCartesianGrid,
} from './ThemedAxis';

export { ThemedTooltip } from './ThemedTooltip';

export {
  CHART_SERIES_LENGTH,
  ThemedSeries,
  pickSeriesColor,
  useSeriesColor,
  useSeriesColors,
} from './ThemedSeries';
