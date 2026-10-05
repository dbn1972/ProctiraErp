import { BusinessRuleError, ConflictError } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
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

  it('residual run returns to approved (retryable) and cannot be manually completed', async () => {
    const service = new PrivacyService(repository, {
      anonymizer: new RecordingSubjectAnonymizer(),
    });
    const req = await approvedRequest(service);
    await service.executeErasure(req.id, TENANT, 'officer');
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    await expect(
      service.transitionErasureRequest(req.id, TENANT, 'completed', 'officer'),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    const after = await service.getErasureRequest(req.id, TENANT);
    expect(after?.status).toBe('approved');
    expect(after?.completedAt).toBeNull();
  });
  // PRC-M320: failure / fault-injection leave the request retryable.
  it('anonymizer throw -> request retryable; re-execute creates a new job', async () => {
    let fail = true;
    const flaky: SubjectAnonymizer = {
      async anonymize() {
        if (fail) throw new Error('domain store unavailable');
        return { fieldsTouched: ['display_name'] };
      },
    };
    const service = new PrivacyService(repository, { anonymizer: flaky });
    const req = await approvedRequest(service);
    await expect(service.executeErasure(req.id, TENANT, 'officer')).rejects.toThrow(/unavailable/);
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    fail = false;
    const done = await service.executeErasure(req.id, TENANT, 'officer');
    expect(done.status).toBe('completed');
    const jobs = (await repository.listAnonymizationJobs(TENANT)).filter(
      (j) => j.erasureRequestId === req.id,
    );
    expect(jobs.map((j) => j.status).sort()).toEqual(['completed', 'failed']);
  });
  it('createAnonymizationJob fault leaves the request approved (no half-written start)', async () => {
    const service = new PrivacyService(repository, { anonymizer: cleanAnonymizer });
    const req = await approvedRequest(service);
    repository.createAnonymizationJob = async () => {
      throw new Error('insert failed');
    };
    await expect(service.executeErasure(req.id, TENANT, 'officer')).rejects.toThrow(
      /insert failed/,
    );
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
  });
  it('enqueue failure compensates: job failed, request approved', async () => {
    const service = new PrivacyService(repository, {
      anonymizer: cleanAnonymizer,
      anonymizationPublisher: {
        async enqueueAnonymization() {
          throw new Error('broker down');
        },
      },
    });
    const req = await approvedRequest(service);
    await expect(service.executeErasure(req.id, TENANT, 'officer')).rejects.toThrow(/broker/);
    expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('approved');
    const jobs = await repository.listAnonymizationJobs(TENANT);
    expect(jobs[0]?.status).toBe('failed');
  });
  it('stuck in_progress can be manually returned to approved for retry', async () => {
    const service = new PrivacyService(repository, { anonymizer: cleanAnonymizer });
    const req = await approvedRequest(service);
    await repository.updateErasureRequest(req.id, TENANT, { status: 'in_progress' });
    const back = await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');
    expect(back.status).toBe('approved');
  });

  // Review #554: the manual revert must not orphan a runnable job.
  describe('manual in_progress -> approved fences the anonymization job', () => {
    const queuedOnly = { async enqueueAnonymization() {} };

    it('refuses (409) while the current job is live and leaves request + job untouched', async () => {
      const service = new PrivacyService(repository, {
        anonymizer: cleanAnonymizer,
        anonymizationPublisher: queuedOnly,
      });
      const req = await approvedRequest(service);
      await service.executeErasure(req.id, TENANT, 'officer');
      await expect(
        service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer'),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('in_progress');
      const [job] = await repository.listAnonymizationJobs(TENANT);
      expect(job?.status).toBe('queued');
    });

    it('stale job is failed atomically; revert -> cancel -> late worker cannot erase or complete', async () => {
      let anonymizeCalls = 0;
      const service = new PrivacyService(repository, {
        anonymizer: {
          async anonymize() {
            anonymizeCalls += 1;
            return { fieldsTouched: ['display_name'] };
          },
        },
        anonymizationPublisher: queuedOnly,
        stalledJobAfterMs: 0,
      });
      const req = await approvedRequest(service);
      await service.executeErasure(req.id, TENANT, 'officer');
      const [job] = await repository.listAnonymizationJobs(TENANT);

      const back = await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');
      expect(back.status).toBe('approved');
      expect((await repository.findAnonymizationJobById(job!.id, TENANT))?.status).toBe('failed');
      await service.transitionErasureRequest(req.id, TENANT, 'cancelled', 'officer');

      // The queued message is delivered after the subject withdrew the DSAR.
      const late = await service.processAnonymizationJob(job!.id, TENANT);
      expect(late.status).toBe('failed');
      expect(anonymizeCalls).toBe(0);
      const after = await service.getErasureRequest(req.id, TENANT);
      expect(after?.status).toBe('cancelled');
      expect(after?.completedAt).toBeNull();
    });

    it('a job whose request left in_progress is fenced without anonymizing', async () => {
      let anonymizeCalls = 0;
      const service = new PrivacyService(repository, {
        anonymizer: {
          async anonymize() {
            anonymizeCalls += 1;
            return { fieldsTouched: ['display_name'] };
          },
        },
        anonymizationPublisher: queuedOnly,
      });
      const req = await approvedRequest(service);
      await service.executeErasure(req.id, TENANT, 'officer');
      const [job] = await repository.listAnonymizationJobs(TENANT);
      // Out-of-band move (e.g. legacy data) — the worker must re-check the request.
      await repository.updateErasureRequest(req.id, TENANT, { status: 'cancelled' });

      const result = await service.processAnonymizationJob(job!.id, TENANT);
      expect(result.status).toBe('failed');
      expect(result.statusReason).toMatch(/not in_progress/);
      expect(anonymizeCalls).toBe(0);
      expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('cancelled');
    });

    it('run fenced mid-anonymize records a conflict and never writes the request', async () => {
      const audit = new RecordingPrivacyAuditPort();
      let requestId = '';
      const service: PrivacyService = new PrivacyService(repository, {
        audit,
        anonymizationPublisher: queuedOnly,
        stalledJobAfterMs: 0,
        anonymizer: {
          async anonymize() {
            // While this run is executing, an operator releases it and cancels the DSAR.
            await service.transitionErasureRequest(requestId, TENANT, 'approved', 'officer');
            await service.transitionErasureRequest(requestId, TENANT, 'cancelled', 'officer');
            return { fieldsTouched: ['display_name'] };
          },
        },
      });
      const req = await approvedRequest(service);
      requestId = req.id;
      await service.executeErasure(req.id, TENANT, 'officer');
      const [job] = await repository.listAnonymizationJobs(TENANT);

      const result = await service.processAnonymizationJob(job!.id, TENANT);
      expect(result.status).toBe('failed');
      expect(result.residualNote).toMatch(/Conflict: run was fenced/);
      expect(result.fieldsTouched).toEqual(['display_name']);
      const after = await service.getErasureRequest(req.id, TENANT);
      expect(after?.status).toBe('cancelled');
      expect(after?.completedAt).toBeNull();
      expect(audit.events.some((e) => e.metadata?.conflict === true)).toBe(true);
      expect(audit.events.some((e) => e.afterValues?.status === 'completed')).toBe(false);
    });

    it('completed is written only by CAS from in_progress; a miss is recorded as residual', async () => {
      let requestId = '';
      const service = new PrivacyService(repository, {
        anonymizationPublisher: queuedOnly,
        anonymizer: {
          async anonymize() {
            // Request moves without fencing the job (defence in depth for the completion CAS).
            await repository.updateErasureRequest(requestId, TENANT, { status: 'cancelled' });
            return { fieldsTouched: ['display_name'] };
          },
        },
      });
      const req = await approvedRequest(service);
      requestId = req.id;
      await service.executeErasure(req.id, TENANT, 'officer');
      const [job] = await repository.listAnonymizationJobs(TENANT);

      const result = await service.processAnonymizationJob(job!.id, TENANT);
      expect(result.status).toBe('failed');
      expect(result.residualNote).toMatch(/Conflict: erasure request was 'cancelled'/);
      const after = await service.getErasureRequest(req.id, TENANT);
      expect(after?.status).toBe('cancelled');
      expect(after?.completedAt).toBeNull();
    });

    it('two runs cannot both own the request: re-execute after release fences the first job', async () => {
      const service = new PrivacyService(repository, {
        anonymizer: cleanAnonymizer,
        anonymizationPublisher: queuedOnly,
        stalledJobAfterMs: 0,
      });
      const req = await approvedRequest(service);
      await service.executeErasure(req.id, TENANT, 'officer');
      const [job1] = await repository.listAnonymizationJobs(TENANT);
      await service.transitionErasureRequest(req.id, TENANT, 'approved', 'officer');
      await service.executeErasure(req.id, TENANT, 'officer');
      const job2 = (await repository.listAnonymizationJobs(TENANT)).find((j) => j.id !== job1!.id);

      expect((await service.processAnonymizationJob(job1!.id, TENANT)).status).toBe('failed');
      expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('in_progress');
      expect((await service.processAnonymizationJob(job2!.id, TENANT)).status).toBe('completed');
      expect((await service.getErasureRequest(req.id, TENANT))?.status).toBe('completed');
    });
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
    const repoStart = repository.startErasureExecution.bind(repository);
    // Simulate a concurrent executor moving the row after our read.
    repository.startErasureExecution = async (id, tenantId, patch, job) => {
      await repoUpdate(id, tenantId, { status: 'in_progress' });
      return repoStart(id, tenantId, patch, job);
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
      (request as unknown as { user: { sub: string } }).user = { sub: 'officer-1' };
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
