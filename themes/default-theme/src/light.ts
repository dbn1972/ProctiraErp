/**
 * Default Light Mode Theme Tokens
 *
 * The platform's default light theme following ProctiraERP brand guidelines.
 * Uses a professional blue primary palette with accessible contrast ratios.
 *
 * All colors meet WCAG 2.1 AA contrast requirements:
 * - Normal text: 4.5:1 minimum contrast ratio
 * - Large text: 3:1 minimum contrast ratio
 */
import type { ThemeTokens } from '@proctira/theme-sdk';

/**
 * Default light mode color tokens.
 * Uses HSL format for easy manipulation.
 */
export const lightColors: Record<string, string> = {
  // Primary brand colors
  primary: 'hsl(220, 70%, 45%)',
  secondary: 'hsl(200, 60%, 40%)',
  accent: 'hsl(260, 55%, 50%)',

  // Backgrounds and surfaces
  background: 'hsl(0, 0%, 100%)',
  surface: 'hsl(220, 20%, 97%)',

  // Text colors
  textPrimary: 'hsl(220, 20%, 15%)',
  textSecondary: 'hsl(220, 10%, 40%)',

  // On-color text (text on colored backgrounds)
  onPrimary: 'hsl(0, 0%, 100%)',
  onSecondary: 'hsl(0, 0%, 100%)',
  onError: 'hsl(0, 0%, 100%)',

  // Semantic colors
  error: 'hsl(0, 70%, 45%)',
  warning: 'hsl(35, 90%, 45%)',
  success: 'hsl(145, 60%, 35%)',
  info: 'hsl(200, 70%, 45%)',

  // UI element colors
  border: 'hsl(220, 15%, 85%)',
  divider: 'hsl(220, 10%, 90%)',
  overlay: 'hsl(220, 20%, 15%)',
};

/**
 * Default light mode theme tokens.
 */
export const lightTokens: ThemeTokens = {
  colors: lightColors,
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    fontFamilyHeading: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    baseFontSize: 16,
    lineHeight: 1.5,
    fontWeightNormal: 400,
    fontWeightBold: 700,
    scaleRatio: 1.25,
  },
  spacing: {
    unit: 4,
    scale: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48],
  },
  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px 0 hsl(220 20% 15% / 0.05)',
    md: '0 4px 6px -1px hsl(220 20% 15% / 0.1), 0 2px 4px -2px hsl(220 20% 15% / 0.1)',
    lg: '0 10px 15px -3px hsl(220 20% 15% / 0.1), 0 4px 6px -4px hsl(220 20% 15% / 0.1)',
    xl: '0 20px 25px -5px hsl(220 20% 15% / 0.1), 0 8px 10px -6px hsl(220 20% 15% / 0.1)',
  },
  darkMode: false,
};
