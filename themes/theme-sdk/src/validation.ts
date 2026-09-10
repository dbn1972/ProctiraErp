/**
 * Theme Validation
 *
 * Validates theme definitions for:
 * - Required token completeness
 * - Typography bounds compliance
 * - Spacing bounds compliance
 * - Security: no script injection in string values
 * - Security: no removal of legal/required elements
 * - Accessibility: contrast ratios, font sizes
 *
 * Uses the accessibility validation from @proctira/backend-theme
 * and adds SDK-specific validation rules.
 */
import { validateAccessibility } from '@proctira/backend-theme';
import type { ThemeTokens, ThemeAssets } from '@proctira/backend-theme';

import {
  REQUIRED_COLOR_TOKENS,
  TYPOGRAPHY_BOUNDS,
  SPACING_BOUNDS,
  ASSET_CONSTRAINTS,
} from './tokens.js';
import type { ThemeDefinition } from './tokens.js';

/**
 * Validation issue found during theme validation.
 */
export interface ValidationIssue {
  /** Category of the issue */
  type: 'security' | 'accessibility' | 'completeness' | 'bounds' | 'format';
  /** Human-readable description */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
  /** Token path where the issue was found (e.g., "colors.primary") */
  path?: string;
}

/**
 * Result of theme validation.
 */
export interface ValidationResult {
  /** Whether the theme passes all validation checks */
  valid: boolean;
  /** List of issues found */
  issues: ValidationIssue[];
}

/**
 * Patterns that indicate potential script injection.
 * These are blocked in all string token values.
 */
const SCRIPT_INJECTION_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*data:/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<link[^>]*rel\s*=\s*['"]?import/i,
  /import\s*\(/i,
  /eval\s*\(/i,
  /@import/i,
] as const;

/**
 * Legal/required UI elements that themes must not attempt to hide or remove.
 * These are checked in CSS-like values.
 */
const PROTECTED_ELEMENTS = [
  'footer',
  'copyright',
  'legal',
  'privacy-policy',
  'terms-of-service',
  'powered-by',
  'accessibility-controls',
] as const;

/**
 * Patterns that indicate an attempt to hide elements via CSS.
 */
const HIDE_PATTERNS = [
  /display\s*:\s*none/i,
  /visibility\s*:\s*hidden/i,
  /opacity\s*:\s*0(?:\s|;|$)/i,
  /height\s*:\s*0/i,
  /overflow\s*:\s*hidden/i,
  /position\s*:\s*absolute.*left\s*:\s*-\d{4,}/i,
] as const;

/**
 * Check a string value for script injection attempts.
 */
function checkScriptInjection(value: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const pattern of SCRIPT_INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      issues.push({
        type: 'security',
        message: `Potential script injection detected in "${path}": value matches dangerous pattern`,
        severity: 'error',
        path,
      });
      break; // One security issue per value is enough
    }
  }

  return issues;
}

/**
 * Check a string value for attempts to hide legal/required elements.
 */
function checkLegalElementRemoval(value: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const element of PROTECTED_ELEMENTS) {
    if (value.toLowerCase().includes(element)) {
      for (const hidePattern of HIDE_PATTERNS) {
        if (hidePattern.test(value)) {
          issues.push({
            type: 'security',
            message: `Attempt to hide protected element "${element}" detected in "${path}"`,
            severity: 'error',
            path,
          });
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * Validate all string values in an object recursively for security issues.
 */
function validateStringSecurity(obj: unknown, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof obj === 'string') {
    issues.push(...checkScriptInjection(obj, basePath));
    issues.push(...checkLegalElementRemoval(obj, basePath));
    return issues;
  }

  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const path = basePath ? `${basePath}.${key}` : key;
      issues.push(...validateStringSecurity(value, path));
    }
  }

  return issues;
}

/**
 * Validate that required color tokens are present.
 */
function validateColorCompleteness(tokens: ThemeTokens): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const requiredToken of REQUIRED_COLOR_TOKENS) {
    if (!tokens.colors[requiredToken]) {
      issues.push({
        type: 'completeness',
        message: `Required color token "${requiredToken}" is missing`,
        severity: 'error',
        path: `colors.${requiredToken}`,
      });
    }
  }

  return issues;
}

