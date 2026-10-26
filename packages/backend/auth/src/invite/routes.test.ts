/**
 * PRC-M183: HTTP tests for the invite routes (admin / tenant invite create and
 * the legacy root 308 redirects).
 */
import { ConflictError } from '@proctira/common';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryUserInviteRepository } from './in-memory-invite-repository.js';
import { InviteService } from './invite-service.js';
import { registerInviteAndTenantDirectoryRoutes, type InviteRoutesOptions } from './routes.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

interface Principal {
  sub?: string;
  roles?: string[];
}

async function build(
  principal: Principal | null,
  opts: Partial<InviteRoutesOptions> = {},
  tenantId: string | null = TENANT,
) {
  const repository = new InMemoryUserInviteRepository();
  const inviteService =
    opts.inviteService ?? new InviteService({ repository, inviteBaseUrl: 'https://app.test' });
  const app = Fastify();
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const r = request as unknown as { tenantId?: string; user?: Principal };
    if (tenantId) r.tenantId = tenantId;
    if (principal) r.user = principal;
  });
  await registerInviteAndTenantDirectoryRoutes(app, { ...opts, inviteService });
  await app.ready();
  return { app, repository };
}

const admin: Principal = { sub: 'admin-1', roles: ['admin'] };

describe('PRC-M183 invite routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('no principal -> 401', async () => {
    ({ app } = await build(null));
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('non-admin role -> 403 and no invite stored', async () => {
    let repository: InMemoryUserInviteRepository;
    ({ app, repository } = await build({ sub: 'teacher-1', roles: ['teacher'] }));
    const res = await app.inject({
      method: 'POST',
      url: '/tenant/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(await repository.listByTenant(TENANT)).toEqual([]);
  });

  it('admin + invalid body -> 400 VALIDATION_ERROR', async () => {
    ({ app } = await build(admin));
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'not-an-email', roleId: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    const fields = (res.json().errors as Array<{ field: string }>).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'roleId']));
  });

  it('admin without tenant context -> 400 TENANT_REQUIRED', async () => {
    ({ app } = await build(admin, {}, null));
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_REQUIRED');
  });

  it('admin + valid body -> 201; invite stored with invitedBy = principal sub', async () => {
    let repository: InMemoryUserInviteRepository;
    ({ app, repository } = await build(admin));
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'New@Example.com', displayName: 'New User' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'new@example.com', status: 'pending' });
    expect(res.json().inviteUrl).toContain('https://app.test/auth/invite?token=');
    const stored = await repository.listByTenant(TENANT);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.invitedBy).toBe('admin-1');
  });

  it('a second pending invite for the same email -> 409', async () => {
    ({ app } = await build(admin));
    const payload = { email: 'dup@example.com' };
    expect(
      (await app.inject({ method: 'POST', url: '/admin/users/invite', payload })).statusCode,
    ).toBe(201);
    const res = await app.inject({ method: 'POST', url: '/tenant/users/invite', payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe(new ConflictError('x').code);
  });

  it('prefix + legacyRootRedirects: root path -> 308 to the prefixed route', async () => {
    ({ app } = await build(admin, { prefix: '/api/v1', legacyRootRedirects: true }));
    const legacy = await app.inject({
      method: 'POST',
      url: '/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(legacy.statusCode).toBe(308);
    expect(legacy.headers['location']).toBe('/api/v1/admin/users/invite');
    const prefixed = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users/invite',
      payload: { email: 'new@example.com' },
    });
    expect(prefixed.statusCode).toBe(201);
  });
});
