import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  CONSENT_STORAGE_KEY,
  hasAnalyticsConsent,
  parseConsent,
  readConsent,
  writeConsent,
} from './consent';
import { SiteFooter } from '@/components/layout/site-footer';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('consent gate', () => {
  it('defaults to no analytics consent', () => {
    expect(hasAnalyticsConsent(memoryStorage())).toBe(false);
    expect(readConsent(memoryStorage())).toBeNull();
    expect(parseConsent('yes')).toBeNull();
  });

  it('allows analytics only after an explicit choice and honours withdrawal', () => {
    const storage = memoryStorage();
    writeConsent('analytics', storage);
    expect(hasAnalyticsConsent(storage)).toBe(true);
    writeConsent('essential', storage);
    expect(hasAnalyticsConsent(storage)).toBe(false);
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBe('essential');
  });

  it('treats blocked storage as no consent', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => writeConsent('analytics', throwing)).not.toThrow();
    expect(hasAnalyticsConsent(throwing)).toBe(false);
  });

  it('footer exposes a Cookie settings control', () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));
    expect(html).toContain('data-testid="cookie-settings"');
    expect(html).toContain('Cookie settings');
  });
});
