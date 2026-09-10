/**
 * Theme Preview Component
 *
 * Generates a preview representation of a theme for the admin UI.
 * Produces CSS custom properties and a structured preview object
 * that can be rendered by the frontend.
 *
 * The preview includes:
 * - CSS custom properties for all tokens
 * - Color swatches with labels
 * - Typography samples
 * - Spacing visualization
 * - Light/dark mode toggle state
 * - Accessibility validation summary
 */
import type { ThemeTokens, ThemeAssets } from '@proctira/backend-theme';
import { validateAccessibility } from '@proctira/backend-theme';

import type { ThemeDefinition } from './tokens.js';
import { validateTheme } from './validation.js';
import type { ValidationResult } from './validation.js';

/**
 * A color swatch for preview display.
 */
export interface ColorSwatch {
  /** Token name (e.g., "primary") */
  name: string;
  /** Color value */
  value: string;
  /** Whether this is a required token */
  required: boolean;
}

/**
 * Typography preview sample.
 */
export interface TypographySample {
  /** Label for the sample */
  label: string;
  /** Font family */
  fontFamily: string;
  /** Font size in px */
  fontSize: number;
  /** Font weight */
  fontWeight: number;
  /** Line height */
  lineHeight: number;
}

/**
 * Complete theme preview for admin UI rendering.
 */
export interface ThemePreview {
  /** Theme name */
  name: string;
  /** Theme description */
  description?: string;
  /** Current mode being previewed */
  mode: 'light' | 'dark';
  /** Whether dark mode is available */
  hasDarkMode: boolean;
  /** CSS custom properties string */
  cssVariables: string;
  /** Color swatches for visual display */
  colorSwatches: ColorSwatch[];
  /** Typography samples */
  typographySamples: TypographySample[];
  /** Logo URL if available */
  logoUrl?: string;
  /** Logo alt text */
  logoAlt?: string;
  /** Favicon URL if available */
  faviconUrl?: string;
  /** Validation result */
  validation: ValidationResult;
  /** Accessibility-specific result */
  accessibilityResult: {
    valid: boolean;
    issues: Array<{ type: string; message: string; severity: 'error' | 'warning' }>;
  };
}

/**
 * Required color tokens for swatch display.
 */
const REQUIRED_TOKENS = new Set([
  'primary',
  'secondary',
  'background',
  'surface',
  'error',
  'textPrimary',
  'textSecondary',
]);

/**
 * Generate CSS custom properties from theme tokens.
 */
export function generateCssVariables(tokens: ThemeTokens, prefix = 'proctira'): string {
  const lines: string[] = [`:root {`];

  // Color tokens
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`  --${prefix}-color-${camelToKebab(name)}: ${value};`);
  }

  // Typography tokens
  lines.push(`  --${prefix}-font-family: ${tokens.typography.fontFamily};`);
  if (tokens.typography.fontFamilyHeading) {
    lines.push(`  --${prefix}-font-family-heading: ${tokens.typography.fontFamilyHeading};`);
  }
  lines.push(`  --${prefix}-font-size-base: ${tokens.typography.baseFontSize}px;`);
  lines.push(`  --${prefix}-line-height: ${tokens.typography.lineHeight};`);
  if (tokens.typography.fontWeightNormal) {
    lines.push(`  --${prefix}-font-weight-normal: ${tokens.typography.fontWeightNormal};`);
  }
  if (tokens.typography.fontWeightBold) {
    lines.push(`  --${prefix}-font-weight-bold: ${tokens.typography.fontWeightBold};`);
  }
  if (tokens.typography.scaleRatio) {
    lines.push(`  --${prefix}-type-scale: ${tokens.typography.scaleRatio};`);
  }

  // Spacing tokens
  lines.push(`  --${prefix}-spacing-unit: ${tokens.spacing.unit}px;`);
  if (tokens.spacing.scale) {
    for (let i = 0; i < tokens.spacing.scale.length; i++) {
      lines.push(
        `  --${prefix}-spacing-${i}: ${tokens.spacing.scale[i]! * tokens.spacing.unit}px;`,
      );
    }
  }

  // Border radius tokens
  if (tokens.borderRadius) {
    for (const [name, value] of Object.entries(tokens.borderRadius)) {
      lines.push(`  --${prefix}-radius-${camelToKebab(name)}: ${value};`);
    }
  }

  // Shadow tokens
  if (tokens.shadows) {
    for (const [name, value] of Object.entries(tokens.shadows)) {
      lines.push(`  --${prefix}-shadow-${camelToKebab(name)}: ${value};`);
    }
  }

  lines.push(`}`);
  return lines.join('\n');
}

