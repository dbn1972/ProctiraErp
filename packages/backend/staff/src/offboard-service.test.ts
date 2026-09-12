/**
 * Thin offboard status stub — service + route unit tests (P1-HR S0/S1).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffRoutes } from './routes.js';
import { StaffService } from './staff-service.js';
import type { CreateStaffInput } from './schemas.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_A = uuid();
const TENANT_B = uuid();

function validCreateInput(overrides: Partial<CreateStaffInput> = {}): CreateStaffInput {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1985-06-15',
    identityNumber: `ID-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contactPhone: '+1234567890',
    position: 'Teacher',
    ...overrides,
  };
}

describe('StaffService offboard stub', () => {
  let repository: InMemoryStaffRepository;
  let service: StaffService;

  beforeEach(() => {
    repository = new InMemoryStaffRepository();
    service = new StaffService(repository);
  });

  it('marks staff inactive with offboard metadata and isolates tenants', async () => {
    const staff = await service.create(TENANT_A, validCreateInput());
    const view = await service.offboard(
      TENANT_A,
      staff.id,
      { effectiveDate: '2026-09-30', reason: 'End of fixed term' },
      'hr-officer-1',
    );

    expect(view.offboardStatus).toBe('offboarded');
    expect(view.employmentStatus).toBe('INACTIVE');
    expect(view.effectiveDate).toBe('2026-09-30');
    expect(view.reason).toBe('End of fixed term');
    expect(view.decidedBy).toBe('hr-officer-1');
    expect(view.decidedAt).toBeTruthy();

    const stored = await service.getById(TENANT_A, staff.id);
    expect(stored.status).toBe('INACTIVE');

    const status = await service.getOffboardStatus(TENANT_A, staff.id);
    expect(status.offboardStatus).toBe('offboarded');

    await expect(service.getOffboardStatus(TENANT_B, staff.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.offboard(TENANT_B, staff.id, { effectiveDate: '2026-10-01' }, 'evil'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a second offboard with ConflictError', async () => {
    const staff = await service.create(TENANT_A, validCreateInput());
    await service.offboard(TENANT_A, staff.id, { effectiveDate: '2026-09-12' }, 'hr-1');
    await expect(
      service.offboard(TENANT_A, staff.id, { effectiveDate: '2026-09-13' }, 'hr-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns active stub status when never offboarded', async () => {
    const staff = await service.create(TENANT_A, validCreateInput());
    const status = await service.getOffboardStatus(TENANT_A, staff.id);
    expect(status.offboardStatus).toBe('active');
    expect(status.employmentStatus).toBe('ACTIVE');
    expect(status.effectiveDate).toBeNull();
  });
});

describe('Staff offboard routes', () => {
  let app: FastifyInstance;
  let service: StaffService;
  const actorSub = 'jwt-hr-actor';

  beforeEach(async () => {
    app = Fastify();
    const repository = new InMemoryStaffRepository();
    service = new StaffService(repository);

    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_A;
      (request as unknown as { user: { roles: string[]; sub: string } }).user = {
        roles: ['hr_officer'],
        sub: actorSub,
      };
    });

    await registerStaffRoutes(app, { staffService: service });
    await app.ready();
  });

  it('POST /staff/:id/offboard then GET returns stub', async () => {
    const created = await service.create(TENANT_A, validCreateInput());

    const post = await app.inject({
      method: 'POST',
      url: `/staff/${created.id}/offboard`,
      payload: { effectiveDate: '2026-09-15', reason: 'Resignation' },
    });
    expect(post.statusCode).toBe(200);
    const body = post.json();
    expect(body.offboardStatus).toBe('offboarded');
    expect(body.decidedBy).toBe(actorSub);

    const get = await app.inject({
      method: 'GET',
      url: `/staff/${created.id}/offboard`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().offboardStatus).toBe('offboarded');
  });

  it('returns 409 on duplicate offboard and 400 on bad body', async () => {
    const created = await service.create(TENANT_A, validCreateInput());
    await app.inject({
      method: 'POST',
      url: `/staff/${created.id}/offboard`,
      payload: { effectiveDate: '2026-09-15' },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/staff/${created.id}/offboard`,
      payload: { effectiveDate: '2026-09-16' },
    });
    expect(again.statusCode).toBe(409);

    const bad = await app.inject({
      method: 'POST',
      url: `/staff/${created.id}/offboard`,
      payload: { effectiveDate: 'not-a-date' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
