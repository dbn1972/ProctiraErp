import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerInviteAndTenantDirectoryRoutes } from './invite/routes.js';
import { resolveTenantDirectory, type TenantDirectoryReader } from './tenant-directory.js';

const reader: TenantDirectoryReader = {
  findTenantById: vi.fn(async (id: string) =>
    id === 't-1'
      ? { id: 't-1', name: 'Springfield High', slug: 'springfield', status: 'suspended' }
      : null,
  ),
};

describe('tenant directory reads the tenant repository (PRC-L084)', () => {
  it('reports suspended tenant as suspended with real name/slug', async () => {
    expect(await resolveTenantDirectory('t-1', reader)).toEqual([
      { id: 't-1', name: 'Springfield High', slug: 'springfield', status: 'suspended' },
    ]);
  });

  it('omits an unknown tenant instead of echoing it as active', async () => {
    expect(await resolveTenantDirectory('t-unknown', reader)).toEqual([]);
    expect(await resolveTenantDirectory(undefined, reader)).toEqual([]);
  });

  it('GET /tenants/mine returns repository status', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { sub: 'u-1', tenantId: 't-1' };
    });
    await registerInviteAndTenantDirectoryRoutes(app, {
      inviteService: {} as never,
      tenantDirectory: reader,
    });
    const res = await app.inject({ method: 'GET', url: '/tenants/mine' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ status: 'suspended', slug: 'springfield' });
    await app.close();
  });
});
