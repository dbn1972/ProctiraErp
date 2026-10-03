/**
 * PRC-M492: next-intl request config resolves the locale from the cookie /
 * Accept-Language (no [locale] segment exists) and uses the tenant timezone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const cookieValues = new Map<string, string>();
const headerValues = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined),
  }),
  headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }),
}));
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}));
const resolveTenantTimezone = vi.fn(async () => 'Asia/Kolkata');
vi.mock('@/lib/datetime/tenant-timezone.server', () => ({
  resolveTenantTimezone: () => resolveTenantTimezone(),
}));
import requestConfig, { resolveRequestLocale } from './request';
type Config = (p: { requestLocale: Promise<string | undefined> }) => Promise<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
}>;
const run = () =>
  (requestConfig as unknown as Config)({ requestLocale: Promise.resolve(undefined) });
beforeEach(() => {
  cookieValues.clear();
  headerValues.clear();
  resolveTenantTimezone.mockClear();
});
describe('resolveRequestLocale', () => {
  it('prefers explicit, then cookie, then accept-language, then default', () => {
    expect(resolveRequestLocale({ requested: 'ta', cookie: 'hi' })).toBe('ta');
    expect(resolveRequestLocale({ cookie: 'hi', acceptLanguage: 'ta-IN' })).toBe('hi');
    expect(resolveRequestLocale({ cookie: 'xx', acceptLanguage: 'ta-IN,en' })).toBe('ta');
    expect(resolveRequestLocale({})).toBe('en');
  });
});
describe('i18n request config', () => {
  it('cookie locale=hi loads Hindi messages (fees headings)', async () => {
    cookieValues.set('locale', 'hi');
    const config = await run();
    expect(config.locale).toBe('hi');
    const hi = (await import('../messages/hi.json')).default as Record<string, unknown>;
    expect(config.messages['fees']).toEqual(hi['fees']);
  });
  it('anonymous requests use Asia/Kolkata (not UTC) without a gateway call', async () => {
    const config = await run();
    expect(config.timeZone).toBe('Asia/Kolkata');
    expect(resolveTenantTimezone).not.toHaveBeenCalled();
  });
  it('authenticated requests use the tenant timezone', async () => {
    cookieValues.set('access_token', 'tok');
    resolveTenantTimezone.mockResolvedValueOnce('Asia/Dubai');
    const config = await run();
    expect(config.timeZone).toBe('Asia/Dubai');
  });
});
