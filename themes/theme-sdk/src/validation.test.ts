/**
 * Theme SDK Validation Tests
 *
 * Tests for theme validation including:
 * - Security: script injection detection
 * - Security: legal element removal detection
 * - Completeness: required color tokens
 * - Bounds: typography and spacing limits
 * - Accessibility: WCAG 2.1 AA compliance
 */
import { describe, it, expect } from 'vitest';

import { validateTheme, validateThemeSecurity } from './validation.js';
import type { ThemeDefinition } from './tokens.js';

/** Helper to create a valid base theme for testing */
function createValidTheme(overrides?: Partial<ThemeDefinition>): ThemeDefinition {
  return {
    name: 'Test Theme',
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
        baseFontSize: 16,
        lineHeight: 1.5,
        fontWeightNormal: 400,
        fontWeightBold: 700,
        scaleRatio: 1.25,
      },
      spacing: {
        unit: 4,
        scale: [0, 1, 2, 3, 4, 5, 6, 8],
      },
    },
    ...overrides,
  };
}

describe('validateTheme', () => {
  it('should pass for a valid theme', () => {
    const theme = createValidTheme();
    const result = validateTheme(theme);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  describe('security - script injection', () => {
    it('should detect <script> tags in color values', () => {
      const theme = createValidTheme();
      theme.tokens.colors['primary'] = '<script>alert("xss")</script>';
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security')).toBe(true);
    });

    it('should detect javascript: protocol in URLs', () => {
      const theme = createValidTheme({
        assets: {
          logoUrl: 'javascript:alert(1)',
          logoAlt: 'Logo',
        },
      });
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security' && i.path?.includes('logoUrl'))).toBe(
        true,
      );
    });

    it('should detect event handlers in string values', () => {
      const theme = createValidTheme();
      theme.tokens.colors['primary'] = 'hsl(0, 0%, 0%) onload=alert(1)';
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security')).toBe(true);
    });

    it('should detect expression() in values', () => {
      const theme = createValidTheme();
      theme.tokens.colors['primary'] = 'expression(alert(1))';
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security')).toBe(true);
    });

    it('should detect iframe injection', () => {
      const theme = createValidTheme({
        assets: {
          logoAlt: '<iframe src="evil.com"></iframe>',
        },
      });
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
    });

    it('should detect @import in values', () => {
      const theme = createValidTheme();
      theme.tokens.shadows = { sm: '@import url("evil.css")' };
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security')).toBe(true);
    });
  });

  describe('security - legal element removal', () => {
    it('should detect attempts to hide footer via display:none', () => {
      const theme = createValidTheme();
      theme.tokens.shadows = { footer: 'footer display: none' };
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'security' && i.message.includes('footer'))).toBe(
        true,
      );
    });

    it('should detect attempts to hide copyright via visibility:hidden', () => {
      const theme = createValidTheme();
      theme.tokens.shadows = { custom: 'copyright visibility: hidden' };
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'security' && i.message.includes('copyright')),
      ).toBe(true);
    });

    it('should not flag normal values that happen to contain protected words', () => {
      const theme = createValidTheme();
      // Just the word "footer" without a hide pattern should be fine
      theme.tokens.borderRadius = { footer: '4px' };
      const result = validateTheme(theme);
      // Should not have security issues for this
      expect(result.issues.filter((i) => i.type === 'security')).toHaveLength(0);
    });
  });

  describe('completeness - required color tokens', () => {
    it('should fail when primary color is missing', () => {
      const theme = createValidTheme();
      delete theme.tokens.colors['primary'];
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'completeness' && i.path === 'colors.primary'),
      ).toBe(true);
    });

    it('should fail when background color is missing', () => {
      const theme = createValidTheme();
      delete theme.tokens.colors['background'];
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'completeness' && i.path === 'colors.background'),
      ).toBe(true);
    });

    it('should fail when textPrimary color is missing', () => {
      const theme = createValidTheme();
      delete theme.tokens.colors['textPrimary'];
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'completeness' && i.path === 'colors.textPrimary'),
      ).toBe(true);
    });
  });

  describe('bounds - typography', () => {
    it('should fail when baseFontSize is below minimum (12px)', () => {
      const theme = createValidTheme();
      theme.tokens.typography.baseFontSize = 10;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'bounds' && i.path === 'typography.baseFontSize'),
      ).toBe(true);
    });

    it('should fail when baseFontSize is above maximum (24px)', () => {
      const theme = createValidTheme();
      theme.tokens.typography.baseFontSize = 30;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'bounds' && i.path === 'typography.baseFontSize'),
      ).toBe(true);
    });

    it('should fail when lineHeight is below minimum (1.2)', () => {
      const theme = createValidTheme();
      theme.tokens.typography.lineHeight = 1.0;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'bounds' && i.path === 'typography.lineHeight'),
      ).toBe(true);
    });

    it('should fail when lineHeight is above maximum (2.0)', () => {
      const theme = createValidTheme();
      theme.tokens.typography.lineHeight = 2.5;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'bounds' && i.path === 'typography.lineHeight'),
      ).toBe(true);
    });

    it('should fail when scaleRatio is out of bounds', () => {
      const theme = createValidTheme();
      theme.tokens.typography.scaleRatio = 2.0;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.type === 'bounds' && i.path === 'typography.scaleRatio'),
      ).toBe(true);
    });
  });

  describe('bounds - spacing', () => {
    it('should fail when spacing unit is below minimum (2px)', () => {
      const theme = createValidTheme();
      theme.tokens.spacing.unit = 1;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'bounds' && i.path === 'spacing.unit')).toBe(
        true,
      );
    });

    it('should fail when spacing unit is above maximum (16px)', () => {
      const theme = createValidTheme();
      theme.tokens.spacing.unit = 20;
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'bounds' && i.path === 'spacing.unit')).toBe(
        true,
      );
    });

    it('should fail when spacing scale has too many items', () => {
      const theme = createValidTheme();
      theme.tokens.spacing.scale = Array.from({ length: 25 }, (_, i) => i);
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'bounds' && i.path === 'spacing.scale')).toBe(
        true,
      );
    });
  });

  describe('dark mode validation', () => {
    it('should validate dark mode tokens when present', () => {
      const theme = createValidTheme({
        darkTokens: {
          colors: {
            primary: 'hsl(220, 70%, 60%)',
            secondary: 'hsl(200, 60%, 55%)',
            background: 'hsl(220, 20%, 10%)',
            surface: 'hsl(220, 15%, 15%)',
            error: 'hsl(0, 70%, 60%)',
            textPrimary: 'hsl(220, 10%, 92%)',
            textSecondary: 'hsl(220, 10%, 65%)',
          },
          typography: {
            fontFamily: 'Inter, sans-serif',
            baseFontSize: 16,
            lineHeight: 1.5,
          },
          spacing: { unit: 4 },
          darkMode: true,
        },
      });
      const result = validateTheme(theme);
      expect(result.valid).toBe(true);
    });

    it('should fail when dark mode tokens have missing required colors', () => {
      const theme = createValidTheme({
        darkTokens: {
          colors: {
            primary: 'hsl(220, 70%, 60%)',
            // Missing other required tokens
          },
          typography: {
            fontFamily: 'Inter, sans-serif',
            baseFontSize: 16,
            lineHeight: 1.5,
          },
          spacing: { unit: 4 },
          darkMode: true,
        },
      });
      const result = validateTheme(theme);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'completeness')).toBe(true);
    });
  });
});

describe('validateThemeSecurity', () => {
  it('should only check security issues', () => {
    const theme = createValidTheme();
    // Remove required tokens - should not cause security failure
    delete theme.tokens.colors['primary'];
    const result = validateThemeSecurity(theme);
    expect(result.valid).toBe(true);
  });

  it('should detect script injection', () => {
    const theme = createValidTheme();
    theme.tokens.colors['primary'] = '<script>alert(1)</script>';
    const result = validateThemeSecurity(theme);
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.type).toBe('security');
  });
});
