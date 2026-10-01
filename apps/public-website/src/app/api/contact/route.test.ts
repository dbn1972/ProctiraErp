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
});
