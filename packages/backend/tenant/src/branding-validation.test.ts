/**
 * Tenant Branding Validation Guards — Unit Tests (Task 58.4)
 *
 * Each validator is exercised with both passing and failing inputs.
 * Together they cover Requirement 28 acceptance criteria 7-9:
 *
 *   AC 7 — logo (≤200×60 SVG/PNG) and favicon (32×32 ICO/PNG)
 *   AC 8 — primary color contrast ≥ 4.5:1 against white
 *   AC 9 — accent color contrast  ≥ 3:1 against white
 */
import { describe, it, expect } from 'vitest';

import {
  validateBrandingTokens,
  parseCssColor,
  contrastRatioAgainstWhite,
  readSvgDimensions,
  readPngDimensions,
  readIcoDimensions,
} from './branding-validation.js';
import type { ThemeTokens } from './schemas.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid PNG with the requested pixel dimensions.
 *
 * Only the IHDR chunk is needed for `readPngDimensions`; everything else
 * (IDAT / IEND) is omitted because the dimension probe stops after IHDR.
 */
function buildPng(width: number, height: number): Uint8Array {
  // 8-byte signature + 4-byte length(13) + 4-byte 'IHDR' + 13-byte data.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const length = [0, 0, 0, 13];
  const ihdr = [0x49, 0x48, 0x44, 0x52];
  const w = [
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
  ];
  const h = [
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ];
  // 5 trailing IHDR fields: bit depth, color type, compression, filter, interlace
  const trailing = [8, 6, 0, 0, 0];
  // 4-byte placeholder CRC (the validator never verifies CRC).
  const crc = [0, 0, 0, 0];
  return Uint8Array.from([
    ...sig, ...length, ...ihdr, ...w, ...h, ...trailing, ...crc,
  ]);
}

/**
 * Build a minimal valid ICO container whose first directory entry has the
 * requested dimensions.
 */
function buildIco(width: number, height: number): Uint8Array {
  const widthByte = width === 256 ? 0 : width;
  const heightByte = height === 256 ? 0 : height;
  // ICONDIR: reserved=0, type=1, count=1
  const header = [0, 0, 1, 0, 1, 0];
  // ICONDIRENTRY: width, height, color count, reserved, planes(2), bitcount(2),
  // bytes-in-resource(4), image-offset(4)
  const entry = [
    widthByte, heightByte, 0, 0, 1, 0, 32, 0,
    0, 0, 0, 0, 0x16, 0, 0, 0,
  ];
  return Uint8Array.from([...header, ...entry]);
}

/** Encode bytes as a `data:` URI. */
function dataUri(mimeType: string, bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

/** Wrap any string in a CSS `url("…")` token. */
function urlToken(inner: string): string {
  return `url("${inner}")`;
}

// ─── Color parsing ──────────────────────────────────────────────────────────

describe('parseCssColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseCssColor('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('parses 3-digit hex via duplication', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseCssColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses hex with alpha (alpha is ignored)', () => {
    expect(parseCssColor('#000000ff')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses rgb() values', () => {
    const c = parseCssColor('rgb(255, 0, 0)');
    expect(c).not.toBeNull();
    expect(c!.r).toBeCloseTo(1);
    expect(c!.g).toBeCloseTo(0);
    expect(c!.b).toBeCloseTo(0);
  });

  it('parses hsl() values', () => {
    // hsl(0, 0%, 0%) === black
    const c = parseCssColor('hsl(0, 0%, 0%)');
    expect(c).not.toBeNull();
    expect(c!.r).toBeCloseTo(0);
    expect(c!.g).toBeCloseTo(0);
    expect(c!.b).toBeCloseTo(0);
  });

  it('returns null for malformed input', () => {
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(parseCssColor('#zzz')).toBeNull();
    expect(parseCssColor('rgb(1)')).toBeNull();
  });
});

// ─── Contrast math ──────────────────────────────────────────────────────────

