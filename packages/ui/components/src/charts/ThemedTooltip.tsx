/**
 * ThemedTooltip — token-driven Recharts `<Tooltip>` wrapper.
 *
 * Recharts identifies the tooltip child by displayName (`'Tooltip'`) the
 * same way it finds axes, so the wrapper is exposed under that name. The
 * styled defaults paint the tooltip surface with `--background`, the
 * border with `--border`, the heading text with `--foreground`, and the
 * series labels with `--muted-foreground`. Caller overrides on
 * `contentStyle`, `labelStyle`, `itemStyle`, `cursor` win — defaults are
 * merged in beneath them.
 *
 * Usage:
 *   ```tsx
 *   <BarChart data={...}>
 *     <ThemedTooltip />
 *     ...
 *   </BarChart>
 *   ```
 */

'use client';

import type { ComponentProps, CSSProperties } from 'react';
import { Tooltip } from 'recharts';

import { useChartPalette } from './useChartPalette';

type TooltipProps = ComponentProps<typeof Tooltip>;

export function ThemedTooltip(props: TooltipProps) {
  const palette = useChartPalette();

  const contentStyle: CSSProperties = {
    backgroundColor: palette.tooltipBg,
    border: `1px solid ${palette.tooltipBorder}`,
    borderRadius: 6,
    color: palette.tooltipText,
    fontSize: 12,
    boxShadow: 'var(--shadow-md)',
    ...props.contentStyle,
  };

  const labelStyle: CSSProperties = {
    color: palette.tooltipText,
    fontWeight: 600,
    ...props.labelStyle,
  };

  const itemStyle: CSSProperties = {
    color: palette.tooltipMuted,
    ...props.itemStyle,
  };

  // The cursor (the bar/line that follows the pointer) defaults to the
  // semi-transparent muted token so it doesn't blow out in dark mode.
  // Callers can override by passing `cursor={...}` explicitly.
  const cursor =
    props.cursor === undefined
      ? { fill: palette.tooltipMuted, fillOpacity: 0.1 }
      : props.cursor;

  return (
    <Tooltip
      {...props}
      cursor={cursor}
      contentStyle={contentStyle}
      labelStyle={labelStyle}
      itemStyle={itemStyle}
    />
  );
}
// Match the original Recharts displayName so chart parents recognize the
// wrapper as the tooltip slot.
ThemedTooltip.displayName = 'Tooltip';
