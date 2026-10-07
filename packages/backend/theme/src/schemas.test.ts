/**
 * Theme schema hardening tests (PRC-M393, PRC-M394).
 */
import { describe, it, expect } from 'vitest';
import { validate } from '@proctira/validation';
import { CreateThemeSchema, ThemeTokensSchema, ThemeAssetsSchema } from './schemas.js';

function tokens(): Record<string, any> {
  return {
    colors: { textPrimary: '#111827', background: '#ffffff' },
    typography: { fontFamily: "Inter, 'Noto Sans', sans-serif", baseFontSize: 16, lineHeight: 1.5 },
    spacing: { unit: 4 },
    borderRadius: { sm: '2px', md: '0.5rem', full: '9999px' },
    shadows: { sm: '0 1px 2px rgba(0, 0, 0, 0.05)', none: 'none' },
  };
}

describe('ThemeTokensSchema (PRC-M393 color grammar)', () => {
  it('accepts hex, hsl and rgb colors', () => {
    const t = tokens();
    t.colors.a = '#abc';
    t.colors.b = 'hsl(220, 70%, 50%)';
    t.colors.c = 'rgb(51, 102, 204)';
    t.colors.d = '#11223344';
    expect(validate(ThemeTokensSchema, t).success).toBe(true);
  });

  it.each(['#zzzzzz', 'red', 'red; } body{display:none', 'url(https://evil/x)'])(
    'rejects color %s',
    (bad) => {
      const t = tokens();
      t.colors.textPrimary = bad;
      expect(validate(ThemeTokensSchema, t).success).toBe(false);
    },
  );
});

describe('ThemeTokensSchema (PRC-M394 injection hardening)', () => {
  it('accepts a sane token set', () => {
    expect(validate(ThemeTokensSchema, tokens()).success).toBe(true);
  });

  it.each([
    ['borderRadius', 'md', '4px; } body{display:none'],
    ['borderRadius', 'md', 'url(https://evil/x)'],
    ['shadows', 'sm', '0 0 0 red; background:url(https://evil/x)'],
    ['shadows', 'sm', 'url(x)'],
  ])('rejects %s.%s = %s', (group, key, value) => {
    const t = tokens();
    t[group][key] = value;
    expect(validate(ThemeTokensSchema, t).success).toBe(false);
  });

  it('rejects unsafe token key names', () => {
    const t = tokens();
    t.colors['x}body{'] = '#ffffff';
    expect(validate(ThemeTokensSchema, t).success).toBe(false);
  });

  it('rejects fontFamily with CSS/HTML breakout characters', () => {
    for (const f of ['Inter; } body{display:none', 'Inter"</style><script>', 'x{}']) {
      const t = tokens();
      t.typography.fontFamily = f;
      expect(validate(ThemeTokensSchema, t).success).toBe(false);
    }
  });
});

describe('ThemeAssetsSchema (PRC-M394 URL allow-list)', () => {
  it('accepts https URLs', () => {
    expect(
      validate(ThemeAssetsSchema, {
        logoUrl: 'https://cdn.example.com/logo.png',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
      }).success,
    ).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'http://cdn.example.com/logo.png',
    'https://x/"onerror="alert(1)',
  ])('rejects %s', (url) => {
    expect(validate(ThemeAssetsSchema, { logoUrl: url }).success).toBe(false);
    expect(validate(ThemeAssetsSchema, { faviconUrl: url }).success).toBe(false);
  });

  it('CreateThemeSchema rejects a javascript: logo', () => {
    expect(
      validate(CreateThemeSchema, {
        name: 'x',
        level: 'tenant',
        tokens: tokens(),
        assets: { logoUrl: 'javascript:alert(1)' },
      }).success,
    ).toBe(false);
  });
});
