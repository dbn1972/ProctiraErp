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
  it('subject codes group demands but are never persisted as meeting subject ids (#554)', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'GEN',
      dayPattern: '1,2,3,4,5',
      status: 'active',
    });
    await service.createPeriod(tenantId, {
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const job = await service.runGenerationJob(
      tenantId,
      {
        ...demandInput,
        bellScheduleId: schedule.id,
        persistMeetings: true,
        demands: [{ ...demandInput.demands[0]!, subjectId: 'math', periodsPerWeek: 2 }],
      },
      null,
    );
    expect(job.status).toBe('done');
    expect(job.assignedCount).toBe(2);
    const meetings = await service.listMeetings(tenantId, { institutionId });
    expect(meetings).toHaveLength(2);
    expect(meetings.every((m) => m.subjectId === null)).toBe(true);
  });

  /**
   * PRC-M550(c): executeGenerationJob's `this.repo.listRooms(...)` call had no status filter,
   * so an inactive room was as eligible as an active one — ListRoomsFilter did not even have a
   * `status` field to pass. Seed one active + one inactive room with equal capacity; across
   * repeated generation runs the inactive room's id must never be chosen.
   */
  it('never assigns an inactive room (PRC-M550c)', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'M550C',
      dayPattern: '1,2,3,4,5',
      status: 'active',
    });
    await service.createPeriod(tenantId, {
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const activeRoom = await service.createRoom(tenantId, {
      institutionId,
      code: 'ACTIVE-1',
      name: 'Active Room',
      capacity: 30,
      roomType: 'CLASSROOM',
      status: 'active',
    });
    await service.createRoom(tenantId, {
      institutionId,
      code: 'INACTIVE-1',
      name: 'Inactive Room',
      capacity: 30,
      roomType: 'CLASSROOM',
      status: 'inactive',
    });
    for (let i = 0; i < 5; i += 1) {
      const job = await service.runGenerationJob(
        tenantId,
        {
          institutionId,
          academicPeriodId,
          bellScheduleId: schedule.id,
          demands: [
            {
              ...demandInput.demands[0]!,
              sectionId: crypto.randomUUID(),
              enrollmentCount: 20,
              periodsPerWeek: 1,
            },
          ],
        },
        null,
      );
      expect(job.status).toBe('done');
      const assignedRoomIds = ((job.result as { assignments?: Array<{ roomId: string | null }> })
        .assignments ?? []).map((a) => a.roomId);
      expect(assignedRoomIds.every((id) => id === null || id === activeRoom.id)).toBe(true);
    }
  });

  /**
   * PRC-L374 part 2: generateTimetable's `remaining.set(demand.id, ...)` silently collapsed two
   * input demands sharing the same client-supplied id (last one wins), undercounting assigned
   * periods with no error. Two demands sharing one id must fail the job with a message
   * mentioning the duplicate, matching this file's "validation failures keep their message"
   * convention (ValidationError -> failed job record, not a thrown rejection).
   */
  it('rejects duplicate demand ids with a failed job (PRC-L374 part 2)', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const job = await service.runGenerationJob(
      tenantId,
      {
        ...demandInput,
        demands: [
          { ...demandInput.demands[0]!, id: 'dup-1' },
          { ...demandInput.demands[0]!, id: 'dup-1', sectionId: crypto.randomUUID() },
        ],
      },
      null,
    );
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toMatch(/duplicate/i);
  });

  /**
   * PRC-L503: persistMeetings: true drives createMeeting, which (since PRC-M396(b)) calls
   * repo.createMeetingAtomic instead of a separate pre-check + insert. Spy on
   * createMeetingAtomic (standing in for the live-PG atomic path, no live infra needed here)
   * to assert persistMeetings actually reaches it once per assignment and persisted/assignedCount
   * agree.
   */
  it('persistMeetings drives repo.createMeetingAtomic once per assignment (mocked atomic path)', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'L503',
      dayPattern: '1,2,3,4,5',
      status: 'active',
    });
    await service.createPeriod(tenantId, {
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    let atomicCalls = 0;
    const originalAtomic = repo.createMeetingAtomic.bind(repo);
    repo.createMeetingAtomic = async (t, candidate, clashCheck) => {
      atomicCalls += 1;
      return originalAtomic(t, candidate, clashCheck);
    };
    const job = await service.runGenerationJob(
      tenantId,
      {
        institutionId,
        academicPeriodId,
        bellScheduleId: schedule.id,
        persistMeetings: true,
        demands: [{ ...demandInput.demands[0]!, periodsPerWeek: 1 }],
      },
      null,
    );
    expect(job.status).toBe('done');
    expect(job.assignedCount).toBe(1);
    expect(atomicCalls).toBe(1);
    expect((job.stats as { persisted?: number }).persisted).toBe(1);
  });
});