/**
 * Validate typography values are within bounds.
 */
function validateTypographyBounds(tokens: ThemeTokens): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { typography } = tokens;

  if (
    typography.baseFontSize < TYPOGRAPHY_BOUNDS.baseFontSize.min ||
    typography.baseFontSize > TYPOGRAPHY_BOUNDS.baseFontSize.max
  ) {
    issues.push({
      type: 'bounds',
      message: `Base font size ${typography.baseFontSize}px is outside allowed range [${TYPOGRAPHY_BOUNDS.baseFontSize.min}, ${TYPOGRAPHY_BOUNDS.baseFontSize.max}]`,
      severity: 'error',
      path: 'typography.baseFontSize',
    });
  }

  if (
    typography.lineHeight < TYPOGRAPHY_BOUNDS.lineHeight.min ||
    typography.lineHeight > TYPOGRAPHY_BOUNDS.lineHeight.max
  ) {
    issues.push({
      type: 'bounds',
      message: `Line height ${typography.lineHeight} is outside allowed range [${TYPOGRAPHY_BOUNDS.lineHeight.min}, ${TYPOGRAPHY_BOUNDS.lineHeight.max}]`,
      severity: 'error',
      path: 'typography.lineHeight',
    });
  }

  if (typography.fontWeightNormal !== undefined) {
    if (
      typography.fontWeightNormal < TYPOGRAPHY_BOUNDS.fontWeight.min ||
      typography.fontWeightNormal > TYPOGRAPHY_BOUNDS.fontWeight.max
    ) {
      issues.push({
        type: 'bounds',
        message: `Font weight normal ${typography.fontWeightNormal} is outside allowed range [${TYPOGRAPHY_BOUNDS.fontWeight.min}, ${TYPOGRAPHY_BOUNDS.fontWeight.max}]`,
        severity: 'error',
        path: 'typography.fontWeightNormal',
      });
    }
  }

  if (typography.fontWeightBold !== undefined) {
    if (
      typography.fontWeightBold < TYPOGRAPHY_BOUNDS.fontWeight.min ||
      typography.fontWeightBold > TYPOGRAPHY_BOUNDS.fontWeight.max
    ) {
      issues.push({
        type: 'bounds',
        message: `Font weight bold ${typography.fontWeightBold} is outside allowed range [${TYPOGRAPHY_BOUNDS.fontWeight.min}, ${TYPOGRAPHY_BOUNDS.fontWeight.max}]`,
        severity: 'error',
        path: 'typography.fontWeightBold',
      });
    }
  }

  if (typography.scaleRatio !== undefined) {
    if (
      typography.scaleRatio < TYPOGRAPHY_BOUNDS.scaleRatio.min ||
      typography.scaleRatio > TYPOGRAPHY_BOUNDS.scaleRatio.max
    ) {
      issues.push({
        type: 'bounds',
        message: `Scale ratio ${typography.scaleRatio} is outside allowed range [${TYPOGRAPHY_BOUNDS.scaleRatio.min}, ${TYPOGRAPHY_BOUNDS.scaleRatio.max}]`,
        severity: 'error',
        path: 'typography.scaleRatio',
      });
    }
  }

  return issues;
}

/**
 * Validate spacing values are within bounds.
 */
function validateSpacingBounds(tokens: ThemeTokens): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { spacing } = tokens;

  if (spacing.unit < SPACING_BOUNDS.unit.min || spacing.unit > SPACING_BOUNDS.unit.max) {
    issues.push({
      type: 'bounds',
      message: `Spacing unit ${spacing.unit}px is outside allowed range [${SPACING_BOUNDS.unit.min}, ${SPACING_BOUNDS.unit.max}]`,
      severity: 'error',
      path: 'spacing.unit',
    });
  }

  if (spacing.scale && spacing.scale.length > SPACING_BOUNDS.maxScaleItems) {
    issues.push({
      type: 'bounds',
      message: `Spacing scale has ${spacing.scale.length} items, maximum is ${SPACING_BOUNDS.maxScaleItems}`,
      severity: 'error',
      path: 'spacing.scale',
    });
  }

  return issues;
}

/**
 * Validate theme assets.
 */
