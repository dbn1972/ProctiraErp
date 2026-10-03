/**
 * PRC-L499: table-driven authz matrix over EVERY route the staff plugin registers.
 *
 * - Every registered route must have an explicit entry in ROUTE_ACTIONS; adding a route
 *   without classifying it (or leaving a stale entry) fails this suite in CI.
 * - Domain-gated routes: denied roles get 403 before the handler; an allowed role passes.
 * - Cross-tenant ids resolve to 404.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryStaffHrStore } from './hr-store.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { hasStaffAccess, type StaffAction } from './staff-access.js';
import { staffPlugin } from './staff-plugin.js';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
const ANY_ID = '770e8400-e29b-41d4-a716-446655440002';

/**
 * Read classifications that are NOT domain-gated on this branch (gateway RBAC only):
 * - 'gateway-read': list/detail reads gated by the api-gateway resource map.
 * - 'hr-read-H088': kept for compatibility; with PR #499 (PRC-H088) merged, HR reads map to
 *   staff.hr.read and GET /payroll/export (which persists runs) to payroll.export.
 */
type Classification = StaffAction | 'gateway-read' | 'hr-read-H088';

const ROUTE_ACTIONS: Record<string, Classification> = {
  // routes.ts
  'POST /staff': 'staff.create',
  'PUT /staff/:id': 'staff.update',
  'DELETE /staff/:id': 'staff.delete',
  'POST /staff/:id/offboard': 'staff.create',
  'GET /staff': 'staff.read',
  'GET /staff/:id': 'staff.read',
  'GET /staff/:id/offboard': 'staff.read',
  // assignment-routes.ts
  'POST /staff/assignments': 'staff.hr.write',
  'PUT /staff/assignments/:id': 'staff.hr.write',
  'DELETE /staff/assignments/:id': 'staff.hr.write',
  'GET /staff/assignments': 'gateway-read',
  'GET /staff/assignments/:id': 'gateway-read',
  // leave-routes.ts
  'POST /staff/leaves': 'staff.hr.write',
  'POST /staff/leaves/:id/decide': 'staff.hr.write',
  'GET /staff/leaves': 'gateway-read',
  // PRC-H091 (#499): per-staff leave balances are HR data; reads are gated like writes.
  'GET /staff/:id/leave-balances': 'staff.hr.write',
  'PUT /staff/:id/leave-balances': 'staff.hr.write',
  'POST /staff/leave-balances/import': 'staff.hr.write',
  // hr-routes.ts
  'POST /staff/contracts': 'staff.hr.write',
  'PATCH /staff/contracts/:id': 'staff.hr.write',
  'POST /staff/qualifications': 'staff.hr.write',
  'POST /staff/qualifications/:id/verify': 'staff.hr.write',
  'POST /staff/attendance': 'staff.hr.write',
  'POST /staff/attendance/bulk': 'staff.hr.write',
  'POST /staff/import/dry-run': 'staff.import',
  'POST /staff/import/commit': 'staff.import',
  'GET /staff/contracts': 'staff.hr.read',
  'GET /staff/contracts/:id': 'staff.hr.read',
  'GET /staff/qualifications': 'staff.hr.read',
  'GET /staff/attendance': 'staff.hr.read',
  'GET /staff/attendance/summary': 'staff.hr.read',
  'GET /staff/payroll/export': 'payroll.export',
  // appraisal-routes.ts
  'POST /staff/appraisals/templates': 'staff.hr.write',
  'POST /staff/appraisals': 'staff.hr.write',
  'POST /staff/appraisals/:id/submit': 'staff.hr.write',
  'GET /staff/appraisals/templates': 'gateway-read',
  'GET /staff/appraisals/templates/:templateId': 'gateway-read',
  'GET /staff/appraisals': 'gateway-read',
  'GET /staff/appraisals/:id': 'gateway-read',
  // training-routes.ts
  'POST /staff/training/programs': 'staff.hr.write',
  'PUT /staff/training/programs/:programId': 'staff.hr.write',
  'POST /staff/training/sessions': 'staff.hr.write',
  'POST /staff/training/attendance': 'staff.hr.write',
  'POST /staff/training/certifications': 'staff.hr.write',
  'POST /staff/training/certifications/process-expiry': 'staff.hr.write',
  'GET /staff/training/programs': 'gateway-read',
  'GET /staff/training/programs/:programId': 'gateway-read',
  'GET /staff/training/programs/:programId/sessions': 'gateway-read',
  'GET /staff/training/sessions/:sessionId': 'gateway-read',
  'GET /staff/training/sessions/:sessionId/attendance': 'gateway-read',
  'GET /staff/training/certifications': 'gateway-read',
  'GET /staff/training/certifications/:certificationId': 'gateway-read',
};

/** Roles probed for denial; an action's allowlist is taken from hasStaffAccess. */
const PROBE_ROLES: string[][] = [
  [],
  ['teacher'],
  ['parent'],
  ['student'],
  ['guardian'],
  ['bursar'],
  ['finance_officer'],
  ['hr_officer'],
  ['registrar'],
  ['admin'],
];

interface Ctx {
  tenantId: string;
  roles: unknown;
}

let app: FastifyInstance | undefined;