describe('contrastRatioAgainstWhite', () => {
  it('returns 21:1 for pure black', () => {
    expect(contrastRatioAgainstWhite({ r: 0, g: 0, b: 0 })).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for pure white', () => {
    expect(contrastRatioAgainstWhite({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5);
  });

  it('agrees with WCAG sample value (≈10.05 for hsl(222,47%,31%))', () => {
    const navy = parseCssColor('hsl(222, 47%, 31%)')!;
    expect(contrastRatioAgainstWhite(navy)).toBeGreaterThan(9);
  });
});

// ─── Image dimension probes ─────────────────────────────────────────────────

describe('readSvgDimensions', () => {
  it('reads explicit width/height attributes', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect/></svg>';
    expect(readSvgDimensions(svg)).toEqual({ width: 120, height: 48 });
  });

  it('falls back to viewBox when width/height are missing', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect/></svg>';
    expect(readSvgDimensions(svg)).toEqual({ width: 200, height: 60 });
  });

  it('treats percentage width/height as unspecified and uses viewBox', () => {
    const svg = '<svg width="100%" height="100%" viewBox="0 0 180 50"></svg>';
    expect(readSvgDimensions(svg)).toEqual({ width: 180, height: 50 });
  });

  it('returns null for malformed SVG', () => {
    expect(readSvgDimensions('<not-svg></not-svg>')).toBeNull();
  });
});

describe('readPngDimensions', () => {
  it('reads dimensions from a constructed IHDR chunk', () => {
    expect(readPngDimensions(buildPng(150, 50))).toEqual({ width: 150, height: 50 });
  });

  it('rejects bytes that lack the PNG signature', () => {
    const bogus = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 13]);
    expect(readPngDimensions(bogus)).toBeNull();
  });
});

describe('readIcoDimensions', () => {
  it('reads dimensions from a constructed ICONDIR entry', () => {
    expect(readIcoDimensions(buildIco(32, 32))).toEqual({ width: 32, height: 32 });
  });

  it('decodes 0 as 256 per the ICO spec', () => {
    expect(readIcoDimensions(buildIco(256, 256))).toEqual({ width: 256, height: 256 });
  });
});

// ─── validateBrandingTokens — primary color (Requirement 28 AC 8) ───────────

