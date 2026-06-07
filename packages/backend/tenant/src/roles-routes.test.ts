/**
 * Tenant Roles Routes integration tests (Task 59.3).
 *
 * Exercises the HTTP surface end-to-end and verifies the route layer
 * forwards every mutation to the audit emitter with `riskLevel: 'high'`
 * (Requirement 33 AC 4).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  InMemoryRolesRepository,
  type BuiltInRoleSeed,
} from './in-memory-roles-repository.js';
import { RolesService, type RolesAuditEvent } from './roles-service.js';
import { registerRolesRoutes } from './roles-routes.js';

const TENANT = 'tenant-a';

const BUILT_IN_SEED: BuiltInRoleSeed[] = [
  {
    roleId: 'super-admin',
    roleName: 'Super Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
  {
    roleId: 'teacher',
    roleName: 'Teacher',
    permissions: [
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'create' },
    ],
  },
];

describe('Tenant Roles Routes', () => {
  let app: FastifyInstance;
  let repo: InMemoryRolesRepository;
  let service: RolesService;
  let events: RolesAuditEvent[];

  beforeEach(async () => {
    repo = new InMemoryRolesRepository(BUILT_IN_SEED);
    repo.seedUsers(TENANT, [
      {
        id: 'user-1',
        tenantId: TENANT,
        email: 'alice@example.test',
        displayName: 'Alice Admin',
        roleIds: [],
        status: 'ACTIVE',
      },
      {
        id: 'user-2',
        tenantId: TENANT,
        email: 'bob@example.test',
        displayName: 'Bob Builder',
        roleIds: [],
        status: 'ACTIVE',
      },
    ]);
    events = [];
    service = new RolesService(repo, async (event) => {
      events.push(event);
    });

    app = Fastify();
    await registerRolesRoutes(app, {
      rolesService: service,
      getTenantId: (req) => (req.headers['x-tenant-id'] as string | undefined),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when no tenant context is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenant/roles' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_REQUIRED');
  });

  it('lists tenant roles seeded from the built-in seed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ name: string; builtIn: boolean }>;
    expect(data.map((d) => d.name).sort()).toEqual(['Super Administrator', 'Teacher']);
    expect(data.every((d) => d.builtIn)).toBe(true);
  });

  it('creates a custom role and the route emits exactly one high-risk audit event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
      payload: {
        name: 'Curriculum Lead',
        description: 'Cross-school curriculum oversight',
        permissions: [{ resource: 'assessment', action: 'manage' }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Curriculum Lead',
      builtIn: false,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.operation).toBe('CREATE');
    expect(events[0]!.metadata.riskLevel).toBe('high');
  });

  it('rejects updates against built-in roles with 422', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
    });
    const builtIn = (list.json().data as Array<{ id: string; builtIn: boolean }>).find(
      (r) => r.builtIn,
    )!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/tenant/roles/${builtIn.id}/permissions`,
      headers: { 'x-tenant-id': TENANT },
      payload: { permissions: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(events).toHaveLength(0);
  });

  it('updates a custom role permission set and emits one high-risk UPDATE event', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
      payload: { name: 'Curriculum Lead', permissions: [] },
    });
    expect(create.statusCode).toBe(201);
    events.length = 0;
    const id = create.json().id as string;

    const update = await app.inject({
      method: 'PATCH',
      url: `/tenant/roles/${id}/permissions`,
      headers: { 'x-tenant-id': TENANT },
      payload: {
        permissions: [
          { resource: 'assessment', action: 'manage' },
          { resource: 'report', action: 'read' },
        ],
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().permissions).toHaveLength(2);

    expect(events).toHaveLength(1);
    expect(events[0]!.operation).toBe('UPDATE');
    expect(events[0]!.metadata.riskLevel).toBe('high');
  });

  it('reflects updated role permissions on the very next read (no caching)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
      payload: { name: 'Curriculum Lead', permissions: [] },
    });
    const id = create.json().id as string;

    await app.inject({
      method: 'PATCH',
      url: `/tenant/roles/${id}/permissions`,
      headers: { 'x-tenant-id': TENANT },
      payload: {
        permissions: [{ resource: 'assessment', action: 'read' }],
      },
    });

    // The very next request to GET /tenant/roles/:id sees the new
    // permission set — no propagation delay.
    const refetch = await app.inject({
      method: 'GET',
      url: `/tenant/roles/${id}`,
      headers: { 'x-tenant-id': TENANT },
    });
    expect(refetch.statusCode).toBe(200);
    expect(refetch.json().permissions).toEqual([
      { resource: 'assessment', action: 'read' },
    ]);
  });

  it('lists users with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tenant/users?pageSize=1&page=1',
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.totalItems).toBe(2);
    expect(body.meta.totalPages).toBe(2);
  });

  it('assigns roles to a user and emits a high-risk audit event', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/tenant/roles',
      headers: { 'x-tenant-id': TENANT },
      payload: { name: 'Curriculum Lead', permissions: [] },
    });
    events.length = 0;
    const roleId = create.json().id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: '/tenant/users/user-1/roles',
      headers: { 'x-tenant-id': TENANT },
      payload: { roleIds: [roleId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().roleIds).toEqual([roleId]);

    expect(events).toHaveLength(1);
    expect(events[0]!.entityType).toBe('user');
    expect(events[0]!.metadata.riskLevel).toBe('high');
  });

  it('returns the permission catalog used to render matrix rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tenant/permissions',
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ resource: string; action: string }>;
    const keys = data.map((p) => `${p.resource}:${p.action}`);
    expect(keys).toContain('*:manage');
    expect(keys).toContain('student:read');
    expect(keys).toContain('attendance:create');
  });

  it('returns 404 when deleting a role that does not exist', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/tenant/roles/no-such-role',
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(404);
  });
});
