'use client';

/**
 * useChartPalette — Read the active theme's chart tokens from CSS custom
 * properties on `<html>` and return a stable object suitable for Recharts.
 *
 * Why this exists (Task 47.3 / Requirement 36.5, 36.6):
 *   - The platform stores all theme colors in CSS variables defined in
 *     `packages/ui/styles/theme.css` under `:root.light` / `:root.dark`.
 *   - Recharts axes, tooltips, and series take string colors as props (not
 *     CSS variables for SVG attributes). To keep charts in sync with light
 *     and dark mode without baking literals into JSX, we resolve the raw
 *     CSS values via `getComputedStyle(document.documentElement)` at render
 *     time and re-evaluate whenever the active theme class changes.
 *
 * SSR safety:
 *   - The hook returns a deterministic fallback palette during SSR (no
 *     `window` access) so charts render with the platform's light defaults
 *     until hydration. The first effect on the client reads the actual
 *     custom properties and updates state, triggering a re-render that
 *     paints the correct palette.
 *
 * Re-evaluation triggers:
 *   1. A `MutationObserver` watching `class` and `data-theme` attribute
 *      changes on `<html>` (covers `<ThemeProvider>` toggling .dark/.light
 *      and matchMedia-driven system flips).
 *   2. A `(prefers-color-scheme: dark)` matchMedia listener as a defense
 *      in depth — useful if a host page swaps the class without notifying
 *      our provider.
 */

import { useEffect, useState } from 'react';

/**
 * Names of every CSS custom property the chart palette reads. Kept as a
 * tuple so the resolved palette type is exhaustive and tests can assert
 * the contract without duplicating literals.
 */
export const CHART_TOKEN_NAMES = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--foreground',
  '--muted-foreground',
  '--border',
] as const;

export type ChartTokenName = (typeof CHART_TOKEN_NAMES)[number];

/**
 * Resolved chart palette. The five `series` entries map to `--chart-1` …
 * `--chart-5` in declaration order; `axis`, `axisTick`, `grid`, `tooltipBg`,
 * `tooltipBorder`, and `tooltipText` map to the typography/border tokens.
 */
export interface ChartPalette {
  /** Five-color series ramp drawn from `--chart-1` … `--chart-5`. */
  series: readonly [string, string, string, string, string];
  /** Stroke for axes (uses `--border`). */
  axis: string;
  /** Fill/stroke for axis tick labels (uses `--muted-foreground`). */
  axisTick: string;
  /** Stroke for cartesian grid lines (uses `--border`). */
  grid: string;
  /** Background of the floating tooltip card (uses `--background`). */
  tooltipBg: string;
  /** Border of the tooltip card (uses `--border`). */
  tooltipBorder: string;
  /** Foreground text inside the tooltip (uses `--foreground`). */
  tooltipText: string;
  /** Muted text for tooltip labels (uses `--muted-foreground`). */
  tooltipMuted: string;
}

/**
 * Conservative fallback palette used during SSR and before the first paint
 * resolves real CSS variables. Mirrors the canonical light defaults in
 * `packages/ui/styles/theme.css`.
 */
