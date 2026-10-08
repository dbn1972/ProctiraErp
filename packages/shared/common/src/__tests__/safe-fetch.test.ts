/**
 * PRC-C003 / PRC-M618 / g7_platform-001 — shared SSRF guard regression tests.
 *
 * A tenant-authored outbound URL (ETL connector, developer-portal webhook, notification webhook)
 * must never reach the cloud metadata endpoint, loopback, or any private/internal address, must be
 * https-only, must re-validate redirect hops, and must abort on timeout / oversized bodies.
 */
import { describe, expect, it, vi } from 'vitest';

import { SsrfError, assertPublicHttpsUrl, isDisallowedAddress, safeFetch } from '../safe-fetch.js';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('isDisallowedAddress (shared SSRF guard)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('rejects private/loopback/metadata address %s', (addr) => {
    expect(isDisallowedAddress(addr)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public address %s',
    (addr) => {
      expect(isDisallowedAddress(addr)).toBe(false);
    },
  );

  it('rejects IPv4-mapped IPv6 in compressed hextet form', () => {
    expect(isDisallowedAddress('::ffff:7f00:1')).toBe(true); // ::ffff:127.0.0.1 compressed
  });
});

describe('assertPublicHttpsUrl (shared SSRF guard)', () => {
  it('rejects non-https schemes', async () => {
    await expect(
      assertPublicHttpsUrl('http://example.com/', publicResolver),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHttpsUrl('file:///etc/passwd', publicResolver)).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it('rejects the cloud metadata endpoint by literal IP', async () => {
    await expect(
      assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data/', publicResolver),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects localhost and a private DB port', async () => {
    await expect(
      assertPublicHttpsUrl('https://localhost:5432/', async () => [
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a hostname that resolves to a private 10.x address (DNS rebinding)', async () => {
    await expect(
      assertPublicHttpsUrl('https://evil.example.com/', async () => [
        { address: '10.0.0.5', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('accepts a public https host', async () => {
    await expect(
      assertPublicHttpsUrl('https://example.com/', publicResolver),
    ).resolves.toBeInstanceOf(URL);
  });

  it('rejects IPv6 loopback (::1) / IPv4-mapped literal URL hosts by policy', async () => {
    await expect(assertPublicHttpsUrl('https://[::1]/', publicResolver)).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(
      assertPublicHttpsUrl('https://[::ffff:7f00:1]/', publicResolver),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHttpsUrl('https://[fe80::1]/', publicResolver)).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it('rejects a hostname that resolves to a private IPv6 address', async () => {
    await expect(
      assertPublicHttpsUrl('https://evil.example.com/', async () => [
        { address: 'fd00::1', family: 6 },
      ]),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('safeFetch (shared SSRF guard)', () => {
  it('rejects a 302 redirect to a private IP without following it', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }),
    ) as unknown as typeof fetch;
    await expect(
      safeFetch('https://example.com/', {
        deps: { resolveHost: publicResolver, fetchImpl },
        maxRedirects: 3,
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('caps oversized response bodies', async () => {
    const big = new Uint8Array(50);
    const fetchImpl = vi.fn(
      async () => new Response(big, { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      safeFetch('https://example.com/', {
        deps: { resolveHost: publicResolver, fetchImpl },
        maxResponseBytes: 10,
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('aborts on timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ) as unknown as typeof fetch;
    await expect(
      safeFetch('https://example.com/', {
        deps: { resolveHost: publicResolver, fetchImpl },
        timeoutMs: 5,
      }),
    ).rejects.toThrow();
  });

  it('returns the response for an allowed public target', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await safeFetch('https://example.com/data', {
      deps: { resolveHost: publicResolver, fetchImpl },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });
});
