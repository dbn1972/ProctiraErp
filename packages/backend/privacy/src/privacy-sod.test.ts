/**
 * PRC-L336 (topic 3 Option A: "require a second actor for self-approval/erasure"):
 * - the requester of an erasure cannot approve it (409);
 * - the requester of an erasure cannot execute it (409);
 * - the actor who placed a legal hold cannot release it (409);
 * - a second actor can do each step, and the refused step leaves state unchanged.
 */
import { ConflictError } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';
const TENANT = 'tenant-a';
describe('PRC-L336 privacy separation of duties', () => {
  let service: PrivacyService;
  beforeEach(() => {
    service = new PrivacyService(new InMemoryPrivacyRepository(), {
      audit: new RecordingPrivacyAuditPort(),
      anonymizer: { anonymize: async () => ({ fieldsTouched: ['email'] }) },
    });
  });
  async function request(requestedBy: string) {
    const req = await service.createErasureRequest({
      tenantId: TENANT,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy,
    });
    await service.transitionErasureRequest(req.id, TENANT, 'under_review', 'reviewer');
    return req;
  }
  it('the requester cannot approve their own erasure request', async () => {
    const req = await request('dpo-1');
    await expect(
      service.transitionErasureRequest(req.id, TENANT, 'approved', 'dpo-1'),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('under_review');
    const approved = await service.transitionErasureRequest(req.id, TENANT, 'approved', 'dpo-2');
    expect(approved.status).toBe('approved');
  });
  it('the requester cannot execute their own erasure request', async () => {
    const req = await request('dpo-1');
    await service.transitionErasureRequest(req.id, TENANT, 'approved', 'dpo-2');
    await expect(service.executeErasure(req.id, TENANT, 'dpo-1')).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    const done = await service.executeErasure(req.id, TENANT, 'dpo-2');
    expect(done.status).toBe('completed');
  });
  it('the requester may still cancel or reject their own request (not an approval)', async () => {
    const req = await request('dpo-1');
    const cancelled = await service.transitionErasureRequest(req.id, TENANT, 'cancelled', 'dpo-1');
    expect(cancelled.status).toBe('cancelled');
  });
  it('the actor who placed a legal hold cannot release it', async () => {
    const hold = await service.placeLegalHold({
      tenantId: TENANT,
      scope: 'tenant',
      reason: 'Litigation',
      placedBy: 'counsel-1',
    });
    await expect(service.releaseLegalHold(hold.id, TENANT, 'counsel-1')).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await service.isOnLegalHold(TENANT)).toBe(true);
    expect((await service.releaseLegalHold(hold.id, TENANT, 'counsel-2')).active).toBe(false);
  });
  it('HTTP: a self-approval through the transition route returns 409', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      (req as unknown as { tenantId: string }).tenantId = TENANT;
      const sub = req.headers['x-test-sub'];
      (req as unknown as { user: { sub: string } }).user = {
        sub: typeof sub === 'string' ? sub : 'dpo-1',
      };
    });
    await registerPrivacyRoutes(app, { privacyService: service });
    const created = await app.inject({
      method: 'POST',
      url: '/privacy/erasure-requests',
      payload: { subjectType: 'student', subjectId: 'stu-9' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const review = await app.inject({
      method: 'POST',
      url: `/privacy/erasure-requests/${id}/transition`,
      headers: { 'x-test-sub': 'reviewer' },
      payload: { status: 'under_review' },
    });
    expect(review.statusCode).toBe(200);
    const self = await app.inject({
      method: 'POST',
      url: `/privacy/erasure-requests/${id}/transition`,
      payload: { status: 'approved' },
    });
    expect(self.statusCode).toBe(409);
    await app.close();
  });
});