const FALLBACK_PALETTE: ChartPalette = {
  series: [
    'hsl(222, 47%, 31%)',
    'hsl(174, 62%, 30%)',
    'hsl(142, 71%, 28%)',
    'hsl(25, 90%, 38%)',
    'hsl(210, 92%, 45%)',
  ],
  axis: 'hsl(214, 32%, 91%)',
  axisTick: 'hsl(215, 16%, 47%)',
  grid: 'hsl(214, 32%, 91%)',
  tooltipBg: 'hsl(0, 0%, 100%)',
  tooltipBorder: 'hsl(214, 32%, 91%)',
  tooltipText: 'hsl(222, 47%, 11%)',
  tooltipMuted: 'hsl(215, 16%, 47%)',
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Read a single CSS custom property from `<html>`. Returns the raw string
 * exactly as authored in the stylesheet (e.g. `"hsl(222, 47%, 31%)"`).
 * Falls back to the supplied default when the variable is empty/unset or
 * `getComputedStyle` is unavailable.
 */
function readToken(name: ChartTokenName, fallback: string): string {
  if (!isBrowser()) return fallback;
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read an arbitrary CSS custom property name (not necessarily one of the
 * task-listed tokens) with the same SSR/error handling as `readToken`.
 * Internal helper used for `--background` (tooltip surface) which isn't
 * part of the contractual chart token list but is needed to keep tooltip
 * cards visually attached to the surrounding page surface.
 */
function readCssVar(name: string, fallback: string): string {
  if (!isBrowser()) return fallback;
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve a complete `ChartPalette` from CSS custom properties on `<html>`.
 * Exposed for tests so they can drive the resolution directly with a
 * mocked `getComputedStyle`. Production callers should use the
 * `useChartPalette()` hook instead.
 */
export function resolveChartPalette(): ChartPalette {
  return {
    series: [
      readToken('--chart-1', FALLBACK_PALETTE.series[0]),
      readToken('--chart-2', FALLBACK_PALETTE.series[1]),
      readToken('--chart-3', FALLBACK_PALETTE.series[2]),
      readToken('--chart-4', FALLBACK_PALETTE.series[3]),
      readToken('--chart-5', FALLBACK_PALETTE.series[4]),
    ],
    axis: readToken('--border', FALLBACK_PALETTE.axis),
    axisTick: readToken('--muted-foreground', FALLBACK_PALETTE.axisTick),
    grid: readToken('--border', FALLBACK_PALETTE.grid),
    tooltipBg: readCssVar('--background', FALLBACK_PALETTE.tooltipBg),
    tooltipBorder: readToken('--border', FALLBACK_PALETTE.tooltipBorder),
    tooltipText: readToken('--foreground', FALLBACK_PALETTE.tooltipText),
    tooltipMuted: readToken('--muted-foreground', FALLBACK_PALETTE.tooltipMuted),
  };
}

/**
 * Reactively read the active chart palette from CSS custom properties.
 *
 * The hook subscribes to `<html>` `class` / `data-theme` mutations and to
 * `(prefers-color-scheme: dark)` so any theme switch — provider-driven or
 * external — refreshes the palette immediately. The returned object is
 * stable (referentially equal) until tokens actually change.
 */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(() => {
    if (!isBrowser()) return FALLBACK_PALETTE;
    return resolveChartPalette();
  });

  useEffect(() => {
    if (!isBrowser()) return;

    const refresh = () => {
      const next = resolveChartPalette();
      setPalette((prev) => (palettesEqual(prev, next) ? prev : next));
    };

    // Initial sync after mount — handles the SSR → CSR handoff.
    refresh();

    // Watch <html> class / data-theme changes (ThemeProvider toggles both).
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });

    // Defense in depth: also listen to system preference changes for the
    // case where another piece of code swaps tokens without touching the
    // class list.
    let mediaQuery: MediaQueryList | null = null;
    let mediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaHandler = () => refresh();
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', mediaHandler);
      }
    }

    return () => {
      observer.disconnect();
      if (mediaQuery && mediaHandler) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', mediaHandler);
        }
      }
    };
  }, []);

  return palette;
}

/**
 * Shallow equality check for two palettes. Used to keep the hook's
 * returned reference stable across no-op refreshes (avoids forcing
 * downstream charts to re-render needlessly).
 */
function palettesEqual(a: ChartPalette, b: ChartPalette): boolean {
  if (a === b) return true;
  if (
    a.axis !== b.axis ||
    a.axisTick !== b.axisTick ||
    a.grid !== b.grid ||
    a.tooltipBg !== b.tooltipBg ||
    a.tooltipBorder !== b.tooltipBorder ||
    a.tooltipText !== b.tooltipText ||
    a.tooltipMuted !== b.tooltipMuted
  ) {
    return false;
  }
  for (let i = 0; i < a.series.length; i++) {
    if (a.series[i] !== b.series[i]) return false;
  }
  return true;
}
