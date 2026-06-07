/**
 * Tests for `useChartPalette` and the supporting palette helpers.
 *
 * The hook bridges CSS custom properties to recharts string props. Because
 * jsdom does not implement the full CSS engine, these tests stub
 * `getComputedStyle` on `document.documentElement` and assert the hook
 * resolves each token correctly, falls back when tokens are unset, and
 * re-renders when the document attributes change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  CHART_TOKEN_NAMES,
  resolveChartPalette,
  useChartPalette,
  type ChartPalette,
} from './useChartPalette';
import { pickSeriesColor } from './ThemedSeries';

/**
 * Build a stub `getComputedStyle` that returns a `CSSStyleDeclaration`-like
 * object whose `getPropertyValue(name)` looks up `tokens[name]`. Anything
 * not in the map returns the empty string (matches real browser behaviour
 * for an undefined custom property).
 */
function stubComputedStyle(tokens: Record<string, string>): () => void {
  const original = window.getComputedStyle;
  const stub = ((_element: Element, _pseudo?: string) => {
    return {
      getPropertyValue(name: string) {
        // Real browsers return strings padded with leading whitespace; trim
        // here so the helper's `.trim()` exercises both shapes.
        return tokens[name] ?? '';
      },
    } as unknown as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;
  // Cast preserves arity for TypeScript.
  (window as unknown as { getComputedStyle: typeof window.getComputedStyle }).getComputedStyle =
    stub;
  return () => {
    (window as unknown as { getComputedStyle: typeof window.getComputedStyle }).getComputedStyle =
      original;
  };
}

const LIGHT_TOKENS: Record<string, string> = {
  '--chart-1': 'hsl(222, 47%, 31%)',
  '--chart-2': 'hsl(174, 62%, 30%)',
  '--chart-3': 'hsl(142, 71%, 28%)',
  '--chart-4': 'hsl(25, 90%, 38%)',
  '--chart-5': 'hsl(210, 92%, 45%)',
  '--foreground': 'hsl(222, 47%, 11%)',
  '--muted-foreground': 'hsl(215, 16%, 47%)',
  '--border': 'hsl(214, 32%, 91%)',
  '--background': 'hsl(0, 0%, 100%)',
};

const DARK_TOKENS: Record<string, string> = {
  '--chart-1': 'hsl(222, 55%, 60%)',
  '--chart-2': 'hsl(174, 70%, 55%)',
  '--chart-3': 'hsl(142, 71%, 55%)',
  '--chart-4': 'hsl(38, 92%, 60%)',
  '--chart-5': 'hsl(210, 92%, 60%)',
  '--foreground': 'hsl(210, 40%, 98%)',
  '--muted-foreground': 'hsl(215, 16%, 65%)',
  '--border': 'hsl(222, 47%, 20%)',
  '--background': 'hsl(222, 47%, 7%)',
};

describe('CHART_TOKEN_NAMES', () => {
  it('exposes the eight tokens the wrappers depend on', () => {
    expect(new Set(CHART_TOKEN_NAMES)).toEqual(
      new Set([
        '--chart-1',
        '--chart-2',
        '--chart-3',
        '--chart-4',
        '--chart-5',
        '--foreground',
        '--muted-foreground',
        '--border',
      ]),
    );
  });
});

describe('resolveChartPalette', () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it('reads every chart token from getComputedStyle on <html>', () => {
    restore = stubComputedStyle(LIGHT_TOKENS);

    const palette = resolveChartPalette();

    expect(palette.series).toEqual([
      LIGHT_TOKENS['--chart-1'],
      LIGHT_TOKENS['--chart-2'],
      LIGHT_TOKENS['--chart-3'],
      LIGHT_TOKENS['--chart-4'],
      LIGHT_TOKENS['--chart-5'],
    ]);
    expect(palette.axis).toBe(LIGHT_TOKENS['--border']);
    expect(palette.axisTick).toBe(LIGHT_TOKENS['--muted-foreground']);
    expect(palette.grid).toBe(LIGHT_TOKENS['--border']);
    expect(palette.tooltipBg).toBe(LIGHT_TOKENS['--background']);
    expect(palette.tooltipBorder).toBe(LIGHT_TOKENS['--border']);
    expect(palette.tooltipText).toBe(LIGHT_TOKENS['--foreground']);
    expect(palette.tooltipMuted).toBe(LIGHT_TOKENS['--muted-foreground']);
  });

  it('falls back to the light defaults when a token is unset', () => {
    // Provide only one token; everything else should fall back.
    restore = stubComputedStyle({ '--chart-1': 'hsl(0, 100%, 50%)' });

    const palette = resolveChartPalette();
    expect(palette.series[0]).toBe('hsl(0, 100%, 50%)');
    // Remaining series fall back to the canonical light defaults.
    expect(palette.series[1]).toBe('hsl(174, 62%, 30%)');
    expect(palette.axis).toBe('hsl(214, 32%, 91%)');
    expect(palette.tooltipText).toBe('hsl(222, 47%, 11%)');
  });

  it('returns dark-mode tokens when getComputedStyle reports them', () => {
    restore = stubComputedStyle(DARK_TOKENS);

    const palette = resolveChartPalette();
    expect(palette.series[0]).toBe(DARK_TOKENS['--chart-1']);
    expect(palette.tooltipText).toBe(DARK_TOKENS['--foreground']);
    expect(palette.tooltipBg).toBe(DARK_TOKENS['--background']);
  });

  it('survives a getComputedStyle that throws (jsdom edge case)', () => {
    const original = window.getComputedStyle;
    (window as unknown as { getComputedStyle: () => never }).getComputedStyle = () => {
      throw new Error('boom');
    };
    restore = () => {
      (window as unknown as { getComputedStyle: typeof window.getComputedStyle }).getComputedStyle =
        original;
    };

    const palette = resolveChartPalette();
    // Falls back to canonical light palette.
    expect(palette.series[0]).toBe('hsl(222, 47%, 31%)');
    expect(palette.axis).toBe('hsl(214, 32%, 91%)');
  });
});

describe('useChartPalette', () => {
  let restore: () => void = () => {};
  let unmountFns: Array<() => void> = [];
  beforeEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    // Unmount any hooks before mutating <html>, so the MutationObserver in
    // the hook's cleanup fires before the cleanup mutations and we don't
    // leak setState updates into the next test's act window.
    for (const fn of unmountFns) fn();
    unmountFns = [];
    restore();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.removeAttribute('data-theme');
  });

  it('returns the resolved palette on first render', () => {
    restore = stubComputedStyle(LIGHT_TOKENS);

    const { result, unmount } = renderHook(() => useChartPalette());
    unmountFns.push(unmount);
    expect(result.current.series[0]).toBe(LIGHT_TOKENS['--chart-1']);
    expect(result.current.tooltipText).toBe(LIGHT_TOKENS['--foreground']);
  });

  it('re-evaluates when the .dark class is toggled on <html>', async () => {
    // Start in light mode.
    let activeTokens: Record<string, string> = LIGHT_TOKENS;
    restore = stubComputedStyle(activeTokens);
    // Replace stub mid-test by swapping the underlying map reference.
    const swapTokens = (next: Record<string, string>) => {
      activeTokens = next;
      restore();
      restore = stubComputedStyle(activeTokens);
    };

    const { result, unmount } = renderHook(() => useChartPalette());
    unmountFns.push(unmount);
    expect(result.current.series[0]).toBe(LIGHT_TOKENS['--chart-1']);

    // Flip to dark mode. The MutationObserver fires asynchronously, so we
    // wrap the class toggle plus a microtask flush in `act` to keep React's
    // schedule consistent with the test's expectations.
    swapTokens(DARK_TOKENS);
    await act(async () => {
      document.documentElement.classList.add('dark');
      // jsdom delivers MutationObserver callbacks via macrotask, so a
      // setTimeout(0) is the most reliable flush. The setState the
      // observer fires settles before we leave act().
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.series[0]).toBe(DARK_TOKENS['--chart-1']);
    expect(result.current.tooltipText).toBe(DARK_TOKENS['--foreground']);
  });

  it('keeps a stable reference when the resolved palette is unchanged', async () => {
    restore = stubComputedStyle(LIGHT_TOKENS);

    const { result, rerender, unmount } = renderHook(() => useChartPalette());
    unmountFns.push(unmount);
    const first = result.current;

    // Trigger an attribute mutation that resolves to the same palette.
    document.documentElement.setAttribute('data-theme', 'light');
    // Give the MutationObserver a chance to fire and any setState inside
    // it to commit; the comparison runs after React has settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    rerender();
    expect(result.current).toBe(first);
  });
});

describe('pickSeriesColor', () => {
  const palette: ChartPalette = {
    series: ['c1', 'c2', 'c3', 'c4', 'c5'],
    axis: '#ax',
    axisTick: '#at',
    grid: '#gr',
    tooltipBg: '#bg',
    tooltipBorder: '#bd',
    tooltipText: '#tx',
    tooltipMuted: '#mu',
  };

  it('cycles indices with modulo 5', () => {
    expect(pickSeriesColor(palette, 0)).toBe('c1');
    expect(pickSeriesColor(palette, 4)).toBe('c5');
    expect(pickSeriesColor(palette, 5)).toBe('c1');
    expect(pickSeriesColor(palette, 12)).toBe('c3');
  });

  it('handles negative indices safely', () => {
    expect(pickSeriesColor(palette, -1)).toBe('c5');
    expect(pickSeriesColor(palette, -6)).toBe('c5');
  });

  it('coerces non-finite indices to slot 0', () => {
    expect(pickSeriesColor(palette, NaN)).toBe('c1');
    expect(pickSeriesColor(palette, Infinity)).toBe('c1');
  });
});
