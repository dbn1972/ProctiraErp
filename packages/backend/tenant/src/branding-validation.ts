/**
 * Tenant Branding — Server-side Validation Guards (Task 58.4)
 *
 * Enforces the publish-time invariants documented in Design §N
 * (Validation guards) and Requirement 28 acceptance criteria 7–9:
 *
 *   • Logo (`--tenant-logo`)
 *       - SVG (`image/svg+xml`) or PNG (`image/png`)
 *       - Dimensions ≤ 200 × 60 px (SVG via viewBox / width-height
 *         attrs, PNG via IHDR chunk)
 *
 *   • Favicon (`--tenant-favicon`)
 *       - 32 × 32 px exactly
 *       - ICO (`image/x-icon` / `image/vnd.microsoft.icon`) or
 *         PNG (`image/png`)
 *
 *   • Primary color (`--tenant-primary`)
 *       - Contrast ratio ≥ 4.5:1 against `#FFFFFF`
 *         (WCAG 2.1 AA — Requirement 28 AC 8)
 *
 *   • Accent color (`--tenant-accent`)
 *       - Contrast ratio ≥ 3:1 against `#FFFFFF`
 *         (WCAG 2.1 AA — Requirement 28 AC 9)
 *
 * Tokens whose values are external/CDN URLs (e.g. `url("/cdn/.../logo.svg")`)
 * are treated as already-validated upload artifacts and are not re-probed
 * here — the tenant SDK runs upload-time dimension and MIME-type checks
 * before issuing the CDN URL. The publish guard re-validates only the
 * data this layer can see (inline `data:` URIs and CSS color values).
 *
 * The validator is deliberately a pure function over the tokens record
 * so it can be unit-tested in isolation without spinning up Fastify or
 * the tenant repository.
 */
import type { FieldError } from '@proctira/common';

import type { ThemeTokens } from './schemas.js';

// ─── Public API ──────────────────────────────────────────────────────────────

export type BrandingValidationResult =
  | { ok: true }
  | { ok: false; errors: FieldError[] };

/**
 * Validate the publishable tenant theme tokens.
 *
 * The function inspects the four canonical tenant override tokens:
 *
 *   `--tenant-logo`      ≤ 200 × 60 px,  SVG / PNG
 *   `--tenant-favicon`   = 32 × 32 px,    ICO / PNG
 *   `--tenant-primary`   ≥ 4.5:1 against white
 *   `--tenant-accent`    ≥ 3:1   against white
 *
 * Tokens that are absent are skipped (the tenant is allowed to inherit
 * the platform default for any single slot). Tokens whose values are
 * non-data URLs are also skipped — content-shape probes happen at upload
 * time, not at publish time.
 */
