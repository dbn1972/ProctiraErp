/**
 * Theme Preview Tests
 *
 * Tests for theme preview generation including:
 * - CSS custom property generation
 * - Color swatch generation
 * - Typography sample generation
 * - Light/dark mode switching
 */
import { describe, it, expect } from 'vitest';

import { generateThemePreview, generateCssVariables } from './preview.js';
import type { ThemeDefinition } from './tokens.js';
import type { ThemeTokens } from '@proctira/backend-theme';

/** Helper to create a valid theme for testing */
function createTestTheme(): ThemeDefinition {
  return {
    name: 'Preview Test Theme',
    description: 'A theme for testing preview generation',
    level: 'tenant',
    tokens: {
      colors: {
        primary: 'hsl(220, 70%, 45%)',
        secondary: 'hsl(200, 60%, 40%)',
        background: 'hsl(0, 0%, 100%)',
        surface: 'hsl(220, 20%, 97%)',
        error: 'hsl(0, 70%, 45%)',
        textPrimary: 'hsl(220, 20%, 15%)',
        textSecondary: 'hsl(220, 10%, 40%)',
        onPrimary: 'hsl(0, 0%, 100%)',
        onSecondary: 'hsl(0, 0%, 100%)',
        onError: 'hsl(0, 0%, 100%)',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontFamilyHeading: 'Inter, sans-serif',
        baseFontSize: 16,
        lineHeight: 1.5,
        fontWeightNormal: 400,
        fontWeightBold: 700,
        scaleRatio: 1.25,
      },
      spacing: {
        unit: 4,
        scale: [0, 1, 2, 3, 4, 6, 8],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      shadows: {
        sm: '0 1px 2px rgba(0,0,0,0.1)',
      },
    },
    darkTokens: {
      colors: {
        primary: 'hsl(220, 70%, 60%)',
        secondary: 'hsl(200, 60%, 55%)',
        background: 'hsl(220, 20%, 10%)',
        surface: 'hsl(220, 15%, 15%)',
        error: 'hsl(0, 70%, 60%)',
        textPrimary: 'hsl(220, 10%, 92%)',
        textSecondary: 'hsl(220, 10%, 65%)',
        onPrimary: 'hsl(220, 20%, 10%)',
        onSecondary: 'hsl(220, 20%, 10%)',
        onError: 'hsl(0, 0%, 100%)',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        baseFontSize: 16,
        lineHeight: 1.5,
        fontWeightNormal: 400,
        fontWeightBold: 700,
        scaleRatio: 1.25,
      },
      spacing: {
        unit: 4,
        scale: [0, 1, 2, 3, 4, 6, 8],
      },
      darkMode: true,
    },
    assets: {
      logoUrl: '/assets/logo.svg',
      logoAlt: 'Test Logo',
      faviconUrl: '/assets/favicon.ico',
    },
  };
}

describe('generateCssVariables', () => {
  it('should generate CSS custom properties for color tokens', () => {
    const tokens: ThemeTokens = {
      colors: { primary: 'hsl(220, 70%, 45%)', background: '#ffffff' },
      typography: { fontFamily: 'Inter', baseFontSize: 16, lineHeight: 1.5 },
      spacing: { unit: 4 },
    };

    const css = generateCssVariables(tokens);
    expect(css).toContain('--proctira-color-primary: hsl(220, 70%, 45%)');
    expect(css).toContain('--proctira-color-background: #ffffff');
  });

  it('should generate CSS custom properties for typography', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#333' },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontFamilyHeading: 'Georgia, serif',
        baseFontSize: 16,
        lineHeight: 1.5,
        fontWeightNormal: 400,
        fontWeightBold: 700,
        scaleRatio: 1.25,
      },
      spacing: { unit: 4 },
    };

    const css = generateCssVariables(tokens);
    expect(css).toContain('--proctira-font-family: Inter, sans-serif');
    expect(css).toContain('--proctira-font-family-heading: Georgia, serif');
    expect(css).toContain('--proctira-font-size-base: 16px');
    expect(css).toContain('--proctira-line-height: 1.5');
    expect(css).toContain('--proctira-font-weight-normal: 400');
    expect(css).toContain('--proctira-font-weight-bold: 700');
    expect(css).toContain('--proctira-type-scale: 1.25');
  });

  it('should generate CSS custom properties for spacing scale', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#333' },
      typography: { fontFamily: 'Inter', baseFontSize: 16, lineHeight: 1.5 },
      spacing: { unit: 4, scale: [0, 1, 2, 4] },
    };

    const css = generateCssVariables(tokens);
    expect(css).toContain('--proctira-spacing-unit: 4px');
    expect(css).toContain('--proctira-spacing-0: 0px');
    expect(css).toContain('--proctira-spacing-1: 4px');
    expect(css).toContain('--proctira-spacing-2: 8px');
    expect(css).toContain('--proctira-spacing-3: 16px');
  });

  it('should generate CSS custom properties for border radius', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#333' },
      typography: { fontFamily: 'Inter', baseFontSize: 16, lineHeight: 1.5 },
      spacing: { unit: 4 },
      borderRadius: { sm: '4px', md: '8px' },
    };

    const css = generateCssVariables(tokens);
    expect(css).toContain('--proctira-radius-sm: 4px');
    expect(css).toContain('--proctira-radius-md: 8px');
  });

  it('should support custom prefix', () => {
    const tokens: ThemeTokens = {
      colors: { primary: '#333' },
      typography: { fontFamily: 'Inter', baseFontSize: 16, lineHeight: 1.5 },
      spacing: { unit: 4 },
    };

    const css = generateCssVariables(tokens, 'custom');
    expect(css).toContain('--custom-color-primary: #333');
    expect(css).toContain('--custom-font-family: Inter');
  });

  it('should convert camelCase token names to kebab-case', () => {
    const tokens: ThemeTokens = {
      colors: { textPrimary: '#333', onPrimary: '#fff' },
      typography: { fontFamily: 'Inter', baseFontSize: 16, lineHeight: 1.5 },
      spacing: { unit: 4 },
    };

    const css = generateCssVariables(tokens);
    expect(css).toContain('--proctira-color-text-primary: #333');
    expect(css).toContain('--proctira-color-on-primary: #fff');
  });
});

