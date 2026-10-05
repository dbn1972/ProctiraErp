/**
 * PRC-M485: the MFA setup POST carries the double-submit CSRF header that
 * middleware requires on every unsafe /api/* request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupMfa } from './auth';

describe('setupMfa CSRF header (PRC-M485)', () => {
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('sends x-csrf-token from the csrf_token cookie', async () => {
    document.cookie = 'csrf_token=tok-123; path=/';
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ otpauthUri: 'otpauth://totp/x', secret: 'S', backupCodes: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    await setupMfa({ fetcher: fetcher as unknown as typeof fetch });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('tok-123');
  });
});
