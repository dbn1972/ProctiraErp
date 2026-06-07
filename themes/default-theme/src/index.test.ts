/**
 * Default Theme Tests
 *
 * Validates that the default platform theme:
 * - Passes all validation checks
 * - Has complete light and dark mode tokens
 * - Meets accessibility requirements
 * - Generates valid previews
 */
import { describe, it, expect } from 'vitest';
import { validateTheme, generateThemePreview, REQUIRED_COLOR_TOKENS } from '@proctira/theme-sdk';

import { defaultTheme } from './index.js';
import { lightTokens } from './light.js';
import { darkTokens } from './dark.js';

describe('defaultTheme', () => {
  it('should have correct metadata', () => {
    expect(defaultTheme.name).toBe('ProctiraERP Default');
    expect(defaultTheme.level).toBe('platform');
    expect(defaultTheme.description).toBeDefined();
  });

  it('should pass full validation', () => {
    const result = validateTheme(defaultTheme);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('should have both light and dark mode tokens', () => {
    expect(defaultTheme.tokens).toBeDefined();
    expect(defaultTheme.darkTokens).toBeDefined();
  });

  it('should have assets defined', () => {
    expect(defaultTheme.assets).toBeDefined();
    expect(defaultTheme.assets!.logoUrl).toBeDefined();
    expect(defaultTheme.assets!.logoAlt).toBeDefined();
    expect(defaultTheme.assets!.faviconUrl).toBeDefined();
  });
});

describe('lightTokens', () => {
  it('should have all required color tokens', () => {
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(lightTokens.colors[token]).toBeDefined();
    }
  });

  it('should have typography within bounds', () => {
    expect(lightTokens.typography.baseFontSize).toBeGreaterThanOrEqual(12);
    expect(lightTokens.typography.baseFontSize).toBeLessThanOrEqual(24);
    expect(lightTokens.typography.lineHeight).toBeGreaterThanOrEqual(1.2);
    expect(lightTokens.typography.lineHeight).toBeLessThanOrEqual(2.0);
  });

  it('should have spacing within bounds', () => {
    expect(lightTokens.spacing.unit).toBeGreaterThanOrEqual(2);
    expect(lightTokens.spacing.unit).toBeLessThanOrEqual(16);
  });

  it('should have darkMode set to false', () => {
    expect(lightTokens.darkMode).toBe(false);
  });

  it('should have border radius tokens', () => {
    expect(lightTokens.borderRadius).toBeDefined();
    expect(lightTokens.borderRadius!['sm']).toBeDefined();
    expect(lightTokens.borderRadius!['md']).toBeDefined();
    expect(lightTokens.borderRadius!['lg']).toBeDefined();
  });

  it('should have shadow tokens', () => {
    expect(lightTokens.shadows).toBeDefined();
    expect(lightTokens.shadows!['sm']).toBeDefined();
    expect(lightTokens.shadows!['md']).toBeDefined();
    expect(lightTokens.shadows!['lg']).toBeDefined();
  });
});

describe('darkTokens', () => {
  it('should have all required color tokens', () => {
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(darkTokens.colors[token]).toBeDefined();
    }
  });

  it('should have typography within bounds', () => {
    expect(darkTokens.typography.baseFontSize).toBeGreaterThanOrEqual(12);
    expect(darkTokens.typography.baseFontSize).toBeLessThanOrEqual(24);
    expect(darkTokens.typography.lineHeight).toBeGreaterThanOrEqual(1.2);
    expect(darkTokens.typography.lineHeight).toBeLessThanOrEqual(2.0);
  });

  it('should have spacing within bounds', () => {
    expect(darkTokens.spacing.unit).toBeGreaterThanOrEqual(2);
    expect(darkTokens.spacing.unit).toBeLessThanOrEqual(16);
  });

  it('should have darkMode set to true', () => {
    expect(darkTokens.darkMode).toBe(true);
  });

  it('should use same typography as light mode', () => {
    expect(darkTokens.typography.fontFamily).toBe(lightTokens.typography.fontFamily);
    expect(darkTokens.typography.baseFontSize).toBe(lightTokens.typography.baseFontSize);
    expect(darkTokens.typography.lineHeight).toBe(lightTokens.typography.lineHeight);
  });

  it('should use same spacing as light mode', () => {
    expect(darkTokens.spacing.unit).toBe(lightTokens.spacing.unit);
  });
});

describe('theme preview generation', () => {
  it('should generate a valid light mode preview', () => {
    const preview = generateThemePreview(defaultTheme, 'light');
    expect(preview.mode).toBe('light');
    expect(preview.hasDarkMode).toBe(true);
    expect(preview.cssVariables).toContain(':root {');
    expect(preview.colorSwatches.length).toBeGreaterThan(0);
    expect(preview.typographySamples.length).toBe(5);
  });

  it('should generate a valid dark mode preview', () => {
    const preview = generateThemePreview(defaultTheme, 'dark');
    expect(preview.mode).toBe('dark');
    expect(preview.hasDarkMode).toBe(true);
    expect(preview.cssVariables).toContain('hsl(220, 20%, 10%)'); // dark background
  });

  it('should pass accessibility in both modes', () => {
    const lightPreview = generateThemePreview(defaultTheme, 'light');
    expect(lightPreview.accessibilityResult.valid).toBe(true);

    const darkPreview = generateThemePreview(defaultTheme, 'dark');
    expect(darkPreview.accessibilityResult.valid).toBe(true);
  });
});
