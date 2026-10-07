/**
 * Accessibility Validation Tests
 *
 * Tests for color parsing, contrast ratio calculation, and theme accessibility validation.
 */
import { describe, it, expect } from 'vitest';

import {
  hexToRgb,
  hslToRgb,
  parseColor,
  relativeLuminance,
  contrastRatio,
  validateAccessibility,
} from './accessibility.js';
import type { ThemeTokens } from './schemas.js';

describe('hexToRgb', () => {
  it('should parse 6-digit hex colors', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#3366cc')).toEqual({ r: 51, g: 102, b: 204 });
  });

  it('should parse 3-digit hex colors', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should return null for invalid hex', () => {
    // PRC-M393: non-hex digits must not yield NaN channels
    expect(hexToRgb('#gg0000')).toBeNull();
    expect(hexToRgb('#zzzzzz')).toBeNull();
    expect(hexToRgb('#12')).toBeNull();
  });
});

describe('hslToRgb', () => {
  it('should parse HSL colors', () => {
    // Pure red: hsl(0, 100%, 50%)
    const red = hslToRgb('hsl(0, 100%, 50%)');
    expect(red).toEqual({ r: 255, g: 0, b: 0 });

    // Pure white: hsl(0, 0%, 100%)
    const white = hslToRgb('hsl(0, 0%, 100%)');
    expect(white).toEqual({ r: 255, g: 255, b: 255 });

    // Pure black: hsl(0, 0%, 0%)
    const black = hslToRgb('hsl(0, 0%, 0%)');
    expect(black).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('should return null for invalid HSL', () => {
    expect(hslToRgb('not-a-color')).toBeNull();
    expect(hslToRgb('rgb(255, 0, 0)')).toBeNull();
  });
});

describe('parseColor', () => {
  it('should parse hex colors', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should parse HSL colors', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should return null for unsupported formats', () => {
    expect(parseColor('red')).toBeNull();
    expect(parseColor('#zzzzzz')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('hsl(400, 50%, 50%)')).toBeNull();
  });

  it('should parse rgb() and 8-digit hex', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('relativeLuminance', () => {
  it('should calculate luminance for white', () => {
    const lum = relativeLuminance(255, 255, 255);
    expect(lum).toBeCloseTo(1.0, 4);
  });

  it('should calculate luminance for black', () => {
    const lum = relativeLuminance(0, 0, 0);
    expect(lum).toBeCloseTo(0.0, 4);
  });
});

describe('contrastRatio', () => {
  it('should return 21:1 for black on white', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should return 1:1 for same colors', () => {
    const ratio = contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 });
    expect(ratio).toBeCloseTo(1, 4);
  });

  it('should be symmetric', () => {
    const color1 = { r: 51, g: 102, b: 204 };
    const color2 = { r: 255, g: 255, b: 255 };
    const ratio1 = contrastRatio(color1, color2);
    const ratio2 = contrastRatio(color2, color1);
    expect(ratio1).toBeCloseTo(ratio2, 4);
  });
});

describe('validateAccessibility', () => {
  function baseTokens(): ThemeTokens {
    return {
      colors: {
        primary: '#1a56db',
        background: '#ffffff',
        surface: '#f9fafb',
        textPrimary: '#111827',
        textSecondary: '#4b5563',
        onPrimary: '#ffffff',
        onSecondary: '#ffffff',
        onError: '#ffffff',
        error: '#dc2626',
        secondary: '#6b7280',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        baseFontSize: 16,
        lineHeight: 1.5,
      },
      spacing: { unit: 4 },
    };
  }

  it('should pass for accessible tokens', () => {
    const result = validateAccessibility(baseTokens());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('should fail for font size below 12px', () => {
    const tokens = baseTokens();
    tokens.typography.baseFontSize = 10;
    const result = validateAccessibility(tokens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'font-size')).toBe(true);
  });

  it('should fail for line height below 1.2', () => {
    const tokens = baseTokens();
    tokens.typography.lineHeight = 1.0;
    const result = validateAccessibility(tokens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'line-height')).toBe(true);
  });

  it('should fail for low contrast text on background', () => {
    const tokens = baseTokens();
    // Light gray text on white background - very low contrast
    tokens.colors.textPrimary = '#cccccc';
    tokens.colors.background = '#ffffff';
    const result = validateAccessibility(tokens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'contrast-ratio')).toBe(true);
  });

  it('PRC-M393: fails when the mandatory textPrimary/background pair is missing', () => {
    const tokens: ThemeTokens = {
      colors: {
        primary: '#1a56db',
        // No textPrimary or background defined
      },
      typography: {
        fontFamily: 'Inter',
        baseFontSize: 16,
        lineHeight: 1.5,
      },
      spacing: { unit: 4 },
    };
    const result = validateAccessibility(tokens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'color-missing')).toBe(true);
  });

  it('PRC-M393: missing textPrimary alone fails', () => {
    const tokens = baseTokens();
    delete tokens.colors.textPrimary;
    expect(validateAccessibility(tokens).valid).toBe(false);
  });

  it('PRC-M393: half-defined optional pair fails', () => {
    const tokens = baseTokens();
    delete tokens.colors.onError;
    expect(validateAccessibility(tokens).valid).toBe(false);
  });

  it('PRC-M393: unparsable colors are errors, not warnings', () => {
    for (const bad of ['#zzzzzz', 'red']) {
      const tokens = baseTokens();
      tokens.colors.textPrimary = bad;
      const result = validateAccessibility(tokens);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'color-parse' && i.severity === 'error')).toBe(
        true,
      );
    }
  });

  it('PRC-M393: 18px body text still needs 4.5:1 (large-text 3:1 only at >=24px)', () => {
    const tokens = baseTokens();
    tokens.typography.baseFontSize = 18;
    // #949494 on white is ~3.03:1: passes 3:1, fails 4.5:1
    tokens.colors.textPrimary = '#949494';
    expect(validateAccessibility(tokens).valid).toBe(false);
    tokens.typography.baseFontSize = 24;
    const atLarge = validateAccessibility(tokens);
    expect(atLarge.issues.some((i) => i.message.startsWith('Primary text on background'))).toBe(
      false,
    );
  });
});