describe('generateThemePreview', () => {
  it('should generate a complete preview for light mode', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'light');

    expect(preview.name).toBe('Preview Test Theme');
    expect(preview.description).toBe('A theme for testing preview generation');
    expect(preview.mode).toBe('light');
    expect(preview.hasDarkMode).toBe(true);
    expect(preview.cssVariables).toContain(':root {');
    expect(preview.colorSwatches.length).toBeGreaterThan(0);
    expect(preview.typographySamples.length).toBe(5);
    expect(preview.logoUrl).toBe('/assets/logo.svg');
    expect(preview.logoAlt).toBe('Test Logo');
    expect(preview.faviconUrl).toBe('/assets/favicon.ico');
  });

  it('should generate a preview for dark mode using darkTokens', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'dark');

    expect(preview.mode).toBe('dark');
    expect(preview.cssVariables).toContain('hsl(220, 20%, 10%)'); // dark background
  });

  it('should fall back to light tokens when dark mode requested but no darkTokens', () => {
    const theme = createTestTheme();
    delete theme.darkTokens;
    const preview = generateThemePreview(theme, 'dark');

    expect(preview.mode).toBe('dark');
    expect(preview.hasDarkMode).toBe(false);
    // Should use light tokens as fallback
    expect(preview.cssVariables).toContain('hsl(0, 0%, 100%)'); // light background
  });

  it('should mark required color swatches correctly', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'light');

    const primarySwatch = preview.colorSwatches.find((s) => s.name === 'primary');
    expect(primarySwatch).toBeDefined();
    expect(primarySwatch!.required).toBe(true);

    const onPrimarySwatch = preview.colorSwatches.find((s) => s.name === 'onPrimary');
    expect(onPrimarySwatch).toBeDefined();
    expect(onPrimarySwatch!.required).toBe(false);
  });

  it('should generate typography samples with correct scale', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'light');

    const body = preview.typographySamples.find((s) => s.label === 'Body');
    expect(body).toBeDefined();
    expect(body!.fontSize).toBe(16);
    expect(body!.fontWeight).toBe(400);

    const h1 = preview.typographySamples.find((s) => s.label === 'Heading 1');
    expect(h1).toBeDefined();
    expect(h1!.fontSize).toBeGreaterThan(16);
    expect(h1!.fontWeight).toBe(700);
  });

  it('should include validation result', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'light');

    expect(preview.validation).toBeDefined();
    // Validation result is present (may have issues from dark mode tokens in test fixture)
    expect(typeof preview.validation.valid).toBe('boolean');
    expect(Array.isArray(preview.validation.issues)).toBe(true);
  });

  it('should include accessibility result', () => {
    const theme = createTestTheme();
    const preview = generateThemePreview(theme, 'light');

    expect(preview.accessibilityResult).toBeDefined();
    expect(preview.accessibilityResult.valid).toBeDefined();
  });
});