/**
 * Generate typography samples for preview.
 */
function generateTypographySamples(tokens: ThemeTokens): TypographySample[] {
  const { typography } = tokens;
  const scale = typography.scaleRatio ?? 1.25;
  const baseSize = typography.baseFontSize;
  const normalWeight = typography.fontWeightNormal ?? 400;
  const boldWeight = typography.fontWeightBold ?? 700;

  return [
    {
      label: 'Heading 1',
      fontFamily: typography.fontFamilyHeading ?? typography.fontFamily,
      fontSize: Math.round(baseSize * scale * scale * scale),
      fontWeight: boldWeight,
      lineHeight: typography.lineHeight,
    },
    {
      label: 'Heading 2',
      fontFamily: typography.fontFamilyHeading ?? typography.fontFamily,
      fontSize: Math.round(baseSize * scale * scale),
      fontWeight: boldWeight,
      lineHeight: typography.lineHeight,
    },
    {
      label: 'Heading 3',
      fontFamily: typography.fontFamilyHeading ?? typography.fontFamily,
      fontSize: Math.round(baseSize * scale),
      fontWeight: boldWeight,
      lineHeight: typography.lineHeight,
    },
    {
      label: 'Body',
      fontFamily: typography.fontFamily,
      fontSize: baseSize,
      fontWeight: normalWeight,
      lineHeight: typography.lineHeight,
    },
    {
      label: 'Small',
      fontFamily: typography.fontFamily,
      fontSize: Math.round(baseSize / scale),
      fontWeight: normalWeight,
      lineHeight: typography.lineHeight,
    },
  ];
}

/**
 * Generate a complete theme preview for the admin UI.
 *
 * @param definition - The theme definition to preview
 * @param mode - Which mode to preview ('light' or 'dark')
 * @returns A structured preview object for rendering
 */
export function generateThemePreview(
  definition: ThemeDefinition,
  mode: 'light' | 'dark' = 'light',
): ThemePreview {
  const hasDarkMode = !!definition.darkTokens;
  const tokens =
    mode === 'dark' && definition.darkTokens ? definition.darkTokens : definition.tokens;

  // Generate CSS variables
  const cssVariables = generateCssVariables(tokens);

  // Generate color swatches
  const colorSwatches: ColorSwatch[] = Object.entries(tokens.colors).map(([name, value]) => ({
    name,
    value,
    required: REQUIRED_TOKENS.has(name),
  }));

  // Generate typography samples
  const typographySamples = generateTypographySamples(tokens);

  // Run validation
  const validation = validateTheme(definition);

  // Run accessibility check
  const accessibilityResult = validateAccessibility(tokens);

  return {
    name: definition.name,
    description: definition.description,
    mode,
    hasDarkMode,
    cssVariables,
    colorSwatches,
    typographySamples,
    logoUrl: definition.assets?.logoUrl ?? undefined,
    logoAlt: definition.assets?.logoAlt ?? undefined,
    faviconUrl: definition.assets?.faviconUrl ?? undefined,
    validation,
    accessibilityResult,
  };
}

/**
 * Convert camelCase to kebab-case.
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
