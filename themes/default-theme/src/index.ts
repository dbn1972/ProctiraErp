/**
 * @proctira/default-theme - Platform Default Theme
 *
 * Provides the default ProctiraERP platform theme with both light and dark mode.
 * This theme serves as:
 * - The platform-level default for all tenants
 * - A reference implementation for theme developers
 * - The fallback when no tenant theme is configured
 *
 * Usage:
 * ```typescript
 * import { defaultTheme } from '@proctira/default-theme';
 * import { validateTheme, generateThemePreview } from '@proctira/theme-sdk';
 *
 * // Validate the theme
 * const result = validateTheme(defaultTheme);
 *
 * // Generate a preview
 * const preview = generateThemePreview(defaultTheme, 'light');
 * const darkPreview = generateThemePreview(defaultTheme, 'dark');
 * ```
 */
import { defineTheme } from '@proctira/theme-sdk';
import type { ThemeDefinition } from '@proctira/theme-sdk';

import { lightTokens } from './light.js';
import { darkTokens } from './dark.js';

/**
 * Default platform theme definition.
 * Includes both light and dark mode tokens.
 */
export const defaultTheme: ThemeDefinition = defineTheme({
  name: 'ProctiraERP Default',
  description:
    'The default ProctiraERP platform theme with professional blue palette and full dark mode support',
  level: 'platform',
  tokens: lightTokens,
  darkTokens: darkTokens,
  assets: {
    logoUrl: '/assets/proctira-logo.svg',
    logoAlt: 'ProctiraERP Platform',
    faviconUrl: '/assets/favicon.ico',
  },
});

// Re-export individual token sets for direct access
export { lightTokens, lightColors } from './light.js';
export { darkTokens, darkColors } from './dark.js';
export type { ThemeDefinition };
