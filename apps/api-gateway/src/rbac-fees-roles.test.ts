/**
 * F-D3 — finance staff roles at the gateway.
 *
 * `packages/backend/fees/src/fees-access.ts` lets `finance_officer`, `bursar`,
 * `accountant` and `registrar` use the fee ledger, but the gateway RBAC
 * registry granted them nothing on `fees`, so every /fees read returned 403
 * and only admin and principal could use the module. These tests pin the
 * least-privilege matrix end to end (gateway RBAC hook + package guard):
 *
 * | roles                               | gateway `fees`             | package refines                         |
 * | finance_officer, bursar             | read, list, create, delete | every fees action                       |
 * | accountant                          | read, list, create, delete | all but concession.approve              |
 * | registrar                           | read, list                 | (writes never reach the package)        |
 * | teacher, staff                      | read (STAFF_READS)         | staff reads denied                      |
 * | guardian, parent, student           | read                       | own-scope invoices/receipts only        |
 * | nurse, hr_officer, counsellor, ...  | none                       |                                         |
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FEES_BASE_READ_ROLE_IDS, type PermissionAction } from '@proctira/auth';
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
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_ID = '44444444-4444-4444-8444-444444444444';

const FINANCE_STAFF = ['finance_officer', 'bursar', 'accountant'] as const;
const CONCESSION_APPROVERS = ['finance_officer', 'bursar'] as const;
const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

/** Every tenant-wide fees read the web screens make (package `fees.read`). */
const STAFF_READ_URLS = [
  '/api/v1/fees/plans',
  '/api/v1/fees/invoices',
  '/api/v1/fees/receipts',
  '/api/v1/fees/payments',
  '/api/v1/fees/structures',
  '/api/v1/fees/ledger/trial-balance',
  '/api/v1/fees/reports/dues',
  '/api/v1/fees/reconciliation/batches',
  '/api/v1/fees/reminders/overdue',
  '/api/v1/fees/reminders/suppressions',
  '/api/v1/fees/reminders/audit',
] as const;

/** Staff reads with no self scope (portal roles get 403 from the package). */
const STAFF_ONLY_READ_URLS = STAFF_READ_URLS.filter(
  (url) => url !== '/api/v1/fees/invoices' && url !== '/api/v1/fees/receipts',
);

/** Package `concession.approve` read (scholarship netting screen). */
const NETTABLE_URL = '/api/v1/fees/scholarships/nettable-disbursements';

