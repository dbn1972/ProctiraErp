import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PrivacyExecutorNotConfiguredError, PrivacyService } from './privacy-service.js';
import { privacyPlugin } from './privacy-plugin.js';

const TENANT = 'tenant-a';

describe('destructive privacy ops refuse when no real executor is wired (PRC-H077)', () => {
  it('executeErasure with default anonymizer throws 501 and leaves request approved, no job', async () => {
    const repository = new InMemoryPrivacyRepository();
    const service = new PrivacyService(repository);
    expect(service.erasureExecutionAvailable).toBe(false);
    const req = await service.createErasureRequest({
      tenantId: TENANT,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent',
    });
    await service.transitionErasureRequest(req.id, TENANT, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');
    await expect(service.executeErasure(req.id, TENANT, 'officer')).rejects.toBeInstanceOf(
      PrivacyExecutorNotConfiguredError,
    );
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    expect(await repository.listAnonymizationJobs(TENANT)).toHaveLength(0);
  });

  it('gateway-style plugin (no executors) returns 501 for execute and tenant-offboard', async () => {
    const repository = new InMemoryPrivacyRepository();
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await app.register(privacyPlugin, { repository, prefix: '/privacy' });
    const service = app.privacyService;
    const req = await service.createErasureRequest({
      tenantId: TENANT,
      subjectType: 'student',
      subjectId: 'stu-1',
      requestedBy: 'parent',
    });
    await service.transitionErasureRequest(req.id, TENANT, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');

    const exec = await app.inject({
      method: 'POST',
      url: `/privacy/erasure-requests/${req.id}/execute`,
    });
    expect(exec.statusCode).toBe(501);
    expect(exec.json().code).toBe('NOT_IMPLEMENTED');

    const offboard = await app.inject({
      method: 'POST',
      url: '/privacy/tenant-offboard',
      payload: { reason: 'Contract ended' },
    });
    expect(offboard.statusCode).toBe(501);
    await app.close();
  });
});
