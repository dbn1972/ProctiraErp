/** PRC-M401: stale sweeper, bounded blob-free list, async mode, sanitized errors, cap. */
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableOpsStore, type GenerationJobRecord } from './generation-store.js';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';

function jobRow(overrides: Partial<GenerationJobRecord>): GenerationJobRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    tenantId,
    institutionId,
    academicPeriodId,
    bellScheduleId: null,
    status: 'done',
    requestedBy: null,
    persistMeetings: false,
    teacherMaxPeriodsPerDay: 6,
    demandCount: 1,
    assignedCount: 0,
    unassignedCount: 0,
    clashCount: 0,
    repairPasses: 0,
    stats: {},
    input: { secret: 'big-input' },
    result: { assignments: ['big-result'] },
    errorMessage: null,
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const demandInput = {
  institutionId,
  academicPeriodId,
  demands: [
    {
      sectionId: '77777777-7777-4777-8777-777777777777',
      subjectId: '99999999-9999-4999-8999-999999999999',
      staffId: '55555555-5555-4555-8555-555555555555',
      periodsPerWeek: 1,
    },
  ],
};

describe('generation jobs (PRC-M401)', () => {
  it('sweeper marks a crashed running job failed', async () => {
    const ops = new InMemoryTimetableOpsStore();
    const service = new TimetableService(new InMemoryTimetableRepository(), ops);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stuck = await ops.createJob(
      jobRow({ status: 'running', startedAt: old, createdAt: old, finishedAt: null }),
    );
    const fresh = await ops.createJob(jobRow({ status: 'running', finishedAt: null }));
    await service.listGenerationJobs(tenantId, {});
    expect((await ops.getJob(tenantId, stuck.id))?.status).toBe('failed');
    expect((await ops.getJob(tenantId, fresh.id))?.status).toBe('running');
  });

  it('list is bounded and omits input/result blobs', async () => {
    const ops = new InMemoryTimetableOpsStore();
    const service = new TimetableService(new InMemoryTimetableRepository(), ops);
    for (let i = 0; i < 120; i += 1) await ops.createJob(jobRow({}));
    const page = await service.listGenerationJobs(tenantId, { limit: 10 });
    expect(page).toHaveLength(10);
    expect(JSON.stringify(page)).not.toContain('big-input');
    expect(JSON.stringify(page)).not.toContain('big-result');
    expect(await service.listGenerationJobs(tenantId, { limit: 1000 })).toHaveLength(100);
    expect(await service.listGenerationJobs(tenantId, {})).toHaveLength(50);
  });

  it('internal errors are not leaked into errorMessage', async () => {
    const repo = new InMemoryTimetableRepository();
    repo.listBellSchedules = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    };
    const service = new TimetableService(repo);
    const job = await service.runGenerationJob(tenantId, demandInput, null);
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toBe('Generation failed due to an internal error');
  });

  it('validation failures keep their message', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const job = await service.runGenerationJob(tenantId, demandInput, null);
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toMatch(/bell schedule/i);
  });

  it('async mode returns a queued job and completes off the request path', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const queued = await service.runGenerationJob(tenantId, demandInput, null, { async: true });
    expect(queued.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 20));
    const after = await service.getGenerationJob(tenantId, queued.id);
    expect(after?.status).toBe('failed');
  });

  it('concurrency cap rejects with 429 while a run is in flight', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository(), undefined, {
      maxConcurrentGenerations: 1,
    });
    await service.runGenerationJob(tenantId, demandInput, null, { async: true });
    await expect(service.runGenerationJob(tenantId, demandInput, null)).rejects.toMatchObject({
      statusCode: 429,
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(service.runGenerationJob(tenantId, demandInput, null)).resolves.toBeTruthy();
  });
});
