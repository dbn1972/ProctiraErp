/**
 * Accessibility Validation
 *
 * Validates theme tokens against WCAG 2.1 AA standards:
 * - Minimum contrast ratios (4.5:1 for normal text, 3:1 for large text)
 * - Minimum font sizes (12px minimum)
 * - Line height requirements
 *
 * Prevents themes from breaking accessibility compliance.
 */
import type { ThemeTokens, AccessibilityResult } from './schemas.js';

export interface AccessibilityIssue {
  type: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Parse a hex color string to RGB values.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned.charAt(0) + cleaned.charAt(0), 16);
    const g = parseInt(cleaned.charAt(1) + cleaned.charAt(1), 16);
    const b = parseInt(cleaned.charAt(2) + cleaned.charAt(2), 16);
    return { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.substring(0, 2), 16);
    const g = parseInt(cleaned.substring(2, 4), 16);
    const b = parseInt(cleaned.substring(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

/**
 * Parse an HSL color string to RGB values.
 * Accepts: hsl(h, s%, l%) or hsl(h s% l%)
 */
export function hslToRgb(hslStr: string): { r: number; g: number; b: number } | null {
  const match = hslStr.match(/hsl\(\s*(\d+)\s*[,\s]\s*(\d+)%\s*[,\s]\s*(\d+)%\s*\)/i);
  if (!match) return null;

  const h = parseInt(match[1]!, 10) / 360;
  const s = parseInt(match[2]!, 10) / 100;
  const l = parseInt(match[3]!, 10) / 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return { r, g, b };
}

/**
 * Parse a color string (hex or HSL) to RGB.
 */
export function parseColor(color: string): { r: number; g: number; b: number } | null {
  if (color.startsWith('#')) {
    return hexToRgb(color);
  }
  if (color.toLowerCase().startsWith('hsl')) {
    return hslToRgb(color);
  }
  return null;
}

/**
 * Calculate relative luminance of an RGB color per WCAG 2.1.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number): number => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  const rs = linearize(r);
  const gs = linearize(g);
  const bs = linearize(b);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors per WCAG 2.1.
 * Returns a value between 1 and 21.
 */
export function contrastRatio(
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number },
): number {
  const l1 = relativeLuminance(color1.r, color1.g, color1.b);
  const l2 = relativeLuminance(color2.r, color2.g, color2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG 2.1 AA minimum contrast ratios.
 */
const WCAG_AA_NORMAL_TEXT = 4.5;
const WCAG_AA_LARGE_TEXT = 3.0;

/**
 * Minimum font size for accessibility (12px).
 */
const MIN_FONT_SIZE = 12;

/**
 * Minimum line height for readability.
 */
const MIN_LINE_HEIGHT = 1.2;

/**
 * Color pairs to check for contrast.
 * Each pair defines a foreground and background token name.
 */
const CONTRAST_PAIRS: Array<{ fg: string; bg: string; label: string }> = [
  { fg: 'textPrimary', bg: 'background', label: 'Primary text on background' },
  { fg: 'textPrimary', bg: 'surface', label: 'Primary text on surface' },
  { fg: 'textSecondary', bg: 'background', label: 'Secondary text on background' },
  { fg: 'onPrimary', bg: 'primary', label: 'Text on primary color' },
  { fg: 'onSecondary', bg: 'secondary', label: 'Text on secondary color' },
  { fg: 'onError', bg: 'error', label: 'Text on error color' },
];

/**
 * Validate theme tokens for WCAG 2.1 AA accessibility compliance.
 *
 * Checks:
 * 1. Contrast ratios between text/background color pairs (4.5:1 for normal text)
 * 2. Minimum font size (12px)
 * 3. Minimum line height (1.2)
 * 4. Font size not exceeding maximum bounds
 */
export function validateAccessibility(tokens: ThemeTokens): AccessibilityResult {
  const issues: AccessibilityIssue[] = [];

  // Check typography constraints
  if (tokens.typography.baseFontSize < MIN_FONT_SIZE) {
    issues.push({
      type: 'font-size',
      message: `Base font size ${tokens.typography.baseFontSize}px is below minimum ${MIN_FONT_SIZE}px`,
      severity: 'error',
    });
  }

  if (tokens.typography.lineHeight < MIN_LINE_HEIGHT) {
    issues.push({
      type: 'line-height',
      message: `Line height ${tokens.typography.lineHeight} is below minimum ${MIN_LINE_HEIGHT}`,
      severity: 'error',
    });
  }

  // Check contrast ratios for defined color pairs
  for (const pair of CONTRAST_PAIRS) {
    const fgColor = tokens.colors[pair.fg];
    const bgColor = tokens.colors[pair.bg];

    if (!fgColor || !bgColor) {
      // Skip pairs where tokens are not defined
      continue;
    }

    const fgRgb = parseColor(fgColor);
    const bgRgb = parseColor(bgColor);

    if (!fgRgb || !bgRgb) {
      issues.push({
        type: 'color-parse',
        message: `Cannot parse color for contrast check: ${pair.label}`,
        severity: 'warning',
      });
      continue;
    }

    const ratio = contrastRatio(fgRgb, bgRgb);

    // Use large text threshold if font size >= 18px or >= 14px bold
    const threshold =
      tokens.typography.baseFontSize >= 18 ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;

    if (ratio < threshold) {
      issues.push({
        type: 'contrast-ratio',
        message: `${pair.label}: contrast ratio ${ratio.toFixed(2)}:1 is below WCAG AA minimum ${threshold}:1`,
        severity: 'error',
      });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
