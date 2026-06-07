/**
 * Default Dark Mode Theme Tokens
 *
 * The platform's default dark theme following ProctiraERP brand guidelines.
 * Maintains the same brand identity while providing comfortable dark mode viewing.
 *
 * All colors meet WCAG 2.1 AA contrast requirements:
 * - Normal text: 4.5:1 minimum contrast ratio
 * - Large text: 3:1 minimum contrast ratio
 *
 * Dark mode adjustments:
 * - Lighter primary/secondary for visibility on dark backgrounds
 * - Dark backgrounds with subtle surface elevation
 * - Light text colors with appropriate contrast
 */
import type { ThemeTokens } from '@proctira/theme-sdk';

/**
 * Default dark mode color tokens.
 */
export const darkColors: Record<string, string> = {
  // Primary brand colors (lightened for dark backgrounds)
  primary: 'hsl(220, 70%, 60%)',
  secondary: 'hsl(200, 60%, 55%)',
  accent: 'hsl(260, 55%, 65%)',

  // Backgrounds and surfaces (dark with subtle elevation)
  background: 'hsl(220, 20%, 10%)',
  surface: 'hsl(220, 15%, 15%)',

  // Text colors (light on dark)
  textPrimary: 'hsl(220, 10%, 92%)',
  textSecondary: 'hsl(220, 10%, 65%)',

  // On-color text
  onPrimary: 'hsl(220, 20%, 10%)',
  onSecondary: 'hsl(220, 20%, 10%)',
  onError: 'hsl(0, 0%, 100%)',

  // Semantic colors (adjusted for dark backgrounds)
  error: 'hsl(0, 70%, 50%)',
  warning: 'hsl(35, 90%, 55%)',
  success: 'hsl(145, 60%, 50%)',
  info: 'hsl(200, 70%, 60%)',

  // UI element colors
  border: 'hsl(220, 15%, 25%)',
  divider: 'hsl(220, 10%, 20%)',
  overlay: 'hsl(0, 0%, 0%)',
};

/**
 * Default dark mode theme tokens.
 * Shares typography and spacing with light mode, only colors differ.
 */
export const darkTokens: ThemeTokens = {
  colors: darkColors,
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
    sm: '0 1px 2px 0 hsl(0 0% 0% / 0.2)',
    md: '0 4px 6px -1px hsl(0 0% 0% / 0.3), 0 2px 4px -2px hsl(0 0% 0% / 0.2)',
    lg: '0 10px 15px -3px hsl(0 0% 0% / 0.3), 0 4px 6px -4px hsl(0 0% 0% / 0.2)',
    xl: '0 20px 25px -5px hsl(0 0% 0% / 0.3), 0 8px 10px -6px hsl(0 0% 0% / 0.2)',
  },
  darkMode: true,
};