function validateAssets(assets: ThemeAssets | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!assets) return issues;

  if (assets.logoUrl && assets.logoUrl.length > ASSET_CONSTRAINTS.logoUrl.maxLength) {
    issues.push({
      type: 'bounds',
      message: `Logo URL exceeds maximum length of ${ASSET_CONSTRAINTS.logoUrl.maxLength}`,
      severity: 'error',
      path: 'assets.logoUrl',
    });
  }

  if (assets.logoAlt && assets.logoAlt.length > ASSET_CONSTRAINTS.logoAlt.maxLength) {
    issues.push({
      type: 'bounds',
      message: `Logo alt text exceeds maximum length of ${ASSET_CONSTRAINTS.logoAlt.maxLength}`,
      severity: 'error',
      path: 'assets.logoAlt',
    });
  }

  if (assets.faviconUrl && assets.faviconUrl.length > ASSET_CONSTRAINTS.faviconUrl.maxLength) {
    issues.push({
      type: 'bounds',
      message: `Favicon URL exceeds maximum length of ${ASSET_CONSTRAINTS.faviconUrl.maxLength}`,
      severity: 'error',
      path: 'assets.faviconUrl',
    });
  }

  // Validate asset URLs for security
  if (assets.logoUrl) {
    issues.push(...checkScriptInjection(assets.logoUrl, 'assets.logoUrl'));
  }
  if (assets.faviconUrl) {
    issues.push(...checkScriptInjection(assets.faviconUrl, 'assets.faviconUrl'));
  }
  if (assets.logoAlt) {
    issues.push(...checkScriptInjection(assets.logoAlt, 'assets.logoAlt'));
  }

  return issues;
}

/**
 * Validate a complete theme definition.
 *
 * Performs all validation checks:
 * 1. Security: script injection detection
 * 2. Security: legal element removal detection
 * 3. Completeness: required color tokens
 * 4. Bounds: typography within allowed ranges
 * 5. Bounds: spacing within allowed ranges
 * 6. Bounds: asset constraints
 * 7. Accessibility: WCAG 2.1 AA compliance (contrast, font sizes)
 */
export function validateTheme(definition: ThemeDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1 & 2. Security validation on all string values
  issues.push(...validateStringSecurity(definition.tokens, 'tokens'));
  if (definition.assets) {
    issues.push(...validateStringSecurity(definition.assets, 'assets'));
  }

  // 3. Color completeness
  issues.push(...validateColorCompleteness(definition.tokens));

  // 4. Typography bounds
  issues.push(...validateTypographyBounds(definition.tokens));

  // 5. Spacing bounds
  issues.push(...validateSpacingBounds(definition.tokens));

  // 6. Asset validation
  issues.push(...validateAssets(definition.assets));

  // 7. Accessibility validation (from backend-theme)
  const accessibilityResult = validateAccessibility(definition.tokens);
  for (const issue of accessibilityResult.issues) {
    issues.push({
      type: 'accessibility',
      message: issue.message,
      severity: issue.severity,
      path: `tokens.${issue.type}`,
    });
  }

  // Validate dark mode tokens if present
  if (definition.darkTokens) {
    issues.push(...validateStringSecurity(definition.darkTokens, 'darkTokens'));
    issues.push(...validateColorCompleteness(definition.darkTokens));
    issues.push(...validateTypographyBounds(definition.darkTokens));
    issues.push(...validateSpacingBounds(definition.darkTokens));

    const darkAccessibility = validateAccessibility(definition.darkTokens);
    for (const issue of darkAccessibility.issues) {
      issues.push({
        type: 'accessibility',
        message: `[Dark mode] ${issue.message}`,
        severity: issue.severity,
        path: `darkTokens.${issue.type}`,
      });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Validate only the security aspects of a theme (script injection, legal element removal).
 * Useful for quick pre-checks before full validation.
 */
export function validateThemeSecurity(definition: ThemeDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  issues.push(...validateStringSecurity(definition.tokens, 'tokens'));
  if (definition.assets) {
    issues.push(...validateStringSecurity(definition.assets, 'assets'));
  }
  if (definition.darkTokens) {
    issues.push(...validateStringSecurity(definition.darkTokens, 'darkTokens'));
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
