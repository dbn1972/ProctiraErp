import { describe, expect, it } from 'vitest';
import { displayHost, getWebAppLoginUrl } from './site';
import { assertProductionEnv } from '../../next.config.mjs';

describe('getWebAppLoginUrl', () => {
  it('uses NEXT_PUBLIC_WEB_APP_URL when set', () => {
    expect(getWebAppLoginUrl({ NEXT_PUBLIC_WEB_APP_URL: 'https://app.example.org/' })).toBe(
      'https://app.example.org/login',
    );
  });
  it('falls back to /contact outside the production tier', () => {
    expect(getWebAppLoginUrl({})).toBe('/contact');
    expect(getWebAppLoginUrl({ NEXT_PUBLIC_SITE_ENV: 'preview' })).toBe('/contact');
  });
  it('throws in production mode when NEXT_PUBLIC_WEB_APP_URL is missing or invalid', () => {
    expect(() => getWebAppLoginUrl({ NEXT_PUBLIC_SITE_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_WEB_APP_URL/,
    );
    expect(() =>
      getWebAppLoginUrl({ NEXT_PUBLIC_SITE_ENV: 'production', NEXT_PUBLIC_WEB_APP_URL: 'app' }),
    ).toThrow();
    expect(
      getWebAppLoginUrl({
        NEXT_PUBLIC_SITE_ENV: 'production',
        NEXT_PUBLIC_WEB_APP_URL: 'https://app.example.org',
      }),
    ).toBe('https://app.example.org/login');
  });
  it('build-time guard in next.config fails production builds without the URL', () => {
    expect(() => assertProductionEnv({ NEXT_PUBLIC_SITE_ENV: 'production' })).toThrow();
    expect(() => assertProductionEnv({})).not.toThrow();
    expect(() =>
      assertProductionEnv({
        NEXT_PUBLIC_SITE_ENV: 'production',
        NEXT_PUBLIC_WEB_APP_URL: 'https://app.example.org',
      }),
    ).not.toThrow();
  });
});

describe('displayHost', () => {
  it('derives status row detail from the configured URL host', () => {
    expect(displayHost('http://web:3001/api/health')).toBe('web:3001');
    expect(displayHost('https://api.example.org/health')).toBe('api.example.org');
    expect(displayHost(undefined)).toBeNull();
    expect(displayHost('not a url')).toBeNull();
  });
});
