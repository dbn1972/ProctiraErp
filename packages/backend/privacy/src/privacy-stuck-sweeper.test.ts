/**
 * PRC-H078: jobs stuck in `queued` past PRIVACY_JOB_STUCK_MINUTES are found
 * across tenants and retried (re-enqueued, or processed inline).
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { readPrivacyJobStuckMinutes } from './privacy-plugin.js';
import { PrivacyService } from './privacy-service.js';
import type { SubjectAnonymizer } from './subject-anonymizer.js';

const cleanAnonymizer: SubjectAnonymizer = {
  async anonymize() {
    return { fieldsTouched: ['display_name'] };
  },
};

async function seedQueuedJob(repo: InMemoryPrivacyRepository, tenantId: string, id: string) {
  const erasure = await repo.createErasureRequest({
    id: `er-${id}`,
    tenantId,
    subjectType: 'student',
    subjectId: `stu-${id}`,
    requestedBy: 'officer',
    requestType: 'anonymization',
    status: 'in_progress',
    reviewedBy: 'officer',
    statusReason: null,
  } as never);
  return repo.createAnonymizationJob({
    id,
    tenantId,
    erasureRequestId: erasure.id,
    subjectType: 'student',
    subjectId: `stu-${id}`,
    requestType: 'anonymization',
    status: 'queued',
    actorId: 'officer',
    statusReason: 'Queued',
    fieldsTouched: [],
    residualNote: null,
    startedAt: null,
    completedAt: null,
  });
}

describe('PRC-H078 privacy stuck-job sweeper', () => {
  it('defaults the stuck threshold to 15 minutes', () => {
    expect(readPrivacyJobStuckMinutes({})).toBe(15);
    expect(readPrivacyJobStuckMinutes({ PRIVACY_JOB_STUCK_MINUTES: '5' })).toBe(5);
    expect(readPrivacyJobStuckMinutes({ PRIVACY_JOB_STUCK_MINUTES: 'x' })).toBe(15);
  });

  it('re-enqueues stuck jobs across tenants, ignoring fresh ones', async () => {
    const repo = new InMemoryPrivacyRepository();
    await seedQueuedJob(repo, 'tenant-a', 'job-a');
    await seedQueuedJob(repo, 'tenant-b', 'job-b');
    const enqueueAnonymization = vi.fn(async () => undefined);
    const service = new PrivacyService(repo, {
      anonymizer: cleanAnonymizer,
      anonymizationPublisher: { enqueueAnonymization },
    });
    // Fresh: not yet past the threshold.
    expect((await service.sweepStuckJobs(15)).scanned).toBe(0);
    const later = new Date(Date.now() + 16 * 60_000);
    const r = await service.sweepStuckJobs(15, later);
    expect(r).toEqual({ scanned: 2, retried: 2, failed: 0 });
    expect(enqueueAnonymization.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: 'job-a', tenantId: 'tenant-a' }),
        expect.objectContaining({ jobId: 'job-b', tenantId: 'tenant-b' }),
      ]),
    );
    const job = await repo.findAnonymizationJobById('job-a', 'tenant-a');
    expect(job?.statusReason).toMatch(/stuck-job sweeper/);
  });

  it('processes stuck jobs inline when no publisher is wired', async () => {
    const repo = new InMemoryPrivacyRepository();
    await seedQueuedJob(repo, 'tenant-a', 'job-a');
    const service = new PrivacyService(repo, { anonymizer: cleanAnonymizer });
    const r = await service.sweepStuckJobs(15, new Date(Date.now() + 16 * 60_000));
    expect(r.retried).toBe(1);
    const job = await repo.findAnonymizationJobById('job-a', 'tenant-a');
    expect(job?.status).not.toBe('queued');
  });
});
