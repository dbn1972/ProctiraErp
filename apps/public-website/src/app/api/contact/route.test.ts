import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetContactRateLimitForTests } from '@/lib/contact-rate-limit';
import { POST } from './route';

const valid = {
  name: 'Asha Rao',
  email: 'asha@example.org',
  organization: 'Example School',
  message: 'We would like a product demo please.',
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://proctira.test/api/contact', {
    method: 'POST',
    headers: {
      host: 'proctira.test',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  beforeEach(() => {
    resetContactRateLimitForTests();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete process.env.CONTACT_WEBHOOK_URL;
  });

  it('accepts a same-origin JSON submission', async () => {
    const res = await POST(
      post(valid, { origin: 'http://proctira.test', 'sec-fetch-site': 'same-origin' }),
    );
    expect(res.status).toBe(202);
  });

  it('rejects a cross-origin POST with 403', async () => {
    const res = await POST(post(valid, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    const res2 = await POST(post(valid, { 'sec-fetch-site': 'cross-site' }));
    expect(res2.status).toBe(403);
  });

  it('rejects non-JSON content types with 415', async () => {
    const res = await POST(post('name=x', { 'content-type': 'application/x-www-form-urlencoded' }));
    expect(res.status).toBe(415);
  });

  it('rejects a 1MB body with 413 (Content-Length and streamed)', async () => {
    const big = JSON.stringify({ ...valid, message: 'x'.repeat(1024 * 1024) });
    const res = await POST(post(big, { 'content-length': String(big.length) }));
    expect(res.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const chunked = new Request('http://proctira.test/api/contact', {
      method: 'POST',
      headers: { host: 'proctira.test', 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await POST(chunked)).status).toBe(413);
  });

  it('does not forward to a non-https webhook in production', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('NODE_ENV', 'production');
    process.env.CONTACT_WEBHOOK_URL = 'http://crm.internal/hook';
    try {
      const res = await POST(post(valid, { 'x-forwarded-for': '203.0.113.77' }));
      expect(res.status).toBe(202);
      expect(((await res.json()) as { forwarded: boolean }).forwarded).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      fetchSpy.mockRestore();
    }
  });

  it('forwards to an https webhook with redirect:"error"', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    process.env.CONTACT_WEBHOOK_URL = 'https://crm.example/hook';
    try {
      const res = await POST(post(valid, { 'x-forwarded-for': '203.0.113.78' }));
      expect(((await res.json()) as { forwarded: boolean }).forwarded).toBe(true);
      expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe('error');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
