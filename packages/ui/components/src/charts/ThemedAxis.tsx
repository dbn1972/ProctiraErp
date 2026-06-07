/**
 * ThemedXAxis / ThemedYAxis — token-driven Recharts axis wrappers.
 *
 * Why two named components instead of one polymorphic component:
 *   Recharts identifies axis children inside `<LineChart>` / `<BarChart>`
 *   etc. by inspecting `child.type.displayName` against the literal strings
 *   `'XAxis'` and `'YAxis'` (see `recharts/util/ReactUtils.findAllByType`).
 *   A wrapper that simply returns `<XAxis />` does NOT count as an axis
 *   child unless it carries the same displayName. That's why we set
 *   `ThemedXAxis.displayName = 'XAxis'` and likewise for Y — recharts
 *   treats the wrapper itself as the axis declaration. The chart parser
 *   walks the children, finds our wrapper (named `XAxis`), then renders
 *   the actual `<XAxis>` element it returns.
 *
 *   Because recharts also inspects child *props* directly (e.g. `dataKey`,
 *   `xAxisId`) on the matched child to build the axis map, we forward every
 *   prop unchanged. The palette-derived defaults (stroke, tick fill, tick
 *   line stroke) are merged with caller overrides so consumers can still
 *   tweak any one detail without losing dark-mode awareness.
 *
 * Usage:
 *   ```tsx
 *   <LineChart data={...}>
 *     <ThemedXAxis dataKey="month" />
 *     <ThemedYAxis />
 *     ...
 *   </LineChart>
 *   ```
 */

'use client';

import type { ComponentProps } from 'react';
import { XAxis, YAxis, CartesianGrid } from 'recharts';

import { useChartPalette } from './useChartPalette';

type XAxisProps = ComponentProps<typeof XAxis>;
type YAxisProps = ComponentProps<typeof YAxis>;
type CartesianGridProps = ComponentProps<typeof CartesianGrid>;

/**
 * Drop-in replacement for Recharts `<XAxis>` that paints stroke and tick
 * colors from the active theme tokens (`--border`, `--muted-foreground`).
 * All other props are forwarded unchanged.
 */
export function ThemedXAxis(props: XAxisProps) {
  const palette = useChartPalette();
  return (
    <XAxis
      stroke={palette.axis}
      tick={{ fill: palette.axisTick, fontSize: 12 }}
      tickLine={{ stroke: palette.axis }}
      axisLine={{ stroke: palette.axis }}
      {...props}
    />
  );
}
// Recharts identifies axis children by displayName; mimic the original so
// `<LineChart>` / `<BarChart>` / etc. recognise the wrapper as an XAxis.
ThemedXAxis.displayName = 'XAxis';

/**
 * Drop-in replacement for Recharts `<YAxis>` with the same token-driven
 * defaults as {@link ThemedXAxis}.
 */
export function ThemedYAxis(props: YAxisProps) {
  const palette = useChartPalette();
  return (
    <YAxis
      stroke={palette.axis}
      tick={{ fill: palette.axisTick, fontSize: 12 }}
      tickLine={{ stroke: palette.axis }}
      axisLine={{ stroke: palette.axis }}
      {...props}
    />
  );
}
ThemedYAxis.displayName = 'YAxis';

/**
 * Drop-in replacement for Recharts `<CartesianGrid>` whose stroke comes
 * from the `--border` token. Provided alongside the axis wrappers because
 * gridlines also need to invert between light and dark modes.
 */
export function ThemedCartesianGrid(props: CartesianGridProps) {
  const palette = useChartPalette();
  return (
    <CartesianGrid
      stroke={palette.grid}
      strokeDasharray="3 3"
      {...props}
    />
  );
}
ThemedCartesianGrid.displayName = 'CartesianGrid';
