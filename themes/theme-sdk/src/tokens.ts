/**
 * Theme Token Definitions
 *
 * Provides the canonical token structure for ProctiraERP themes.
 * Re-exports types from @proctira/backend-theme and adds SDK-specific
 * utilities for theme developers.
 *
 * Token categories:
 * - Colors: HSL or hex color values for semantic color roles
 * - Typography: Font families, sizes, weights, and scale
 * - Spacing: Base unit and scale multipliers
 * - Border Radius: Corner rounding tokens
 * - Shadows: Elevation shadow tokens
 * - Assets: Logo, favicon, and branding assets
 */
import type {
  ThemeTokens,
  ThemeAssets,
  TypographyConfig,
  SpacingConfig,
  ThemeLevel,
  ThemeStatus,
} from '@proctira/backend-theme';

// Re-export types from backend-theme for SDK consumers
export type { ThemeTokens, ThemeAssets, TypographyConfig, SpacingConfig, ThemeLevel, ThemeStatus };

/**
 * Complete theme definition combining tokens, assets, and metadata.
 * This is the primary interface for theme developers.
 */
export interface ThemeDefinition {
  /** Unique theme name */
  name: string;
  /** Optional description */
  description?: string;
  /** Theme level: platform, tenant, or portal */
  level: ThemeLevel;
  /** Light mode tokens */
  tokens: ThemeTokens;
  /** Dark mode tokens (optional) */
  darkTokens?: ThemeTokens;
  /** Theme assets (logo, favicon) */
  assets?: ThemeAssets;
}

/**
 * Required color token keys that every theme must define.
 */
export const REQUIRED_COLOR_TOKENS = [
  'primary',
  'secondary',
  'background',
  'surface',
  'error',
  'textPrimary',
  'textSecondary',
] as const;

/**
 * Optional color token keys that themes may define.
 */
export const OPTIONAL_COLOR_TOKENS = [
  'warning',
  'success',
  'info',
  'onPrimary',
  'onSecondary',
  'onError',
  'border',
  'divider',
  'overlay',
  'accent',
] as const;

/**
 * All recognized color token keys.
 */
export const ALL_COLOR_TOKENS = [...REQUIRED_COLOR_TOKENS, ...OPTIONAL_COLOR_TOKENS] as const;

export type RequiredColorToken = (typeof REQUIRED_COLOR_TOKENS)[number];
export type OptionalColorToken = (typeof OPTIONAL_COLOR_TOKENS)[number];
export type ColorToken = (typeof ALL_COLOR_TOKENS)[number];

/**
 * Typography bounds enforced by the platform.
 * Themes must stay within these limits for accessibility.
 */
export const TYPOGRAPHY_BOUNDS = {
  baseFontSize: { min: 12, max: 24 },
  lineHeight: { min: 1.2, max: 2.0 },
  fontWeight: { min: 100, max: 900 },
  scaleRatio: { min: 1.1, max: 1.5 },
} as const;

/**
 * Spacing bounds enforced by the platform.
 */
export const SPACING_BOUNDS = {
  unit: { min: 2, max: 16 },
  maxScaleItems: 20,
} as const;

/**
 * Asset constraints.
 */
export const ASSET_CONSTRAINTS = {
  logoUrl: { maxLength: 2048 },
  logoAlt: { maxLength: 255 },
  faviconUrl: { maxLength: 2048 },
} as const;

/**
 * Helper to create a type-safe color map.
 * Ensures required tokens are present.
 */
export function defineColors(
  colors: Record<RequiredColorToken, string> & Partial<Record<OptionalColorToken, string>>,
): Record<string, string> {
  return colors;
}

/**
 * Helper to create a type-safe typography config.
 */
export function defineTypography(config: TypographyConfig): TypographyConfig {
  return config;
}

/**
 * Helper to create a type-safe spacing config.
 */
export function defineSpacing(config: SpacingConfig): SpacingConfig {
  return config;
}

/**
 * Helper to define a complete theme with type safety.
 */
export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  return definition;
}
