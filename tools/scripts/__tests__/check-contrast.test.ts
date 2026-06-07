/**
 * Tests for the semantic-token contrast CI gate (task 56.2 / Requirement 37 AC 2).
 *
 * Covers the small library surface exposed by `check-contrast.mjs`:
 *   - `parseHsl` accepts the formats theme.css uses and rejects garbage
 *   - `hslToRgb` agrees with hand-computed reference values
 *   - `relativeLuminance` matches the WCAG formula for known colors
 *   - `contrastRatio` returns 21:1 for white-on-black (the spec maximum)
 *   - `parseThemeBlocks` extracts the `:root, :root.light` and `:root.dark`
 *     declarations from a synthetic stylesheet
 *   - `evaluatePairs` returns a structured pass/fail per pair
 *   - `isFailureWaivedByBaseline` only waives non-regressing pairs
 *
 * The unit ratios below are computed against the WCAG 2.1 reference
 * formula. White-on-black is the canonical example because it produces
 * the highest possible ratio (21:1) and is impervious to floating-point
 * noise.
 */

import { describe, it, expect } from 'vitest';

// @ts-expect-error - direct .mjs import; types are not generated.
import * as gate from '../check-contrast.mjs';

describe('parseHsl', () => {
  it('parses comma-separated hsl(h, s%, l%)', () => {
    expect(gate.parseHsl('hsl(222, 47%, 11%)')).toEqual({
      h: 222,
      s: 0.47,
      l: 0.11,
    });
  });

  it('parses space-separated hsl values', () => {
    expect(gate.parseHsl('hsl(222 47% 11%)')).toEqual({
      h: 222,
      s: 0.47,
      l: 0.11,
    });
  });

  it('tolerates extra whitespace', () => {
    const out = gate.parseHsl('  hsl(  0 ,   0%  ,   100% )  ');
    expect(out.h).toBe(0);
    expect(out.s).toBe(0);
    expect(out.l).toBe(1);
  });

  it('normalizes hue into [0, 360)', () => {
    expect(gate.parseHsl('hsl(360, 0%, 0%)').h).toBe(0);
    expect(gate.parseHsl('hsl(-30, 0%, 0%)').h).toBe(330);
  });

  it('throws on unparseable input', () => {
    expect(() => gate.parseHsl('rgb(0, 0, 0)')).toThrow(/cannot parse/);
    expect(() => gate.parseHsl('not-a-color')).toThrow(/cannot parse/);
  });
});

describe('hslToRgb', () => {
  it('returns pure white for hsl(0, 0%, 100%)', () => {
    const rgb = gate.hslToRgb({ h: 0, s: 0, l: 1 });
    expect(rgb.r).toBeCloseTo(1, 6);
    expect(rgb.g).toBeCloseTo(1, 6);
    expect(rgb.b).toBeCloseTo(1, 6);
  });

  it('returns pure black for hsl(0, 0%, 0%)', () => {
    const rgb = gate.hslToRgb({ h: 0, s: 0, l: 0 });
    expect(rgb.r).toBeCloseTo(0, 6);
    expect(rgb.g).toBeCloseTo(0, 6);
    expect(rgb.b).toBeCloseTo(0, 6);
  });

  it('returns mid-saturation primary red for hsl(0, 100%, 50%)', () => {
    const rgb = gate.hslToRgb({ h: 0, s: 1, l: 0.5 });
    expect(rgb.r).toBeCloseTo(1, 6);
    expect(rgb.g).toBeCloseTo(0, 6);
    expect(rgb.b).toBeCloseTo(0, 6);
  });

  it('returns 50% gray for hsl(0, 0%, 50%)', () => {
    const rgb = gate.hslToRgb({ h: 0, s: 0, l: 0.5 });
    expect(rgb.r).toBeCloseTo(0.5, 6);
    expect(rgb.g).toBeCloseTo(0.5, 6);
    expect(rgb.b).toBeCloseTo(0.5, 6);
  });
});

