/**
 * PRC-L584: excluded-path matching respects segment boundaries and tenant
 * conflict responses never echo tenant UUIDs.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { tenantPlugin } from './fastify-plugin.js';

const JWT_TENANT = '550e8400-e29b-41d4-a716-446655440000';
const HOST_TENANT = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('tenantPlugin excludePaths boundaries (PRC-L584)', () => {
  async function build() {
    const app = Fastify();
    await app.register(tenantPlugin, {
      excludePaths: ['/docs/*'],
      getDbClient: () => ({ $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }),
    });
    for (const url of ['/docs', '/docs/json', '/docsfoo', '/docs-internal/x']) {
      app.get(url, async (request) => ({ tenantId: request.tenantId ?? null }));
    }
    return app;
  }

  it.each(['/docs', '/docs/json', '/docs/json?x=1'])('%s is excluded', async (url) => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
  });

  it.each(['/docsfoo', '/docs-internal/x'])('%s is NOT excluded (tenant required)', async (url) => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe('tenantPlugin conflict response (PRC-L584)', () => {
  it('returns a generic 4xx body without tenant UUIDs or slug mapping', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: Record<string, unknown> }).user = {
        tenantId: JWT_TENANT,
        sub: 'user-123',
      };
    });
    await app.register(tenantPlugin, {
      baseDomain: 'proctira.org',
      getDbClient: () => ({
        $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
        tenant: { findUnique: vi.fn().mockResolvedValue({ id: HOST_TENANT }) },
      }),
    });
    app.get('/test', async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { host: 'acme.proctira.org' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).not.toMatch(UUID_RE);
    expect(res.body).not.toContain('acme');
    expect(JSON.parse(res.body).message).toMatch(/Conflicting tenant identities/);
  });
});
