/**
 * Client-side contrast helpers for Settings → Branding (Task 59.2).
 *
 * Mirrors the WCAG 2.1 §1.4.3 luminance/contrast math used by:
 *
 *   • `tools/scripts/check-contrast.mjs` (Task 56.2 — CI gate that ensures
 *     every semantic-token pair clears 7:1 in light and dark modes).
 *   • `packages/backend/tenant/src/branding-validation.ts` (Task 58.4 —
 *     publish-time guards that reject primary < 4.5:1 or accent < 3:1
 *     against pure white).
 *
 * Keeping the algorithm in lockstep on both sides avoids the "looks fine
 * in the picker, server says no" UX trap: the on-the-fly contrast number
 * the user sees in the form matches the value `validateBrandingTokens()`
 * will compute when they hit Publish. Requirement 28 AC 8 (≥ 4.5:1
 * primary) and AC 9 (≥ 3:1 accent) are enforced both client- and
 * server-side; this module only owns the client read-out.
 *
 * Inputs accepted:
 *   • `#RGB`, `#RRGGBB` (with or without an ignored alpha channel)
 *   • `rgb(r,g,b)` / `rgba(r,g,b,a)` (`r,g,b` in `0–255` or as `0–100%`)
 *   • `hsl(h,s%,l%)` / `hsla(h,s%,l%,a)` (`h` in degrees, optionally
 *     suffixed with `deg`/`turn`/`rad`/`grad`)
 *
 * Outputs:
 *   • `parseColor()` returns an `{ r, g, b }` triple in `[0, 1]`, or
 *     `null` when the input is unparseable.
 *   • `contrastRatioAgainstWhite()` returns a value in `[1, 21]` per
 *     WCAG. Helpers `isPrimaryColorAccessible()` and
 *     `isAccentColorAccessible()` apply the spec thresholds.
 */

/** WCAG 2.1 AA threshold for primary (normal-text) color contrast. */
export const PRIMARY_CONTRAST_THRESHOLD = 4.5;

/** WCAG 2.1 AA threshold for accent (large-text / decorative) color contrast. */
export const ACCENT_CONTRAST_THRESHOLD = 3;

/** Pure white reference per the publish-time guard (`#FFFFFF`). */
export const WHITE_LUMINANCE = 1;

/** Normalised sRGB triple in `[0, 1]` per channel. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS color string into a normalised sRGB triple in `[0, 1]`.
 *
 * Accepts `#RGB`, `#RRGGBB`, `rgb(...)`, `rgba(...)`, `hsl(...)`,
 * `hsla(...)`. Alpha channels are ignored — the contrast guard treats
 * brand colors as opaque against the white reference background.
 *
 * Returns `null` for malformed input so callers can render a "could not
 * parse" hint without throwing.
 */
export function parseColor(input: string): RgbColor | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  if (value.startsWith('#')) return parseHex(value);

  const fnMatch = value.match(/^([a-z]+)\(([^)]+)\)$/);
  if (fnMatch) {
    const fn = fnMatch[1]!;
    const args = fnMatch[2]!
      .split(/[\s,/]+/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0);
    if ((fn === 'rgb' || fn === 'rgba') && args.length >= 3) {
      return parseRgb(args[0]!, args[1]!, args[2]!);
    }
    if ((fn === 'hsl' || fn === 'hsla') && args.length >= 3) {
      return parseHsl(args[0]!, args[1]!, args[2]!);
    }
  }

  return null;
}

function parseHex(value: string): RgbColor | null {
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  let r: number;
  let g: number;
  let b: number;
  switch (hex.length) {
    case 3:
    case 4:
      r = parseInt(hex[0]! + hex[0]!, 16);
      g = parseInt(hex[1]! + hex[1]!, 16);
      b = parseInt(hex[2]! + hex[2]!, 16);
      break;
    case 6:
    case 8:
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      break;
    default:
      return null;
  }

  return { r: r / 255, g: g / 255, b: b / 255 };
}

function parseRgb(rs: string, gs: string, bs: string): RgbColor | null {
  const r = parseChannel(rs, 255);
  const g = parseChannel(gs, 255);
  const b = parseChannel(bs, 255);
  if (r === null || g === null || b === null) return null;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

function parseChannel(piece: string, max: number): number | null {
  if (piece.endsWith('%')) {
    const n = parseFloat(piece.slice(0, -1));
    if (Number.isNaN(n)) return null;
    return clamp((n / 100) * max, 0, max);
  }
  const n = parseFloat(piece);
  if (Number.isNaN(n)) return null;
  return clamp(n, 0, max);
}

function parseHsl(hs: string, ss: string, ls: string): RgbColor | null {
  let h = parseFloat(hs.replace(/(deg|turn|rad|grad)$/, ''));
  if (Number.isNaN(h)) return null;
  if (hs.endsWith('turn')) h *= 360;
  else if (hs.endsWith('rad')) h *= 180 / Math.PI;
  else if (hs.endsWith('grad')) h *= 0.9;

  if (!ss.endsWith('%') || !ls.endsWith('%')) return null;
  const s = parseFloat(ss.slice(0, -1)) / 100;
  const l = parseFloat(ls.slice(0, -1)) / 100;
  if (Number.isNaN(s) || Number.isNaN(l)) return null;

  return hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: r1 + m, g: g1 + m, b: b1 + m };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Convert one sRGB channel in `[0, 1]` to its linear-light equivalent
 * using the WCAG 2.1 transfer function.
 */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance for an sRGB color. */
export function relativeLuminance({ r, g, b }: RgbColor): number {
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/**
 * Contrast ratio of a color against pure white (`#FFFFFF`).
 *
 * Returns a value in `[1, 21]` per WCAG 2.1 §1.4.3. White's luminance is
 * `1.0` so the ratio simplifies to `1.05 / (l + 0.05)`.
 */
export function contrastRatioAgainstWhite(color: RgbColor): number {
  const l = relativeLuminance(color);
  return 1.05 / (l + 0.05);
}

/**
 * Compute the contrast ratio for a CSS color string against white.
 * Returns `null` if the input is unparseable so the form can render
 * "—" instead of a misleading 1:1 reading.
 */
export function getContrastRatio(input: string): number | null {
  const rgb = parseColor(input);
  if (!rgb) return null;
  return contrastRatioAgainstWhite(rgb);
}

/**
 * Apply the spec thresholds to a parsed color string.
 *
 * Mirrors `validateColorToken()` in `branding-validation.ts` so the
 * client form's red/green status flag matches the publish-time guard.
 */
export function isContrastAccessible(
  ratio: number | null,
  threshold: number,
): boolean {
  return typeof ratio === 'number' && ratio >= threshold;
}

export function isPrimaryColorAccessible(input: string): boolean {
  return isContrastAccessible(getContrastRatio(input), PRIMARY_CONTRAST_THRESHOLD);
}

export function isAccentColorAccessible(input: string): boolean {
  return isContrastAccessible(getContrastRatio(input), ACCENT_CONTRAST_THRESHOLD);
}