describe('relativeLuminance', () => {
  it('returns 1.0 for pure white', () => {
    expect(gate.relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 6);
  });

  it('returns 0.0 for pure black', () => {
    expect(gate.relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
  });

  it('agrees with the WCAG reference value for primary red sRGB(255,0,0)', () => {
    // L = 0.2126 * gamma(1) = 0.2126
    expect(gate.relativeLuminance({ r: 1, g: 0, b: 0 })).toBeCloseTo(0.2126, 4);
  });

  it('agrees with the WCAG reference value for primary green sRGB(0,255,0)', () => {
    expect(gate.relativeLuminance({ r: 0, g: 1, b: 0 })).toBeCloseTo(0.7152, 4);
  });

  it('agrees with the WCAG reference value for primary blue sRGB(0,0,255)', () => {
    expect(gate.relativeLuminance({ r: 0, g: 0, b: 1 })).toBeCloseTo(0.0722, 4);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for white on black', () => {
    const Lw = gate.relativeLuminance({ r: 1, g: 1, b: 1 });
    const Lb = gate.relativeLuminance({ r: 0, g: 0, b: 0 });
    expect(gate.contrastRatio(Lw, Lb)).toBeCloseTo(21, 4);
    // Symmetric: same ratio with arguments reversed.
    expect(gate.contrastRatio(Lb, Lw)).toBeCloseTo(21, 4);
  });

  it('returns 1:1 for identical colors', () => {
    const L = gate.relativeLuminance({ r: 0.4, g: 0.4, b: 0.4 });
    expect(gate.contrastRatio(L, L)).toBeCloseTo(1, 6);
  });
});

describe('contrastForHsl', () => {
  it('returns 21:1 for hsl(0,0%,100%) on hsl(0,0%,0%)', () => {
    expect(gate.contrastForHsl('hsl(0, 0%, 100%)', 'hsl(0, 0%, 0%)')).toBeCloseTo(21, 4);
  });

  it('clears 7:1 for the platform default body text pair', () => {
    // Light mode body text from theme.css: foreground = hsl(222, 47%, 11%)
    // on background = hsl(0, 0%, 100%). This is the anchor pair Requirement
    // 37 AC 2 explicitly calls out, so it MUST stay above 7:1.
    const ratio = gate.contrastForHsl('hsl(222, 47%, 11%)', 'hsl(0, 0%, 100%)');
    expect(ratio).toBeGreaterThanOrEqual(7);
  });
});

describe('parseThemeBlocks', () => {
  const fixture = `
    /* a comment with :root.dark inside should not match */
    @layer base {
      html { font-size: var(--font-size, 18px); }
    }

    :root, :root.light {
      --font-size: 18px;
      --background: hsl(0, 0%, 100%);
      --foreground: hsl(222, 47%, 11%);
      --primary: hsl(222, 47%, 31%);
      --primary-foreground: hsl(0, 0%, 100%);
    }

    :root.dark {
      --background: hsl(222, 47%, 7%);
      --foreground: hsl(210, 40%, 98%);
      --primary: hsl(222, 47%, 52%);
      /* primary-foreground intentionally omitted to test inheritance */
    }

    @theme inline {
      --color-background: var(--background);
    }
  `;

  it('extracts every direct declaration in the light block', () => {
    const { light } = gate.parseThemeBlocks(fixture);
    expect(light['--background']).toBe('hsl(0, 0%, 100%)');
    expect(light['--foreground']).toBe('hsl(222, 47%, 11%)');
    expect(light['--primary']).toBe('hsl(222, 47%, 31%)');
    expect(light['--primary-foreground']).toBe('hsl(0, 0%, 100%)');
  });

  it('extracts the dark-mode overrides only', () => {
    const { dark } = gate.parseThemeBlocks(fixture);
    expect(dark['--background']).toBe('hsl(222, 47%, 7%)');
    expect(dark['--foreground']).toBe('hsl(210, 40%, 98%)');
    expect(dark['--primary']).toBe('hsl(222, 47%, 52%)');
    // Dark block does not redeclare primary-foreground.
    expect(dark['--primary-foreground']).toBeUndefined();
  });

  it('does NOT pull declarations from @theme inline or @layer base blocks', () => {
    const { light } = gate.parseThemeBlocks(fixture);
    // The @theme block declares --color-background; the gate must not pick
    // it up as a light-mode token because its semantic shape is different.
    expect(light['--color-background']).toBeUndefined();
  });

  it('ignores selectors that look similar but appear inside comments', () => {
    // The fixture has a `:root.dark` mention inside a comment. The parser
    // must not interpret that as a real selector.
    const onlyComment = `/* :root.dark { --foo: 1; } */`;
    const { light, dark } = gate.parseThemeBlocks(onlyComment);
    expect(light).toEqual({});
    expect(dark).toEqual({});
  });
});

describe('evaluatePairs', () => {
  const tokens = {
    '--foreground': 'hsl(0, 0%, 0%)',
    '--background': 'hsl(0, 0%, 100%)',
    '--primary': 'hsl(222, 47%, 31%)',
    '--primary-foreground': 'hsl(0, 0%, 100%)',
    '--accent': 'hsl(174, 62%, 40%)',
    '--accent-foreground': 'hsl(0, 0%, 100%)',
  };

  it('marks the white-on-black pair as passing at 7:1', () => {
    const rows = gate.evaluatePairs(
      tokens,
      [{ name: 'fg/bg', foreground: '--foreground', background: '--background' }],
      7,
    );
    expect(rows[0].passes).toBe(true);
    expect(rows[0].ratio).toBeCloseTo(21, 4);
  });

  it('marks an under-threshold pair as failing', () => {
    const rows = gate.evaluatePairs(
      tokens,
      [{ name: 'a-fg/a', foreground: '--accent-foreground', background: '--accent' }],
      7,
    );
    expect(rows[0].passes).toBe(false);
    expect(rows[0].ratio).toBeLessThan(7);
    expect(rows[0].error).toBeNull();
  });

  it('reports an explicit error when a token is missing', () => {
    const rows = gate.evaluatePairs(
      { '--foreground': 'hsl(0, 0%, 0%)' },
      [{ name: 'fg/bg', foreground: '--foreground', background: '--background' }],
      7,
    );
    expect(rows[0].passes).toBe(false);
    expect(rows[0].ratio).toBeNull();
    expect(rows[0].error).toMatch(/--background/);
  });
});

describe('isFailureWaivedByBaseline', () => {
  it('waives a row that exists in the baseline at or above the recorded ratio', () => {
    const baseline = new Map([['error / error-bg', 4.23]]);
    const row = {
      name: 'error / error-bg',
      ratio: 4.24, // slightly higher than baseline → still allow-listed
      passes: false,
    };
    expect(gate.isFailureWaivedByBaseline(row, baseline)).toBe(true);
  });

  it('does NOT waive a row whose ratio regresses below baseline', () => {
    const baseline = new Map([['error / error-bg', 4.23]]);
    const row = {
      name: 'error / error-bg',
      ratio: 4.0, // worse than baseline → MUST fail the gate
      passes: false,
    };
    expect(gate.isFailureWaivedByBaseline(row, baseline)).toBe(false);
  });

  it('does NOT waive a row that is not in the baseline at all', () => {
    const baseline = new Map([['error / error-bg', 4.23]]);
    const row = {
      name: 'foreground / background',
      ratio: 6.5,
      passes: false,
    };
    expect(gate.isFailureWaivedByBaseline(row, baseline)).toBe(false);
  });

  it('returns false when no baseline is provided', () => {
    expect(gate.isFailureWaivedByBaseline({ name: 'x', ratio: 1, passes: false }, undefined)).toBe(
      false,
    );
  });
});

describe('SEMANTIC_PAIRS', () => {
  it('covers every semantic token enumerated in Requirement 37 AC 2', () => {
    const names = gate.SEMANTIC_PAIRS.map((p: { name: string }) => p.name);
    // Requirement 37 AC 2 enumerates: background, foreground, primary,
    // accent, success, warning, error, info, muted. The pair list must
    // exercise each one against its semantic counterpart.
    expect(names).toContain('foreground / background');
    expect(names).toContain('primary-foreground / primary');
    expect(names).toContain('accent-foreground / accent');
    expect(names).toContain('muted-foreground / muted');
    expect(names).toContain('success / success-bg');
    expect(names).toContain('warning / warning-bg');
    expect(names).toContain('error / error-bg');
    expect(names).toContain('info / info-bg');
  });
});