function expectedActions(roleId: string): PermissionAction[] {
  if ((FINANCE_STAFF as readonly string[]).includes(roleId)) {
    return ['read', 'list', 'create', 'delete'];
  }
  if (roleId === 'registrar') return ['read', 'list'];
  if (['teacher', 'staff', 'guardian', 'parent', 'student'].includes(roleId)) return ['read'];
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

describe('finance role matrix in the gateway registry (F-D3)', () => {
  const registry = createGatewayRbacRegistry();

  it('grants each role exactly its matrix actions on fees', () => {
    for (const roleId of [
      ...FINANCE_STAFF,
      'registrar',
      'teacher',
      'staff',
      'guardian',
      'parent',
      'student',
      'nurse',
      'hr_officer',
      'counsellor',
      'warden',
      'transport_officer',
    ]) {
      const allowed = expectedActions(roleId);
      for (const action of ACTIONS) {
        expect(registry.roleHasPermission(roleId, 'fees', action), `${roleId} fees:${action}`).toBe(
          allowed.includes(action),
        );
      }
    }
  });

  it('gives the finance roles no other resource, and keeps the registrar grants', () => {
    for (const roleId of FINANCE_STAFF) {
      const role = registry.getRole(roleId);
      expect(role, roleId).toBeDefined();
      for (const permission of role!.permissions) {
        expect(permission.resource, `${roleId} ${permission.resource}`).toBe('fees');
      }
    }
    expect(registry.roleHasPermission('registrar', 'staff', 'manage')).toBe(true);
    expect(
      registry
        .getRole('registrar')!
        .permissions.map((p) => `${p.resource}:${p.action}`)
        .filter((p) => !p.startsWith('staff:'))
        .sort(),
    ).toEqual([
      'fees:list',
      'fees:read',
      'hostel:list',
      'hostel:read',
      'transport:list',
      'transport:read',
    ]);
  });

  it('FEES_BASE_READ_ROLE_IDS lists exactly the base roles holding a plain fees read', () => {
    // The web guard treats these roles as holding the gateway `fees` read for
    // the multi-role rule. They hold it through STAFF_READS and the portal
    // roles, not through the finance matrix, `manage` or a `*` wildcard.
    const financeRoles = new Set<string>([...FINANCE_STAFF, 'registrar']);
    const readers = registry
      .getAllRoles()
      .filter((role) => !financeRoles.has(role.roleId))
      .filter((role) => role.permissions.some((p) => p.resource === 'fees' && p.action === 'read'))
      .filter(
        (role) =>
          !role.permissions.some(
            (p) => (p.resource === 'fees' || p.resource === '*') && p.action === 'manage',
          ),
      )
      .map((role) => role.roleId)
      .sort();
    expect(readers).toEqual([...(FEES_BASE_READ_ROLE_IDS ?? [])].sort());
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

describe('tenant custom roles cannot redefine the finance role ids', () => {
  it('ignores a tenant custom role named finance_officer / bursar / accountant', async () => {
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
        { resource: 'fees', action: 'manage' },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const provider = new TenantCustomRoleProvider({
      repository: new StubRolesRepository(new Map([[TENANT_A, [...FINANCE_STAFF].map(shadow)]])),
      builtInRoleIds,
    });
    for (const roleId of FINANCE_STAFF) {
      const effective = await provider.registryForRequest(base, TENANT_A, [roleId]);
      expect(effective.roleHasPermission(roleId, 'student', 'read'), roleId).toBe(false);
      expect(effective.roleHasPermission(roleId, 'fees', 'manage'), roleId).toBe(false);
      expect(effective.roleHasPermission(roleId, 'fees', 'update'), roleId).toBe(false);
      expect(effective.roleHasPermission(roleId, 'fees', 'read'), roleId).toBe(true);
    }
  });
});

describe('finance roles through the gateway RBAC hook and the fees package guard', () => {
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
      email: 'finance@example.com',
      displayName: 'Finance User',
      roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'root' })),
      areas: [],
      institutions: [],
      jti: `jti-fees-${roleIds.join('-')}`,
      sessionId: `session-fees-${roleIds.join('-')}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    roleIds: readonly string[],
    payload?: unknown,
    tenantId = TENANT_A,
  ) {
    return app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${bearer(roleIds, tenantId)}`,
        'x-tenant-id': tenantId,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  let seq = 0;
  const planBody = () => ({ name: `Finance Plan ${++seq}`, amountCents: 10000 });
  const invoiceBody = () => ({
    studentId: STUDENT_ID,
    title: `Finance Invoice ${++seq}`,
    amountCents: 50000,
  });
  const structureBody = () => ({
    name: `Finance Structure ${++seq}`,
    category: 'tuition',
    amountCents: 20000,
  });

  async function created(
    roleIds: readonly string[],
    url: string,
    payload: unknown,
    tenantId = TENANT_A,
  ): Promise<string> {
    const res = await call('POST', url, roleIds, payload, tenantId);
    expect(res.statusCode, `${roleIds.join('+')} POST ${url}: ${res.body}`).toBe(201);
    return (res.json() as { id: string }).id;
  }

  /** Every fees write the screens make, with a body the package accepts. */
  async function writeAttempts(): Promise<
    Array<[string, 'POST' | 'DELETE', string, unknown | undefined]>
  > {
    const invoiceId = await created(['admin'], '/api/v1/fees/invoices', invoiceBody());
    const structureId = await created(['admin'], '/api/v1/fees/structures', structureBody());
    const suppressionId = await created(['admin'], '/api/v1/fees/reminders/suppressions', {
      studentId: STUDENT_ID,
      reason: 'F-D3 matrix',
    });
    return [
      ['plan create', 'POST', '/api/v1/fees/plans', planBody()],
      ['invoice create', 'POST', '/api/v1/fees/invoices', invoiceBody()],
      ['structure create', 'POST', '/api/v1/fees/structures', structureBody()],
      [
        'invoice pay',
        'POST',
        `/api/v1/fees/invoices/${invoiceId}/pay`,
        { method: 'cash', amountCents: 100, reference: `R-${++seq}` },
      ],
      ['payment record', 'POST', '/api/v1/fees/payments', { invoiceId, method: 'cash' }],
      ['invoice void', 'POST', `/api/v1/fees/invoices/${invoiceId}/void`, { reason: 'F-D3' }],
      [
        'refund',
        'POST',
        `/api/v1/fees/invoices/${invoiceId}/refund`,
        { amountCents: 1, reason: 'F-D3' },
      ],
      [
        'credit note',
        'POST',
        `/api/v1/fees/invoices/${invoiceId}/credit-notes`,
        { amountCents: 1, reason: 'F-D3' },
      ],
      [
        'write-off',
        'POST',
        `/api/v1/fees/invoices/${invoiceId}/write-offs`,
        { amountCents: 1, reason: 'F-D3' },
      ],
      [
        'concession apply',
        'POST',
        '/api/v1/fees/concessions',
        { studentId: STUDENT_ID, structureId, kind: 'amount', amountCents: 100, reason: 'F-D3' },
      ],
      ['concession approve', 'POST', `/api/v1/fees/concessions/${MISSING_ID}/approve`, {}],
      [
        'suppression add',
        'POST',
        '/api/v1/fees/reminders/suppressions',
        { studentId: STUDENT_ID, reason: 'F-D3' },
      ],
      [
        'suppression remove',
        'DELETE',
        `/api/v1/fees/reminders/suppressions/${suppressionId}`,
        undefined,
      ],
      ['reminders send', 'POST', '/api/v1/fees/reminders/send', {}],
      [
        'scholarship net',
        'POST',
        '/api/v1/fees/scholarships/net',
        { studentId: STUDENT_ID, disbursementId: MISSING_ID },
      ],
    ];
  }

  function expectGatewayDenied(res: { statusCode: number; body: string }, label: string) {
    expect(res.statusCode, `${label}: ${res.body}`).toBe(403);
    expect((JSON.parse(res.body) as { code: string }).code, label).toBe('FORBIDDEN');
    // Refused by the gateway registry, not by the fees package.
    expect(res.body, label).not.toContain('fees action');
  }

  function expectPackageDenied(res: { statusCode: number; body: string }, action: string) {
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain(`fees action ${action}`);
  }

  it.each([...FINANCE_STAFF, 'admin'].map((roleId) => [roleId]))(
    '%s reads every staff fees list',
    async (roleId) => {
      for (const url of STAFF_READ_URLS) {
        const res = await call('GET', url, [roleId]);
        expect(res.statusCode, `${roleId} GET ${url}: ${res.body}`).toBe(200);
      }
    },
  );

  it.each([...FINANCE_STAFF, 'admin'].map((roleId) => [roleId]))(
    '%s creates plans, invoices and structures, takes a payment, voids, and manages reminder suppressions',
    async (roleId) => {
      await created([roleId], '/api/v1/fees/plans', planBody());
      const invoiceId = await created([roleId], '/api/v1/fees/invoices', invoiceBody());
      const structureId = await created([roleId], '/api/v1/fees/structures', structureBody());
      const pay = await call('POST', `/api/v1/fees/invoices/${invoiceId}/pay`, [roleId], {
        method: 'cash',
        amountCents: 100,
        reference: `R-${++seq}`,
      });
      expect([200, 201], `${roleId} pay: ${pay.body}`).toContain(pay.statusCode);
      const concession = await call('POST', '/api/v1/fees/concessions', [roleId], {
        studentId: STUDENT_ID,
        structureId,
        kind: 'amount',
        amountCents: 100,
        reason: 'F-D3 matrix',
      });
      expect(concession.statusCode, `${roleId} concession: ${concession.body}`).toBe(201);
      const voidable = await created([roleId], '/api/v1/fees/invoices', invoiceBody());
      const voided = await call('POST', `/api/v1/fees/invoices/${voidable}/void`, [roleId], {
        reason: 'F-D3 matrix',
      });
      expect(voided.statusCode, `${roleId} void: ${voided.body}`).toBe(200);
      const suppressionId = await created([roleId], '/api/v1/fees/reminders/suppressions', {
        studentId: STUDENT_ID,
        reason: 'F-D3 matrix',
      });
      const removed = await call('DELETE', `/api/v1/fees/reminders/suppressions/${suppressionId}`, [
        roleId,
      ]);
      expect(removed.statusCode, `${roleId} suppression delete: ${removed.body}`).toBe(204);
      // Money corrections on a missing invoice pass both guards and reach the service.
      for (const path of ['refund', 'credit-notes', 'write-offs']) {
        const res = await call('POST', `/api/v1/fees/invoices/${MISSING_ID}/${path}`, [roleId], {
          amountCents: 1,
          reason: 'F-D3 matrix',
        });
        expect(res.statusCode, `${roleId} ${path}: ${res.body}`).toBe(404);
      }
    },
  );

  it.each([...CONCESSION_APPROVERS, 'admin'].map((roleId) => [roleId]))(
    '%s may approve concessions and read nettable scholarship disbursements',
    async (roleId) => {
      const nettable = await call('GET', NETTABLE_URL, [roleId]);
      expect(nettable.statusCode, `${roleId} nettable: ${nettable.body}`).toBe(200);
      const approve = await call(
        'POST',
        `/api/v1/fees/concessions/${MISSING_ID}/approve`,
        [roleId],
        {},
      );
      expect(approve.statusCode, `${roleId} approve: ${approve.body}`).toBe(404);
    },
  );

  it('accountant passes the gateway on concession approval but the package refuses it', async () => {
    expectPackageDenied(await call('GET', NETTABLE_URL, ['accountant']), 'concession.approve');
    expectPackageDenied(
      await call('POST', `/api/v1/fees/concessions/${MISSING_ID}/approve`, ['accountant'], {}),
      'concession.approve',
    );
    expectPackageDenied(
      await call('POST', `/api/v1/fees/concessions/${MISSING_ID}/reject`, ['accountant'], {}),
      'concession.approve',
    );
    expectPackageDenied(
      await call('POST', '/api/v1/fees/scholarships/net', ['accountant'], {
        studentId: STUDENT_ID,
        disbursementId: MISSING_ID,
      }),
      'concession.approve',
    );
  });

  it('registrar reads every staff fees list but every write is 403 at the gateway', async () => {
    for (const url of STAFF_READ_URLS) {
      const res = await call('GET', url, ['registrar']);
      expect(res.statusCode, `registrar GET ${url}: ${res.body}`).toBe(200);
    }
    // Approver-only read: the gateway serves it, the package refuses the registrar.
    expectPackageDenied(await call('GET', NETTABLE_URL, ['registrar']), 'concession.approve');
    for (const [label, method, url, payload] of await writeAttempts()) {
      expectGatewayDenied(await call(method, url, ['registrar'], payload), `registrar ${label}`);
    }
  });

  it.each([['teacher'], ['staff']])(
    '%s alone is refused every staff fees read (package) and every write (gateway)',
    async (roleId) => {
      for (const url of [...STAFF_READ_URLS, NETTABLE_URL]) {
        const res = await call('GET', url, [roleId]);
        expect(res.statusCode, `${roleId} GET ${url}: ${res.body}`).toBe(403);
      }
      for (const [label, method, url, payload] of await writeAttempts()) {
        expectGatewayDenied(await call(method, url, [roleId], payload), `${roleId} ${label}`);
      }
    },
  );

  it.each([['parent'], ['guardian'], ['student']])(
    '%s alone is refused staff fees reads and every write, and never sees tenant invoices',
    async (roleId) => {
      for (const url of [...STAFF_ONLY_READ_URLS, NETTABLE_URL]) {
        const res = await call('GET', url, [roleId]);
        expect(res.statusCode, `${roleId} GET ${url}: ${res.body}`).toBe(403);
      }
      // Invoices and receipts are own-scope for portal roles (unchanged): a
      // tenant-wide invoice is never returned.
      const tenantInvoice = await created(['admin'], '/api/v1/fees/invoices', invoiceBody());
      for (const url of ['/api/v1/fees/invoices', '/api/v1/fees/receipts']) {
        const res = await call('GET', url, [roleId]);
        expect([200, 403], `${roleId} GET ${url}: ${res.body}`).toContain(res.statusCode);
        expect(res.body).not.toContain(tenantInvoice);
      }
      for (const [label, method, url, payload] of await writeAttempts()) {
        expectGatewayDenied(await call(method, url, [roleId], payload), `${roleId} ${label}`);
      }
    },
  );

  it.each([['nurse'], ['hr_officer'], ['warden'], ['transport_officer']])(
    '%s alone has no fees grant at the gateway',
    async (roleId) => {
      for (const url of ['/api/v1/fees/plans', '/api/v1/fees/invoices']) {
        expectGatewayDenied(await call('GET', url, [roleId]), `${roleId} GET ${url}`);
      }
      expectGatewayDenied(
        await call('POST', '/api/v1/fees/plans', [roleId], planBody()),
        `${roleId} plan create`,
      );
    },
  );

  it('serves fees when one role holds the gateway grant and another the package role', async () => {
    // Same role sets as the F-D3 multi-role cases in apps/web domain-route-guards.test.ts.
    const URL = '/api/v1/fees/plans';
    for (const roles of [
      ['teacher', 'bursar'],
      ['staff', 'registrar'],
      // The gateway grant comes only from the base reader; the package role
      // has no gateway registry entry.
      ['teacher', 'school_admin'],
      ['staff', 'fees_clerk'],
      ['teacher', 'cashier'],
      ['guardian', 'system_admin'],
    ]) {
      const res = await call('GET', URL, roles);
      expect(res.statusCode, `${roles.join('+')} GET ${URL}: ${res.body}`).toBe(200);
    }
    for (const roles of [
      // Package role without any gateway fees grant.
      ['school_admin'],
      ['fees_clerk'],
      ['cashier'],
      ['system-admin'],
      ['nurse', 'fees_clerk'],
      // Gateway readers without a package role.
      ['teacher', 'staff'],
      ['teacher', 'guardian'],
      // `*` passes the gateway, the package has no platform role.
      ['platform_admin'],
    ]) {
      const res = await call('GET', URL, roles);
      expect(res.statusCode, `${roles.join('+')} GET ${URL}: ${res.body}`).toBe(403);
    }
    // Neither role holds a fees write at the gateway.
    for (const roles of [
      ['teacher', 'registrar'],
      ['teacher', 'fees_clerk'],
    ]) {
      expectGatewayDenied(
        await call('POST', '/api/v1/fees/plans', roles, planBody()),
        `${roles.join('+')} plan create`,
      );
    }
  });

  it('a tenant A bursar never sees tenant B fee rows', async () => {
    const invoiceA = await created(['bursar'], '/api/v1/fees/invoices', invoiceBody());
    const invoiceB = await created(['admin'], '/api/v1/fees/invoices', invoiceBody(), TENANT_B);
    const planB = await created(['admin'], '/api/v1/fees/plans', planBody(), TENANT_B);

    const listA = await call('GET', '/api/v1/fees/invoices?page=1&pageSize=100', ['bursar']);
    expect(listA.statusCode, listA.body).toBe(200);
    expect(listA.body).toContain(invoiceA);
    expect(listA.body).not.toContain(invoiceB);
    const plansA = await call('GET', '/api/v1/fees/plans', ['bursar']);
    expect(plansA.body).not.toContain(planB);

    // A forged X-Tenant-ID never widens the JWT tenant.
    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/fees/invoices?page=1&pageSize=100',
      headers: { authorization: `Bearer ${bearer(['bursar'])}`, 'x-tenant-id': TENANT_B },
    });
    expect(forged.body).not.toContain(invoiceB);
    // A tenant A bursar cannot void a tenant B invoice.
    const crossVoid = await call('POST', `/api/v1/fees/invoices/${invoiceB}/void`, ['bursar'], {
      reason: 'F-D3 cross tenant',
    });
    expect([403, 404], crossVoid.body).toContain(crossVoid.statusCode);
  });
});
