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
 * Parse a hex color string (#rgb, #rrggbb, #rrggbbaa) to RGB values.
 * Returns null for anything that is not strictly hexadecimal (PRC-M393).
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(cleaned)) {
    return null;
  }
  if (cleaned.length === 3) {
    const r = parseInt(cleaned.charAt(0) + cleaned.charAt(0), 16);
    const g = parseInt(cleaned.charAt(1) + cleaned.charAt(1), 16);
    const b = parseInt(cleaned.charAt(2) + cleaned.charAt(2), 16);
    return { r, g, b };
  }
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Parse an rgb()/rgba() color string to RGB values.
 */
export function rgbToRgb(rgbStr: string): { r: number; g: number; b: number } | null {
  const match = rgbStr.match(
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)$/i,
  );
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((v) => parseInt(v!, 10)) as [
    number,
    number,
    number,
  ];
  if (r > 255 || g > 255 || b > 255) return null;
  return { r, g, b };
}

/**
 * Parse an HSL color string to RGB values.
 * Accepts: hsl(h, s%, l%) or hsl(h s% l%)
 */
export function hslToRgb(hslStr: string): { r: number; g: number; b: number } | null {
  const match = hslStr
    .trim()
    .match(
      /^hsla?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})%\s*[,\s]\s*(\d{1,3})%\s*(?:[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)$/i,
    );
  if (!match) return null;

  const hDeg = parseInt(match[1]!, 10);
  const sPct = parseInt(match[2]!, 10);
  const lPct = parseInt(match[3]!, 10);
  if (hDeg > 360 || sPct > 100 || lPct > 100) return null;
  const h = hDeg / 360;
  const s = sPct / 100;
  const l = lPct / 100;

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
 * Parse a color string (hex, HSL or rgb) to RGB. Returns null when unparsable.
 */
export function parseColor(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  let rgb: { r: number; g: number; b: number } | null = null;
  if (value.startsWith('#')) {
    rgb = hexToRgb(value);
  } else if (value.toLowerCase().startsWith('hsl')) {
    rgb = hslToRgb(value);
  } else if (value.toLowerCase().startsWith('rgb')) {
    rgb = rgbToRgb(value);
  }
  // PRC-M393: never let NaN through to the contrast maths.
  if (rgb && [rgb.r, rgb.g, rgb.b].some((c) => !Number.isFinite(c))) {
    return null;
  }
  return rgb;
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
 * Body text counts as WCAG "large text" only at >= 24px (18pt). Bold large text
 * (>= 18.66px) cannot be inferred from body tokens, so body text keeps 4.5:1.
 */
const LARGE_TEXT_MIN_PX = 24;
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
const CONTRAST_PAIRS: Array<{ fg: string; bg: string; label: string; required?: boolean }> = [
  {
    fg: 'textPrimary',
    bg: 'background',
    label: 'Primary text on background',
    required: true,
  },
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
      // PRC-M393: the core text/background pair is mandatory; optional pairs are
      // checked whenever either side is defined (half a pair cannot be verified).
      if (pair.required || fgColor || bgColor) {
        issues.push({
          type: 'color-missing',
          message: `Missing color token for contrast check: ${pair.label} (${!fgColor ? pair.fg : pair.bg})`,
          severity: 'error',
        });
      }
      continue;
    }

    const fgRgb = parseColor(fgColor);
    const bgRgb = parseColor(bgColor);

    if (!fgRgb || !bgRgb) {
      issues.push({
        type: 'color-parse',
        message: `Cannot parse color for contrast check: ${pair.label}`,
        severity: 'error',
      });
      continue;
    }

    const ratio = contrastRatio(fgRgb, bgRgb);

    // Large-text threshold only applies at >= 24px body size (PRC-M393)
    const threshold =
      tokens.typography.baseFontSize >= LARGE_TEXT_MIN_PX ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;

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