describe('validateBrandingTokens — primary color', () => {
  it('accepts a high-contrast primary color', () => {
    const tokens: ThemeTokens = {
      '--tenant-primary': 'hsl(222, 47%, 31%)', // ~10:1
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('accepts a primary color that exactly meets the threshold (4.5:1)', () => {
    // #767676 has ~4.54:1 against white — a well-known WCAG boundary value.
    const tokens: ThemeTokens = { '--tenant-primary': '#767676' };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('rejects a primary color below 4.5:1', () => {
    // #888 has ~3.5:1 — fails primary, would pass accent.
    const tokens: ThemeTokens = { '--tenant-primary': '#888888' };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.field).toBe('tokens.--tenant-primary');
      expect(result.errors[0]!.rule).toBe('contrast');
      expect(result.errors[0]!.message).toMatch(/4.5:1/);
    }
  });

  it('rejects an unparseable primary color value with a format error', () => {
    const tokens: ThemeTokens = { '--tenant-primary': 'banana' };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.rule).toBe('format');
    }
  });
});

// ─── validateBrandingTokens — accent color (Requirement 28 AC 9) ────────────

describe('validateBrandingTokens — accent color', () => {
  it('accepts an accent color that meets 3:1 (but would fail primary)', () => {
    // hsl(43, 96%, 35%) ~3.60:1
    const tokens: ThemeTokens = { '--tenant-accent': 'hsl(43, 96%, 35%)' };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('rejects an accent color below 3:1', () => {
    // hsl(43, 96%, 56%) ~1.69:1 — fails the 3:1 threshold.
    const tokens: ThemeTokens = { '--tenant-accent': 'hsl(43, 96%, 56%)' };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.field).toBe('tokens.--tenant-accent');
      expect(result.errors[0]!.rule).toBe('contrast');
      expect(result.errors[0]!.message).toMatch(/3:1/);
    }
  });

  it('reports primary and accent failures independently', () => {
    const tokens: ThemeTokens = {
      '--tenant-primary': '#cccccc', // ~1.6:1
      '--tenant-accent': '#eeeeee', // ~1.13:1
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual([
        'tokens.--tenant-accent',
        'tokens.--tenant-primary',
      ]);
    }
  });
});

// ─── validateBrandingTokens — logo (Requirement 28 AC 7) ────────────────────

describe('validateBrandingTokens — logo', () => {
  it('accepts an SVG logo within 200×60', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48"><rect/></svg>';
    const tokens: ThemeTokens = {
      '--tenant-logo': urlToken(dataUri('image/svg+xml', new TextEncoder().encode(svg))),
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('accepts a PNG logo within 200×60', () => {
    const tokens: ThemeTokens = {
      '--tenant-logo': urlToken(dataUri('image/png', buildPng(120, 40))),
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('accepts an external CDN logo URL without probing dimensions', () => {
    const tokens: ThemeTokens = {
      '--tenant-logo': 'url("/cdn/tenant-1/logo-v1.svg")',
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('rejects an SVG logo wider than 200px', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48"></svg>';
    const tokens: ThemeTokens = {
      '--tenant-logo': urlToken(dataUri('image/svg+xml', new TextEncoder().encode(svg))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.rule).toBe('dimensions');
      expect(result.errors[0]!.message).toMatch(/240×48px/);
    }
  });

  it('rejects a PNG logo taller than 60px', () => {
    const tokens: ThemeTokens = {
      '--tenant-logo': urlToken(dataUri('image/png', buildPng(120, 80))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.rule).toBe('dimensions');
    }
  });

  it('rejects an unsupported MIME type', () => {
    const tokens: ThemeTokens = {
      '--tenant-logo': urlToken(dataUri('image/gif', new Uint8Array([0]))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.rule).toBe('mimeType');
    }
  });
});

// ─── validateBrandingTokens — favicon (Requirement 28 AC 7) ─────────────────

describe('validateBrandingTokens — favicon', () => {
  it('accepts a 32×32 ICO favicon', () => {
    const tokens: ThemeTokens = {
      '--tenant-favicon': urlToken(dataUri('image/x-icon', buildIco(32, 32))),
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('accepts a 32×32 PNG favicon', () => {
    const tokens: ThemeTokens = {
      '--tenant-favicon': urlToken(dataUri('image/png', buildPng(32, 32))),
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });

  it('rejects a 16×16 favicon', () => {
    const tokens: ThemeTokens = {
      '--tenant-favicon': urlToken(dataUri('image/png', buildPng(16, 16))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.field).toBe('tokens.--tenant-favicon');
      expect(result.errors[0]!.rule).toBe('dimensions');
    }
  });

  it('rejects a non-square favicon', () => {
    const tokens: ThemeTokens = {
      '--tenant-favicon': urlToken(dataUri('image/png', buildPng(32, 16))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
  });

  it('rejects an SVG favicon (only ICO/PNG accepted)', () => {
    const svg = '<svg width="32" height="32"></svg>';
    const tokens: ThemeTokens = {
      '--tenant-favicon': urlToken(dataUri('image/svg+xml', new TextEncoder().encode(svg))),
    };
    const result = validateBrandingTokens(tokens);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.rule).toBe('mimeType');
    }
  });
});

// ─── Empty tokens / unrelated tokens ───────────────────────────────────────

describe('validateBrandingTokens — passthrough', () => {
  it('accepts an empty token set', () => {
    expect(validateBrandingTokens({})).toEqual({ ok: true });
  });

  it('ignores tokens it does not own (e.g. --tenant-name)', () => {
    const tokens: ThemeTokens = {
      '--tenant-name': '"Ministry of Education"',
      '--tenant-shortName': '"moe"',
    };
    expect(validateBrandingTokens(tokens)).toEqual({ ok: true });
  });
});
