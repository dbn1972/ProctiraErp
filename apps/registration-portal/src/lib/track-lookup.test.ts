import { describe, expect, it } from 'vitest';

import { decideTrackLookup, resolveRedirectBase } from './track-lookup';

describe('decideTrackLookup', () => {
  it('accepts a normalized tracking number and a calendar date', () => {
    expect(decideTrackLookup('reg-a1b2c3d4', '2015-03-02')).toEqual({
      ok: true,
      trackingNumber: 'REG-A1B2C3D4',
      dob: '2015-03-02',
    });
  });

  it('rejects a missing or impossible date of birth', () => {
    expect(decideTrackLookup('REG-A1B2C3D4', '')).toEqual({ ok: false });
    expect(decideTrackLookup('REG-A1B2C3D4', '2015-02-31')).toEqual({ ok: false });
  });
});

describe('resolveRedirectBase (PRC-L225)', () => {
  const headers = (h: Record<string, string>) => ({
    get: (name: string) => h[name.toLowerCase()] ?? null,
  });

  it('prefers X-Forwarded-Host/Proto over the internal request origin', () => {
    const base = resolveRedirectBase(
      'http://0.0.0.0:3002/track/lookup',
      headers({ 'x-forwarded-host': 'apply.school.example', 'x-forwarded-proto': 'https' }),
      {},
    );
    expect(base.origin).toBe('https://apply.school.example');
  });

  it('defaults forwarded proto to https when absent', () => {
    const base = resolveRedirectBase(
      'http://0.0.0.0:3002/track/lookup',
      headers({ 'x-forwarded-host': 'apply.school.example' }),
      {},
    );
    expect(base.origin).toBe('https://apply.school.example');
  });

  it('uses PUBLIC_BASE_URL when configured', () => {
    const base = resolveRedirectBase('http://0.0.0.0:3002/x', headers({}), {
      PUBLIC_BASE_URL: 'https://portal.example',
    });
    expect(base.origin).toBe('https://portal.example');
  });

  it('falls back to the request URL for local/dev', () => {
    const base = resolveRedirectBase('http://localhost:3002/track/lookup', headers({}), {});
    expect(base.origin).toBe('http://localhost:3002');
  });
});
