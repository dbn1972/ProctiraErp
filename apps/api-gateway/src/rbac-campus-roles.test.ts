/**
 * H-D2 / T-O1 — hostel and transport staff roles at the gateway.
 *
 * The hostel and transport packages (`hostel-access.ts`, `transport-access.ts`)
 * let wardens, hostel_* staff, transport officers, fleet managers and the
 * registrar through, but the gateway RBAC registry granted them nothing, so
 * only admin and principal could use either module. These tests pin the
 * least-privilege matrix end to end (gateway RBAC hook + package guard):
 *
 * | roles                         | hostel                     | transport                          |
 * | warden, hostel_*              | read, list, create, update | none                               |
 * | transport_*, fleet_*          | none                       | read, list, create, update, delete |
 * | registrar                     | read, list                 | read, list                         |
 * | teacher, staff, student       | read (package denies)      | read (package denies)              |
 * | parent, guardian, nurse       | none                       | none                               |
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CAMPUS_BASE_READ_ROLE_IDS, type PermissionAction } from '@proctira/auth';
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import type {
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from '@proctira/backend-tenant';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { createGatewayRbacRegistry } from './rbac-registry.js';
import { TenantCustomRoleProvider } from './tenant-custom-roles.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400b2';

const HOSTEL_STAFF = [
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
] as const;
const TRANSPORT_STAFF = [
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
] as const;
const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

function expectedActions(roleId: string, resource: 'hostel' | 'transport'): PermissionAction[] {
  if ((HOSTEL_STAFF as readonly string[]).includes(roleId)) {
    return resource === 'hostel' ? ['read', 'list', 'create', 'update'] : [];
  }
  if ((TRANSPORT_STAFF as readonly string[]).includes(roleId)) {
    return resource === 'transport' ? ['read', 'list', 'create', 'update', 'delete'] : [];
  }
  if (roleId === 'registrar') return ['read', 'list'];
  if (['teacher', 'staff', 'student'].includes(roleId)) return ['read'];
  return [];
}

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 10000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

describe('campus staff role matrix in the gateway registry (H-D2, T-O1)', () => {
  const registry = createGatewayRbacRegistry();

  it('grants each role exactly its matrix actions on hostel and transport', () => {
    for (const roleId of [
      ...HOSTEL_STAFF,
      ...TRANSPORT_STAFF,
      'registrar',
      'teacher',
      'staff',
      'student',
      'parent',
      'guardian',
      'nurse',
    ]) {
      for (const resource of ['hostel', 'transport'] as const) {
        const allowed = expectedActions(roleId, resource);
        for (const action of ACTIONS) {
          expect(
            registry.roleHasPermission(roleId, resource, action),
            `${roleId} ${resource}:${action}`,
          ).toBe(allowed.includes(action));
        }
      }
    }
  });

  it('gives the new campus roles no other resource, and keeps registrar staff:manage', () => {
    for (const roleId of [...HOSTEL_STAFF, ...TRANSPORT_STAFF]) {
      const role = registry.getRole(roleId);
      expect(role, roleId).toBeDefined();
      for (const permission of role!.permissions) {
        expect(['hostel', 'transport'], `${roleId} ${permission.resource}`).toContain(
          permission.resource,
        );
      }
    }
    const registrar = registry.getRole('registrar')!;
    expect(registry.roleHasPermission('registrar', 'staff', 'manage')).toBe(true);
    expect(
      registrar.permissions
        .map((p) => `${p.resource}:${p.action}`)
        // fees:read/list (F-D3) is pinned by rbac-fees-roles.test.ts; registration and
        // institution (UATENV-D19) by rbac-admissions-roles.test.ts.
        .filter(
          (p) =>
            !p.startsWith('staff:') &&
            !p.startsWith('fees:') &&
            !p.startsWith('registration:') &&
            !p.startsWith('institution:'),
        )
        .sort(),
    ).toEqual(['hostel:list', 'hostel:read', 'transport:list', 'transport:read']);
  });

  it('CAMPUS_BASE_READ_ROLE_IDS lists exactly the base roles holding a plain hostel/transport read', () => {
    // The web guard treats these roles as holding gateway `hostel`/`transport`
    // read (MR-1). They hold it through STAFF_READS / the student role, not
    // through a campus grant, `manage`, or a `*` wildcard.
    const campusRoles = new Set<string>([...HOSTEL_STAFF, ...TRANSPORT_STAFF, 'registrar']);
    for (const resource of ['hostel', 'transport'] as const) {
      const readers = registry
        .getAllRoles()
        .filter((role) => !campusRoles.has(role.roleId))
        .filter((role) =>
          role.permissions.some((p) => p.resource === resource && p.action === 'read'),
        )
        .filter(
          (role) =>
            !role.permissions.some(
              (p) => (p.resource === resource || p.resource === '*') && p.action === 'manage',
            ),
        )
        .map((role) => role.roleId)
        .sort();
      expect(readers, resource).toEqual([...(CAMPUS_BASE_READ_ROLE_IDS ?? [])].sort());
    }
  });
});

/** Minimal RolesRepository stub exposing only listRoles (as tenant-custom-roles.test.ts). */
class StubRolesRepository implements RolesRepository {
  constructor(private readonly rolesByTenant: Map<string, RoleEntity[]>) {}
  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    return this.rolesByTenant.get(tenantId) ?? [];
  }
  findRoleById = async (): Promise<RoleEntity | null> => null;
  findRoleByName = async (): Promise<RoleEntity | null> => null;
  createRole = async (d: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity> => ({
    ...d,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  updateRole = async (): Promise<RoleEntity | null> => null;
  deleteRole = async (): Promise<boolean> => false;
  listUsers = async (
    _t: string,
    _f: UserListFilter,
    _p: PaginationOptions,
  ): Promise<PaginatedResult<UserRecord>> => ({
    data: [],
    meta: { page: 1, pageSize: 0, totalItems: 0, totalPages: 0 },
  });
  findUserById = async (): Promise<UserRecord | null> => null;
  findUserByEmail = async (): Promise<UserRecord | null> => null;
  upsertUser = async (u: UserRecord): Promise<UserRecord> => u;
  setUserRoles = async (): Promise<UserRecord | null> => null;
}

describe('tenant custom roles cannot redefine the campus staff role ids', () => {
  it('ignores a tenant custom role named warden / transport_officer / fleet_manager', async () => {
    const base = createGatewayRbacRegistry();
    const builtInRoleIds = new Set(base.getAllRoles().map((r) => r.roleId));
    const shadow = (roleId: string): RoleEntity => ({
      id: `${TENANT_A}::${roleId}`,
      tenantId: TENANT_A,
      roleId,
      name: roleId,
      description: null,
      builtIn: false,
      permissions: [
        { resource: 'student', action: 'manage' },
        { resource: 'hostel', action: 'manage' },
        { resource: 'transport', action: 'manage' },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const provider = new TenantCustomRoleProvider({
      repository: new StubRolesRepository(
        new Map([[TENANT_A, ['warden', 'transport_officer', 'fleet_manager'].map(shadow)]]),
      ),
      builtInRoleIds,
    });
    for (const roleId of ['warden', 'transport_officer', 'fleet_manager']) {
      const effective = await provider.registryForRequest(base, TENANT_A, [roleId]);
      expect(effective.roleHasPermission(roleId, 'student', 'manage'), roleId).toBe(false);
      expect(effective.roleHasPermission(roleId, 'student', 'read'), roleId).toBe(false);
    }
    const warden = await provider.registryForRequest(base, TENANT_A, ['warden']);
    expect(warden.roleHasPermission('warden', 'hostel', 'manage')).toBe(false);
    expect(warden.roleHasPermission('warden', 'transport', 'read')).toBe(false);
    const officer = await provider.registryForRequest(base, TENANT_A, ['transport_officer']);
    expect(officer.roleHasPermission('transport_officer', 'hostel', 'read')).toBe(false);
  });
});

describe('campus staff roles through the gateway RBAC hook and package guards', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(roleIds: readonly string[], tenantId = TENANT_A): string {
    return app.jwt.sign({
      sub: `user-${roleIds.join('-') || 'none'}`,
      tenantId,
      email: 'campus@example.com',
      displayName: 'Campus User',
      roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'root' })),
      areas: [],
      institutions: [],
      jti: `jti-campus-${roleIds.join('-')}`,
      sessionId: `session-campus-${roleIds.join('-')}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    roleIds: readonly string[],
    payload?: unknown,
    tenantId = TENANT_A,
  ) {
    const response = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${bearer(roleIds, tenantId)}`,
        'x-tenant-id': tenantId,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return response;
  }

  let seq = 0;
  const hostelBody = () => ({ name: `Campus Hostel ${++seq}`, code: `CH${seq}` });
  const leaveBody = (hostelId: string) => ({
    studentId: '33333333-3333-4333-8333-333333333333',
    hostelId,
    startDate: '2026-09-10',
    endDate: '2026-09-12',
    reason: 'Campus roles matrix',
  });
  const vehicleBody = () => ({ registrationNumber: `CAMPUS-${++seq}`, capacity: 20 });
  const routeBody = () => ({
    name: `Campus Route ${++seq}`,
    startLocation: 'Gate',
    endLocation: 'Depot',
    operatingDays: ['monday'],
  });

  async function adminHostel(tenantId = TENANT_A): Promise<string> {
    const res = await call('POST', '/api/v1/hostel', ['admin'], hostelBody(), tenantId);
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  async function adminStop(): Promise<string> {
    const route = await call('POST', '/api/v1/transport/routes', ['admin'], routeBody());
    expect(route.statusCode, route.body).toBe(201);
    const routeId = (route.json() as { id: string }).id;
    const stop = await call('POST', '/api/v1/transport/stops', ['admin'], {
      routeId,
      name: `Stop ${++seq}`,
      stopOrder: 1,
    });
    expect(stop.statusCode, stop.body).toBe(201);
    return (stop.json() as { id: string }).id;
  }

  it.each(HOSTEL_STAFF.map((roleId) => [roleId]))(
    '%s reads hostel lists and creates hostels and leaves, and is 403 on transport',
    async (roleId) => {
      for (const url of ['/api/v1/hostel', '/api/v1/hostel/leaves', '/api/v1/hostel/visitors']) {
        const res = await call('GET', url, [roleId]);
        expect(res.statusCode, `${roleId} GET ${url}: ${res.body}`).toBe(200);
      }
      const hostel = await call('POST', '/api/v1/hostel', [roleId], hostelBody());
      expect(hostel.statusCode, hostel.body).toBe(201);
      const hostelId = (hostel.json() as { id: string }).id;
      const leave = await call('POST', '/api/v1/hostel/leaves', [roleId], leaveBody(hostelId));
      expect(leave.statusCode, leave.body).toBe(201);

      for (const url of ['/api/v1/transport/vehicles', '/api/v1/transport/routes']) {
        expect((await call('GET', url, [roleId])).statusCode, `${roleId} GET ${url}`).toBe(403);
      }
      expect(
        (await call('POST', '/api/v1/transport/vehicles', [roleId], vehicleBody())).statusCode,
      ).toBe(403);
    },
  );

  it.each(TRANSPORT_STAFF.map((roleId) => [roleId]))(
    '%s reads and writes transport (incl. stop DELETE), and is 403 on hostel',
    async (roleId) => {
      for (const url of ['/api/v1/transport/vehicles', '/api/v1/transport/routes']) {
        const res = await call('GET', url, [roleId]);
        expect(res.statusCode, `${roleId} GET ${url}: ${res.body}`).toBe(200);
      }
      const vehicle = await call('POST', '/api/v1/transport/vehicles', [roleId], vehicleBody());
      expect(vehicle.statusCode, vehicle.body).toBe(201);
      const vehicleId = (vehicle.json() as { id: string }).id;
      const update = await call('PUT', `/api/v1/transport/vehicles/${vehicleId}`, [roleId], {
        capacity: 30,
      });
      expect(update.statusCode, update.body).toBe(200);
      const stopId = await adminStop();
      const removed = await call('DELETE', `/api/v1/transport/stops/${stopId}`, [roleId]);
      expect([200, 204], removed.body).toContain(removed.statusCode);

      for (const url of ['/api/v1/hostel', '/api/v1/hostel/leaves']) {
        expect((await call('GET', url, [roleId])).statusCode, `${roleId} GET ${url}`).toBe(403);
      }
      const hostelId = await adminHostel();
      expect(
        (await call('POST', '/api/v1/hostel/leaves', [roleId], leaveBody(hostelId))).statusCode,
      ).toBe(403);
    },
  );

  it('registrar reads hostel and transport but every write is 403 at the gateway', async () => {
    for (const url of [
      '/api/v1/hostel',
      '/api/v1/hostel/leaves',
      '/api/v1/transport/vehicles',
      '/api/v1/transport/routes',
    ]) {
      const res = await call('GET', url, ['registrar']);
      expect(res.statusCode, `registrar GET ${url}: ${res.body}`).toBe(200);
    }
    const hostelId = await adminHostel();
    const stopId = await adminStop();
    const vehicle = await call('POST', '/api/v1/transport/vehicles', ['admin'], vehicleBody());
    const vehicleId = (vehicle.json() as { id: string }).id;
    const writes: Array<[string, 'POST' | 'PUT' | 'DELETE', string, unknown]> = [
      ['vehicle create', 'POST', '/api/v1/transport/vehicles', vehicleBody()],
      ['vehicle update', 'PUT', `/api/v1/transport/vehicles/${vehicleId}`, { capacity: 31 }],
      ['stop delete', 'DELETE', `/api/v1/transport/stops/${stopId}`, undefined],
      ['hostel create', 'POST', '/api/v1/hostel', hostelBody()],
      ['leave create', 'POST', '/api/v1/hostel/leaves', leaveBody(hostelId)],
    ];
    for (const [label, method, url, payload] of writes) {
      const res = await call(method, url, ['registrar'], payload);
      expect(res.statusCode, `registrar ${label}: ${res.body}`).toBe(403);
      expect((res.json() as { code: string }).code).toBe('FORBIDDEN');
    }
  });

  it.each([['teacher'], ['staff'], ['parent'], ['guardian'], ['student'], ['nurse']])(
    '%s alone stays 403 on hostel and transport reads and writes',
    async (roleId) => {
      const hostelId = await adminHostel();
      const attempts: Array<['GET' | 'POST', string, unknown]> = [
        ['GET', '/api/v1/hostel', undefined],
        ['GET', '/api/v1/hostel/leaves', undefined],
        ['POST', '/api/v1/hostel/leaves', leaveBody(hostelId)],
        ['GET', '/api/v1/transport/vehicles', undefined],
        ['POST', '/api/v1/transport/vehicles', vehicleBody()],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await call(method, url, [roleId], payload);
        expect(res.statusCode, `${roleId} ${method} ${url}: ${res.body}`).toBe(403);
      }
    },
  );

  it('serves a domain when one role holds the gateway grant and another the package role', async () => {
    // Same role sets as the MR-1 cases in apps/web domain-route-guards.test.ts.
    const HOSTEL = '/api/v1/hostel/leaves';
    const TRANSPORT = '/api/v1/transport/vehicles';
    const served: Array<[string[], string]> = [
      [['teacher', 'transport_officer'], TRANSPORT],
      [['teacher', 'registrar'], TRANSPORT],
      [['teacher', 'registrar'], HOSTEL],
      [['staff', 'hostel_manager'], HOSTEL],
      [['student', 'warden'], HOSTEL],
      // MR-1: the gateway grant comes only from teacher/staff (STAFF_READS);
      // the package role has no gateway registry entry.
      [['teacher', 'school_admin'], HOSTEL],
      [['teacher', 'school_admin'], TRANSPORT],
      [['staff', 'school-admin'], TRANSPORT],
      [['teacher', 'system_admin'], TRANSPORT],
    ];
    for (const [roles, url] of served) {
      const res = await call('GET', url, roles);
      expect(res.statusCode, `${roles.join('+')} GET ${url}: ${res.body}`).toBe(200);
    }
    const denied: Array<[string[], string]> = [
      [['school_admin'], HOSTEL],
      [['system-admin'], TRANSPORT],
      [['guardian', 'school_admin'], HOSTEL],
      [['parent', 'school_admin'], TRANSPORT],
      [['teacher', 'staff'], HOSTEL],
      [['teacher', 'guardian'], TRANSPORT],
      [['teacher', 'warden'], TRANSPORT],
      [['staff', 'transport_officer'], HOSTEL],
      [['guardian'], HOSTEL],
      [['guardian'], TRANSPORT],
    ];
    for (const [roles, url] of denied) {
      const res = await call('GET', url, roles);
      expect(res.statusCode, `${roles.join('+')} GET ${url}: ${res.body}`).toBe(403);
    }
    // Neither role holds a transport/hostel write at the gateway.
    expect(
      (await call('POST', '/api/v1/transport/vehicles', ['teacher', 'registrar'], vehicleBody()))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', '/api/v1/hostel', ['student', 'registrar'], hostelBody())).statusCode,
    ).toBe(403);
  });

  it('a tenant A warden never sees tenant B hostel rows', async () => {
    const hostelA = await adminHostel(TENANT_A);
    const hostelB = await adminHostel(TENANT_B);
    const leaveA = await call('POST', '/api/v1/hostel/leaves', ['warden'], leaveBody(hostelA));
    expect(leaveA.statusCode, leaveA.body).toBe(201);
    const leaveB = await call(
      'POST',
      '/api/v1/hostel/leaves',
      ['admin'],
      leaveBody(hostelB),
      TENANT_B,
    );
    expect(leaveB.statusCode, leaveB.body).toBe(201);
    const idA = (leaveA.json() as { id: string }).id;
    const idB = (leaveB.json() as { id: string }).id;

    const listA = await call('GET', '/api/v1/hostel/leaves?pageSize=100', ['warden']);
    expect(listA.statusCode, listA.body).toBe(200);
    const idsA = (listA.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(idsA).toContain(idA);
    expect(idsA).not.toContain(idB);
    const hostelsA = await call('GET', '/api/v1/hostel?pageSize=100', ['warden']);
    expect(hostelsA.body).not.toContain(hostelB);

    // A forged X-Tenant-ID never widens the JWT tenant.
    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/hostel/leaves?pageSize=100',
      headers: { authorization: `Bearer ${bearer(['warden'])}`, 'x-tenant-id': TENANT_B },
    });
    expect(forged.body).not.toContain(idB);
  });
});
