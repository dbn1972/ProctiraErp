/**
 * G-910 — tenant admin console: invite / suspend users and tenant settings.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryRolesRepository } from './in-memory-roles-repository.js';
import { registerRolesRoutes } from './roles-routes.js';
import { RolesService, type RolesAuditEvent } from './roles-service.js';
import { InMemoryTenantSettingsStore, registerTenantSettingsRoutes } from './tenant-settings.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

describe('G-910 tenant admin console routes', () => {
  let app: FastifyInstance;
  let events: RolesAuditEvent[];
  let tenantHeader = TENANT;

  beforeEach(async () => {
    events = [];
    const repo = new InMemoryRolesRepository([
      {
        roleId: 'admin',
        roleName: 'Administrator',
        permissions: [{ resource: 'user', action: 'manage' }],
      },
    ]);
    const service = new RolesService(repo, async (e) => {
      events.push(e);
    });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantHeader;
    });
    await registerRolesRoutes(app, { rolesService: service, prefix: '/tenant' });
    await registerTenantSettingsRoutes(app, {
      store: new InMemoryTenantSettingsStore(),
      prefix: '/tenant',
    });
    await app.ready();
  });

  afterEach(async () => {
    tenantHeader = TENANT;
    await app.close();
  });

  it('invites a user with roles, lists it, rejects duplicates, and suspends it', async () => {
    const roles = await app.inject({ method: 'GET', url: '/tenant/roles' });
    const adminRoleId = (roles.json().data as Array<{ id: string }>)[0]!.id;

    const invited = await app.inject({
      method: 'POST',
      url: '/tenant/users',
      payload: { email: 'New.Admin@school.test', displayName: 'New Admin', roleIds: [adminRoleId] },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(invited.json()).toMatchObject({
      email: 'new.admin@school.test',
      status: 'INVITED',
      roleIds: [adminRoleId],
    });
    expect(events.at(-1)).toMatchObject({
      entityType: 'user',
      operation: 'CREATE',
      metadata: { riskLevel: 'high', change: 'user_invited' },
    });

    const dup = await app.inject({
      method: 'POST',
      url: '/tenant/users',
      payload: { email: 'new.admin@school.test', displayName: 'Again', roleIds: [] },
    });
    expect(dup.statusCode).toBe(409);

    const badEmail = await app.inject({
      method: 'POST',
      url: '/tenant/users',
      payload: { email: 'not-an-email', displayName: 'x', roleIds: [] },
    });
    expect(badEmail.statusCode).toBe(400);

    const unknownRole = await app.inject({
      method: 'POST',
      url: '/tenant/users',
      payload: { email: 'b@school.test', displayName: 'B', roleIds: ['nope'] },
    });
    expect(unknownRole.statusCode).toBe(400);

    const listed = await app.inject({ method: 'GET', url: '/tenant/users?status=INVITED' });
    expect(listed.json().data).toHaveLength(1);

    const userId = invited.json().id as string;
    const suspended = await app.inject({
      method: 'PATCH',
      url: `/tenant/users/${userId}/status`,
      payload: { status: 'SUSPENDED' },
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json().status).toBe('SUSPENDED');

    // Other tenant cannot see or mutate the user.
    tenantHeader = OTHER;
    const otherList = await app.inject({ method: 'GET', url: '/tenant/users' });
    expect(otherList.json().data).toEqual([]);
    const otherPatch = await app.inject({
      method: 'PATCH',
      url: `/tenant/users/${userId}/status`,
      payload: { status: 'ACTIVE' },
    });
    expect(otherPatch.statusCode).toBe(404);
  });

  it('returns default settings, validates, and persists PUT per tenant', async () => {
    const defaults = await app.inject({ method: 'GET', url: '/tenant/settings' });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toMatchObject({ tenantId: TENANT, defaultLocale: 'en' });

    const invalid = await app.inject({
      method: 'PUT',
      url: '/tenant/settings',
      payload: { ...defaults.json(), defaultLocale: 'fr', supportedLocales: ['en'] },
    });
    expect(invalid.statusCode).toBe(400);

    const body = {
      displayName: 'Springfield Board',
      defaultLocale: 'en',
      supportedLocales: ['en', 'hi'],
      timezone: 'Asia/Kolkata',
      academicYearStartMonth: 4,
      branding: { primaryColor: '#123456', accentColor: '#abcdef', logoUrl: null },
      contact: { email: 'admin@springfield.test', phone: null },
    };
    const saved = await app.inject({ method: 'PUT', url: '/tenant/settings', payload: body });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ ...body, tenantId: TENANT });

    const readBack = await app.inject({ method: 'GET', url: '/tenant/settings' });
    expect(readBack.json().displayName).toBe('Springfield Board');

    tenantHeader = OTHER;
    const other = await app.inject({ method: 'GET', url: '/tenant/settings' });
    expect(other.json().displayName).not.toBe('Springfield Board');
  });
});
