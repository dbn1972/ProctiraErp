/**
 * @proctira/theme-sdk - Theme Development SDK
 *
 * Provides everything needed to develop themes for the ProctiraERP platform:
 *
 * - Token definitions and type-safe helpers
 * - Theme validation (security, accessibility, completeness, bounds)
 * - Theme preview generation for admin UI
 * - CSS custom property generation
 *
 * Usage:
 * ```typescript
 * import { defineTheme, validateTheme, generateThemePreview } from '@proctira/theme-sdk';
 *
 * const myTheme = defineTheme({
 *   name: 'My Custom Theme',
 *   level: 'tenant',
 *   tokens: { ... },
 *   darkTokens: { ... },
 *   assets: { logoUrl: '...', logoAlt: '...', faviconUrl: '...' },
 * });
 *
 * const result = validateTheme(myTheme);
 * if (result.valid) {
 *   const preview = generateThemePreview(myTheme);
 * }
 * ```
 */

// Token definitions and helpers
export {
  defineTheme,
  defineColors,
  defineTypography,
  defineSpacing,
  REQUIRED_COLOR_TOKENS,
  OPTIONAL_COLOR_TOKENS,
  ALL_COLOR_TOKENS,
  TYPOGRAPHY_BOUNDS,
  SPACING_BOUNDS,
  ASSET_CONSTRAINTS,
} from './tokens.js';
export type {
  ThemeDefinition,
  ThemeTokens,
  ThemeAssets,
  TypographyConfig,
  SpacingConfig,
  ThemeLevel,
  ThemeStatus,
  RequiredColorToken,
  OptionalColorToken,
  ColorToken,
} from './tokens.js';

// Validation
export {
  validateTheme,
  validateThemeSecurity,
} from './validation.js';
export type {
  ValidationIssue,
  ValidationResult,
} from './validation.js';

// Preview
export {
  generateThemePreview,
  generateCssVariables,
} from './preview.js';
export type {
  ThemePreview,
  ColorSwatch,
  TypographySample,
} from './preview.js';
