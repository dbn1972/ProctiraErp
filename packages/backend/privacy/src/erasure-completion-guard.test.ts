import { BusinessRuleError, ConflictError } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';
import { RecordingSubjectAnonymizer, type SubjectAnonymizer } from './subject-anonymizer.js';

const TENANT = 'tenant-a';

const cleanAnonymizer: SubjectAnonymizer = {
  async anonymize() {
    return { fieldsTouched: ['display_name'] };
  },
};

async function approvedRequest(service: PrivacyService) {
  const req = await service.createErasureRequest({
    tenantId: TENANT,
    subjectType: 'student',
    subjectId: 'stu-1',
    requestedBy: 'parent-1',
  });
  await service.transitionErasureRequest(req.id, TENANT, 'under_review', 'officer');
  await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');
  return req;
}

describe('erasure completion is reachable only via anonymization (PRC-H076)', () => {
  let repository: InMemoryPrivacyRepository;

  beforeEach(() => {
    repository = new InMemoryPrivacyRepository();
  });

  it('manual transition approved -> in_progress / completed is rejected with 422', async () => {
    const service = new PrivacyService(repository, { anonymizer: cleanAnonymizer });
    const req = await approvedRequest(service);
    for (const target of ['in_progress', 'completed', 'blocked_legal_hold'] as const) {
      await expect(
        service.transitionErasureRequest(req.id, TENANT, target, 'officer'),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    }
    const after = await service.getErasureRequest(req.id, TENANT);
    expect(after?.status).toBe('approved');
    expect(after?.completedAt).toBeNull();
  });

  it('in_progress with residual cannot be manually completed', async () => {
    const service = new PrivacyService(repository, {
      anonymizer: new RecordingSubjectAnonymizer(),
    });
    const req = await approvedRequest(service);
    await service.executeErasure(req.id, TENANT, 'officer');
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('in_progress');
    await expect(
      service.transitionErasureRequest(req.id, TENANT, 'completed', 'officer'),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    const after = await service.getErasureRequest(req.id, TENANT);
    expect(after?.status).toBe('in_progress');
    expect(after?.completedAt).toBeNull();
  });

  it('completed only when a completed zero-residual anonymization job exists', async () => {
    const service = new PrivacyService(repository, { anonymizer: cleanAnonymizer });
    const req = await approvedRequest(service);
    const done = await service.executeErasure(req.id, TENANT, 'officer');
    expect(done.status).toBe('completed');
    const jobs = await repository.listAnonymizationJobs(TENANT);
    expect(jobs.some((j) => j.erasureRequestId === req.id && j.status === 'completed')).toBe(true);
  });

  it('double execute is rejected by the compare-and-set guard', async () => {
    const service = new PrivacyService(repository, {
      anonymizer: new RecordingSubjectAnonymizer(),
    });
    const req = await approvedRequest(service);
    const repoUpdate = repository.updateErasureRequest.bind(repository);
    // Simulate a concurrent executor moving the row after our read.
    let raced = false;
    repository.updateErasureRequest = async (id, tenantId, data, options) => {
      if (!raced && options?.expectedStatus === 'approved') {
        raced = true;
        await repoUpdate(id, tenantId, { status: 'in_progress' });
      }
      return repoUpdate(id, tenantId, data, options);
    };
    await expect(service.executeErasure(req.id, TENANT, 'officer')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('HTTP POST /transition to completed returns 422 and leaves status unchanged', async () => {
    const service = new PrivacyService(repository, { anonymizer: cleanAnonymizer });
    const req = await approvedRequest(service);
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await registerPrivacyRoutes(app, { privacyService: service });
    const res = await app.inject({
      method: 'POST',
      url: `/privacy/erasure-requests/${req.id}/transition`,
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(422);
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    await app.close();
  });
});