export function validateBrandingTokens(
  tokens: ThemeTokens,
): BrandingValidationResult {
  const errors: FieldError[] = [];

  if (Object.prototype.hasOwnProperty.call(tokens, '--tenant-primary')) {
    const error = validateColorToken(
      tokens['--tenant-primary'],
      'tokens.--tenant-primary',
      4.5,
      'primary brand color',
    );
    if (error) errors.push(error);
  }

  if (Object.prototype.hasOwnProperty.call(tokens, '--tenant-accent')) {
    const error = validateColorToken(
      tokens['--tenant-accent'],
      'tokens.--tenant-accent',
      3,
      'accent brand color',
    );
    if (error) errors.push(error);
  }

  if (Object.prototype.hasOwnProperty.call(tokens, '--tenant-logo')) {
    const fieldErrors = validateLogoToken(
      tokens['--tenant-logo'],
      'tokens.--tenant-logo',
    );
    errors.push(...fieldErrors);
  }

  if (Object.prototype.hasOwnProperty.call(tokens, '--tenant-favicon')) {
    const fieldErrors = validateFaviconToken(
      tokens['--tenant-favicon'],
      'tokens.--tenant-favicon',
    );
    errors.push(...fieldErrors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── Color validation ────────────────────────────────────────────────────────

/**
 * Validate a single color token against a minimum contrast ratio
 * versus pure white (`#FFFFFF`).
 *
 * @returns `null` when valid, or a `FieldError` describing the failure.
 */
function validateColorToken(
  rawValue: unknown,
  field: string,
  minContrast: number,
  label: string,
): FieldError | null {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return {
      field,
      rule: 'type',
      message: `Expected ${label} to be a CSS color string`,
    };
  }

  const rgb = parseCssColor(rawValue);
  if (!rgb) {
    return {
      field,
      rule: 'format',
      message: `Could not parse ${label} '${rawValue}' as a hex or hsl() color`,
    };
  }

  const ratio = contrastRatioAgainstWhite(rgb);
  if (ratio < minContrast) {
    return {
      field,
      rule: 'contrast',
      message:
        `The ${label} '${rawValue}' has a contrast ratio of ` +
        `${ratio.toFixed(2)}:1 against white, which is below the required ` +
        `${minContrast}:1 (WCAG 2.1 AA). Choose a darker color.`,
    };
  }

  return null;
}

interface RgbColor {
  /** sRGB channel value in [0, 1]. */
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS color string into a normalised sRGB triple in `[0, 1]`.
 *
 * Supported forms:
 *   - `#RGB`      (3-digit hex, optionally with alpha as `#RGBA`)
 *   - `#RRGGBB`   (6-digit hex, optionally with alpha as `#RRGGBBAA`)
 *   - `rgb(r, g, b)` / `rgb(r g b)` — channels in `[0, 255]`
 *   - `hsl(h, s%, l%)` / `hsl(h s% l%)` — hue in degrees, S/L as percentages
 *
 * Returns `null` for unparseable input. Alpha channels are ignored — the
 * contrast guard treats colors as opaque (the brand color must work
 * against white regardless of any decorative transparency).
 */
export function parseCssColor(input: string): RgbColor | null {
  const value = input.trim().toLowerCase();

  // Hex form
  if (value.startsWith('#')) {
    return parseHex(value);
  }

  // Functional form — rgb() or hsl(), with or without alpha
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
    case 3: // #RGB
    case 4: // #RGBA — alpha ignored
      r = parseInt(hex[0]! + hex[0]!, 16);
      g = parseInt(hex[1]! + hex[1]!, 16);
      b = parseInt(hex[2]! + hex[2]!, 16);
      break;
    case 6: // #RRGGBB
    case 8: // #RRGGBBAA — alpha ignored
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
  // Hue may carry deg/turn/rad/grad; we accept a bare number or `<n>deg`.
  let h = parseFloat(hs.replace(/(deg|turn|rad|grad)$/, ''));
  if (Number.isNaN(h)) return null;
  if (hs.endsWith('turn')) h *= 360;
  else if (hs.endsWith('rad')) h *= 180 / Math.PI;
  else if (hs.endsWith('grad')) h *= 0.9;

  // Saturation and lightness must carry a `%`.
  if (!ss.endsWith('%') || !ls.endsWith('%')) return null;
  const s = parseFloat(ss.slice(0, -1)) / 100;
  const l = parseFloat(ls.slice(0, -1)) / 100;
  if (Number.isNaN(s) || Number.isNaN(l)) return null;

  return hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  // Normalise hue to `[0, 360)`.
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
 * Convert an sRGB channel in `[0, 1]` to its linear-light equivalent
 * using the WCAG 2.1 transfer function.
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute the WCAG 2.1 relative luminance of an sRGB color.
 */
export function relativeLuminance({ r, g, b }: RgbColor): number {
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/**
 * Compute the contrast ratio of a color against pure white (`#FFFFFF`).
 *
 * Returns a value in `[1, 21]` per WCAG 2.1 §1.4.3.
 */
export function contrastRatioAgainstWhite(color: RgbColor): number {
  const l = relativeLuminance(color);
  // Luminance of white is 1.0 → contrast simplifies to (1.05) / (l + 0.05).
  return 1.05 / (l + 0.05);
}

// ─── Logo / Favicon validation ───────────────────────────────────────────────

interface ImageProbe {
  /** Lowercased MIME type, e.g. `image/svg+xml` or `image/png`. */
  mimeType: string;
  /** Decoded image bytes (Uint8Array) for binary formats; the raw SVG
   *  text is stored in `svgSource` instead of `data` for SVG. */
  data?: Uint8Array;
  svgSource?: string;
}

const ALLOWED_LOGO_MIMES = new Set(['image/svg+xml', 'image/png']);
const ALLOWED_FAVICON_MIMES = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/png',
]);

const LOGO_MAX_WIDTH = 200;
const LOGO_MAX_HEIGHT = 60;
const FAVICON_DIMENSION = 32;

/**
 * Validate the logo token.
 *
 * Recognises three input shapes:
 *   1. CSS `url("...")` wrapper around a `data:` URI — fully validated
 *      (MIME type + dimensions parsed from SVG viewBox or PNG IHDR).
 *   2. A bare `data:` URI string — same validation as (1).
 *   3. CSS `url("...")` wrapper around an external URL (https / cdn path)
 *      — accepted; the upload pipeline owns content validation for
 *      these. The publish guard cannot fetch remote bytes synchronously.
 *
 * Anything else is rejected as malformed.
 */
function validateLogoToken(rawValue: unknown, field: string): FieldError[] {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return [
      {
        field,
        rule: 'type',
        message: 'Expected logo to be a CSS url(...) or data: URI string',
      },
    ];
  }

  const probe = probeImageToken(rawValue);
  if (probe === 'external-url') {
    return [];
  }
  if (probe === null) {
    return [
      {
        field,
        rule: 'format',
        message: `Could not parse logo value '${rawValue}'. Expected url("data:image/svg+xml;base64,…"), url("data:image/png;base64,…"), or an external CDN URL.`,
      },
    ];
  }

  const errors: FieldError[] = [];

  if (!ALLOWED_LOGO_MIMES.has(probe.mimeType)) {
    errors.push({
      field,
      rule: 'mimeType',
      message: `Logo MIME type '${probe.mimeType}' is not supported. Use image/svg+xml or image/png.`,
    });
    return errors;
  }

  const dims = readImageDimensions(probe);
  if (!dims) {
    errors.push({
      field,
      rule: 'format',
      message: `Could not determine logo dimensions for MIME type '${probe.mimeType}'.`,
    });
    return errors;
  }

  if (dims.width > LOGO_MAX_WIDTH || dims.height > LOGO_MAX_HEIGHT) {
    errors.push({
      field,
      rule: 'dimensions',
      message:
        `Logo dimensions ${dims.width}×${dims.height}px exceed the maximum ` +
        `${LOGO_MAX_WIDTH}×${LOGO_MAX_HEIGHT}px allowed by Requirement 28 AC 7.`,
    });
  }

  return errors;
}

/**
 * Validate the favicon token.
 *
 * Same input-shape recognition as `validateLogoToken`, but the dimension
 * check enforces an exact `32 × 32` square per Requirement 28 AC 7.
 */
function validateFaviconToken(rawValue: unknown, field: string): FieldError[] {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return [
      {
        field,
        rule: 'type',
        message: 'Expected favicon to be a CSS url(...) or data: URI string',
      },
    ];
  }

  const probe = probeImageToken(rawValue);
  if (probe === 'external-url') {
    return [];
  }
  if (probe === null) {
    return [
      {
        field,
        rule: 'format',
        message: `Could not parse favicon value '${rawValue}'. Expected url("data:image/x-icon;base64,…") or url("data:image/png;base64,…").`,
      },
    ];
  }

  const errors: FieldError[] = [];

  if (!ALLOWED_FAVICON_MIMES.has(probe.mimeType)) {
    errors.push({
      field,
      rule: 'mimeType',
      message: `Favicon MIME type '${probe.mimeType}' is not supported. Use image/x-icon or image/png.`,
    });
    return errors;
  }

  const dims = readImageDimensions(probe);
  if (!dims) {
    errors.push({
      field,
      rule: 'format',
      message: `Could not determine favicon dimensions for MIME type '${probe.mimeType}'.`,
    });
    return errors;
  }

  if (dims.width !== FAVICON_DIMENSION || dims.height !== FAVICON_DIMENSION) {
    errors.push({
      field,
      rule: 'dimensions',
      message:
        `Favicon dimensions ${dims.width}×${dims.height}px do not equal the ` +
        `required ${FAVICON_DIMENSION}×${FAVICON_DIMENSION}px (Requirement 28 AC 7).`,
    });
  }

  return errors;
}

/**
 * Inspect an image token value and return:
 *
 *   - `ImageProbe` with the decoded payload when the value is a data URI
 *     (or a `url("data:…")` CSS wrapper).
 *   - `'external-url'` when the value is an external URL (`https://…`,
 *     `http://…`, or a path-only `/cdn/…`) wrapped in `url(...)` or
 *     supplied bare. These are accepted because upload-time validation
 *     owns content checks.
 *   - `null` for malformed inputs.
 */
function probeImageToken(rawValue: string): ImageProbe | 'external-url' | null {
  const stripped = stripCssUrlWrapper(rawValue.trim());
  if (stripped === null) return null;

  if (stripped.startsWith('data:')) {
    return decodeDataUri(stripped);
  }

  // Treat anything else as an external/CDN URL the upload pipeline
  // already validated.
  if (
    stripped.startsWith('http://') ||
    stripped.startsWith('https://') ||
    stripped.startsWith('/')
  ) {
    return 'external-url';
  }

  return null;
}

/**
 * Strip CSS `url(...)` wrapper and any surrounding quotes.
 *
 * Returns the inner string, or `null` if the wrapper is malformed.
 * If the input is not wrapped in `url(...)`, returns the input as-is.
 */
function stripCssUrlWrapper(value: string): string | null {
  const lower = value.toLowerCase();
  if (!lower.startsWith('url(')) {
    return value;
  }

  if (!value.endsWith(')')) {
    return null;
  }

  let inner = value.slice(4, -1).trim();
  if (
    (inner.startsWith('"') && inner.endsWith('"')) ||
    (inner.startsWith("'") && inner.endsWith("'"))
  ) {
    inner = inner.slice(1, -1);
  }
  return inner;
}

/**
 * Decode a `data:` URI into an `ImageProbe`.
 *
 * Recognises both base64 (`;base64,…`) and percent-encoded payloads.
 */
function decodeDataUri(uri: string): ImageProbe | null {
  // data:[<mediatype>][;base64],<data>
  const commaIdx = uri.indexOf(',');
  if (commaIdx < 0) return null;

  const meta = uri.slice(5, commaIdx); // strip "data:"
  const payload = uri.slice(commaIdx + 1);

  const metaParts = meta.split(';').filter((p) => p.length > 0);
  const isBase64 = metaParts[metaParts.length - 1] === 'base64';
  const mimeType = (metaParts[0] ?? 'text/plain').toLowerCase();

  let bytes: Uint8Array;
  let svgSource: string | undefined;
  try {
    if (isBase64) {
      bytes = Uint8Array.from(Buffer.from(payload, 'base64'));
    } else {
      const decoded = decodeURIComponent(payload);
      bytes = new TextEncoder().encode(decoded);
    }
  } catch {
    return null;
  }

  if (mimeType === 'image/svg+xml') {
    svgSource = new TextDecoder('utf-8').decode(bytes);
    return { mimeType, svgSource };
  }
  return { mimeType, data: bytes };
}

interface ImageDimensions {
  width: number;
  height: number;
}

function readImageDimensions(probe: ImageProbe): ImageDimensions | null {
  switch (probe.mimeType) {
    case 'image/svg+xml':
      return probe.svgSource ? readSvgDimensions(probe.svgSource) : null;
    case 'image/png':
      return probe.data ? readPngDimensions(probe.data) : null;
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return probe.data ? readIcoDimensions(probe.data) : null;
    default:
      return null;
  }
}

/**
 * Extract the rendered dimensions of an SVG document.
 *
 * Preference order (mirrors how browsers resolve `<svg>` size):
 *   1. Numeric `width` & `height` attributes on the root `<svg>`.
 *   2. The third and fourth values of the `viewBox` attribute.
 *
 * Width / height that carry `%` are treated as unspecified — those SVGs
 * scale to their container and have no intrinsic raster size, so the
 * 200×60 cap is interpreted relative to the viewBox.
 */
export function readSvgDimensions(source: string): ImageDimensions | null {
  // Locate the opening <svg ...> tag; SVG comments / XML prologues are skipped.
  const svgTagMatch = source.match(/<svg\b[^>]*>/i);
  if (!svgTagMatch) return null;
  const svgTag = svgTagMatch[0];

  const widthAttr = matchAttr(svgTag, 'width');
  const heightAttr = matchAttr(svgTag, 'height');

  const w = parseSvgLength(widthAttr);
  const h = parseSvgLength(heightAttr);
  if (w !== null && h !== null) {
    return { width: w, height: h };
  }

  const viewBox = matchAttr(svgTag, 'viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.slice(0, 4).every((n) => !Number.isNaN(n))) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }

  return null;
}

function matchAttr(tag: string, name: string): string | null {
  // Match name="value" or name='value' (case-insensitive on the name).
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i');
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function parseSvgLength(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) return null; // relative — unknown raster size
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse the IHDR chunk of a PNG file.
 *
 * PNG layout (RFC 2083 §11.2): 8-byte signature, then the IHDR chunk:
 *
 *   offset 0..7   : signature (89 50 4E 47 0D 0A 1A 0A)
 *   offset 8..11  : IHDR length (always 13, big-endian)
 *   offset 12..15 : 'IHDR' chunk type
 *   offset 16..19 : width  (uint32 BE)
 *   offset 20..23 : height (uint32 BE)
 *
 * Returns `null` if the signature is wrong or the file is too short.
 */
export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== signature[i]) return null;
  }

  // IHDR must be the first chunk.
  const ihdrType = String.fromCharCode(
    bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!,
  );
  if (ihdrType !== 'IHDR') return null;

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return { width, height };
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

/**
 * Parse the dimensions of the first directory entry of an ICO container.
 *
 * ICO layout: 6-byte ICONDIR header followed by 16-byte ICONDIRENTRY records.
 * The first byte of each entry is the width (`0` ⇒ 256), the second is the
 * height (`0` ⇒ 256).
 */
export function readIcoDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 22) return null;
  // ICONDIR: reserved (2), type (2), count (2)
  const reserved = bytes[0]! | (bytes[1]! << 8);
  const type = bytes[2]! | (bytes[3]! << 8);
  if (reserved !== 0 || type !== 1) return null;

  // First ICONDIRENTRY starts at offset 6.
  const w = bytes[6]!;
  const h = bytes[7]!;
  return {
    width: w === 0 ? 256 : w,
    height: h === 0 ? 256 : h,
  };
}