async function mountPlugin(ctx: Ctx, routes: string[] = []) {
  app = Fastify();
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', undefined);
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) routes.push(`${String(m).toUpperCase()} ${r.url}`);
  });
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as { tenantId: string; user: { sub: string; roles: unknown } };
    r.tenantId = ctx.tenantId;
    r.user = { sub: 'actor-1', roles: ctx.roles };
  });
  await app.register(staffPlugin, {
    repository: new InMemoryStaffRepository(),
    assignmentRepository: new InMemoryAssignmentRepository(),
    leaveRepository: new InMemoryStaffLeaveRepository(),
    hrStore: new InMemoryStaffHrStore(),
    appraisalRepositories: {
      templateRepository: new InMemoryAppraisalTemplateRepository(),
      appraisalRepository: new InMemoryAppraisalRepository(),
    },
    trainingRepositories: {
      programRepository: new InMemoryTrainingProgramRepository(),
      sessionRepository: new InMemoryTrainingSessionRepository(),
      attendanceRepository: new InMemoryTrainingAttendanceRepository(),
      certificationRepository: new InMemoryCertificationRepository(),
    },
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const concreteUrl = (pattern: string) => pattern.replace(/:[A-Za-z]+/g, ANY_ID);

const gated = Object.entries(ROUTE_ACTIONS).filter(
  (e): e is [string, StaffAction] => e[1] !== 'gateway-read' && e[1] !== 'hr-read-H088',
);

describe('PRC-L499 staff plugin route -> action mapping is complete', () => {
  it('every registered route has an explicit classification and no entry is stale', async () => {
    const routes: string[] = [];
    await mountPlugin({ tenantId: TENANT_A, roles: [] }, routes);
    const registered = new Set(routes.filter((r) => !r.startsWith('HEAD ')));
    const unmapped = [...registered].filter((r) => !(r in ROUTE_ACTIONS));
    const stale = Object.keys(ROUTE_ACTIONS).filter((r) => !registered.has(r));
    expect(unmapped, 'routes missing an explicit action mapping').toEqual([]);
    expect(stale, 'mapping entries for routes that no longer exist').toEqual([]);
    // HEAD is only ever the automatic mirror of a mapped GET.
    for (const head of routes.filter((r) => r.startsWith('HEAD '))) {
      expect(registered.has(head.replace(/^HEAD /, 'GET '))).toBe(true);
    }
  });
});

describe('PRC-L499 staff plugin authz matrix (domain-gated routes x roles)', () => {
  const cases = gated.flatMap(([route, action]) =>
    PROBE_ROLES.map((roles) => ({ route, action, roles, allowed: hasStaffAccess(roles, action) })),
  );

  it('the matrix includes both denied and allowed probes for every gated action', () => {
    for (const [, action] of gated) {
      const forAction = cases.filter((c) => c.action === action);
      expect(forAction.some((c) => c.allowed)).toBe(true);
      expect(forAction.some((c) => !c.allowed)).toBe(true);
    }
  });

  it.each(cases)('$route as $roles (allowed=$allowed)', async ({ route, roles, allowed }) => {
    const [method, pattern] = route.split(' ') as [string, string];
    const a = await mountPlugin({ tenantId: TENANT_A, roles });
    const res = await a.inject({
      method: method as 'GET',
      url: concreteUrl(pattern),
      ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
    });
    if (allowed) {
      expect(res.statusCode).not.toBe(403);
    } else {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
  });

  it('finance roles cannot mutate HR records (need-to-know)', () => {
    for (const action of [
      'staff.hr.write',
      'staff.create',
      'staff.delete',
      'staff.import',
    ] as const) {
      expect(hasStaffAccess(['bursar'], action)).toBe(false);
      expect(hasStaffAccess(['finance_officer'], action)).toBe(false);
    }
  });
});

describe('PRC-L499 cross-tenant ids resolve to 404', () => {
  it('staff record and contract created in tenant A are not reachable from tenant B', async () => {
    const ctx: Ctx = { tenantId: TENANT_A, roles: ['hr_officer'] };
    const a = await mountPlugin(ctx);
    const staff = await a.inject({
      method: 'POST',
      url: '/staff',
      payload: {
        firstName: 'Pat',
        lastName: 'Lee',
        dateOfBirth: '1985-06-15',
        identityNumber: 'XT-0001',
        contactPhone: '+15550001111',
        position: 'Teacher',
      },
    });
    expect(staff.statusCode).toBe(201);
    const staffId = staff.json().id as string;
    const contract = await a.inject({
      method: 'POST',
      url: '/staff/contracts',
      payload: { staffId, contractType: 'permanent', startDate: '2026-04-01' },
    });
    expect(contract.statusCode).toBe(201);
    const contractId = contract.json().id as string;

    ctx.tenantId = TENANT_B;
    const probes: [string, string, Record<string, unknown>?][] = [
      ['GET', `/staff/${staffId}`],
      ['PUT', `/staff/${staffId}`, { position: 'Principal' }],
      ['DELETE', `/staff/${staffId}`],
      ['GET', `/staff/${staffId}/offboard`],
      ['POST', `/staff/${staffId}/offboard`, { effectiveDate: '2026-05-01', reason: 'x' }],
      ['GET', `/staff/contracts/${contractId}`],
      ['PATCH', `/staff/contracts/${contractId}`, { notes: 'hijack' }],
      ['POST', '/staff/contracts', { staffId, contractType: 'permanent', startDate: '2026-04-01' }],
    ];
    for (const [method, url, payload] of probes) {
      const res = await a.inject({ method: method as 'GET', url, ...(payload ? { payload } : {}) });
      expect({ method, url, status: res.statusCode }).toEqual({ method, url, status: 404 });
    }
    const list = await a.inject({ method: 'GET', url: '/staff' });
    expect(list.json().data).toHaveLength(0);
    const contracts = await a.inject({ method: 'GET', url: '/staff/contracts' });
    expect(JSON.stringify(contracts.json())).not.toContain(contractId);

    // Tenant A still sees its own records intact.
    ctx.tenantId = TENANT_A;
    const own = await a.inject({ method: 'GET', url: `/staff/${staffId}` });
    expect(own.json().position).toBe('Teacher');
  });
});
