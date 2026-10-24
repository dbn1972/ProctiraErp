/**
 * PRC-M397: clone-period remaps bell periods, clears publishedAt, validates,
 * writes atomically, resumes, and audits.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import type { SectionEntity, SectionMeetingEntity } from './timetable-repository.js';
import { TimetableService } from './timetable-service.js';

const T = randomUUID();
const INST = randomUUID();
const SRC = randomUUID();
const DST = randomUUID();
const now = new Date().toISOString();

async function seed(opts: { targetSchedule?: boolean } = {}) {
  const repo = new InMemoryTimetableRepository();
  const schedule = async (academicPeriodId: string) => {
    const s = await repo.createBellSchedule({
      id: randomUUID(),
      tenantId: T,
      institutionId: INST,
      academicPeriodId,
      code: 'MAIN',
      name: 'Main',
      dayPattern: '1,2,3,4,5',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const periods = [];
    for (const order of [1, 2]) {
      periods.push(
        await repo.createPeriod({
          id: randomUUID(),
          tenantId: T,
          bellScheduleId: s.id,
          name: `P${order}`,
          periodOrder: order,
          startTime: `0${7 + order}:00`,
          endTime: `0${7 + order}:45`,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return periods;
  };
  const srcPeriods = await schedule(SRC);
  const dstPeriods = opts.targetSchedule === false ? [] : await schedule(DST);
  const section: SectionEntity = {
    id: randomUUID(),
    tenantId: T,
    institutionId: INST,
    academicPeriodId: SRC,
    gradeId: null,
    code: '10-A',
    name: '10 A',
    primaryTeacherId: null,
    defaultRoomId: null,
    capacity: 30,
    status: 'PUBLISHED' as SectionEntity['status'],
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await repo.createSection(section);
  const meeting = (periodId: string, day: number): SectionMeetingEntity => ({
    id: randomUUID(),
    tenantId: T,
    institutionId: INST,
    academicPeriodId: SRC,
    sectionId: section.id,
    subjectId: null,
    staffId: randomUUID(),
    periodId,
    roomId: null,
    dayOfWeek: day,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  await repo.createMeeting(meeting(srcPeriods[0]!.id, 1));
  await repo.createMeeting(meeting(srcPeriods[1]!.id, 2));
  return { repo, service: new TimetableService(repo), dstPeriods };
}

describe('cloneForAcademicPeriod (PRC-M397)', () => {
  it('maps meetings onto the target bell schedule and clears publishedAt', async () => {
    const { repo, service, dstPeriods } = await seed();
    const result = await service.cloneForAcademicPeriod(T, SRC, DST, { actorId: 'u1' });
    expect(result).toEqual({ sectionsCloned: 1, meetingsCloned: 2 });
    const [cloned] = await repo.listSections(T, { academicPeriodId: DST });
    expect(cloned).toMatchObject({ status: 'DRAFT', publishedAt: null });
    const meetings = await repo.listMeetings(T, { sectionId: cloned!.id });
    const dstIds = new Set(dstPeriods.map((p) => p.id));
    expect(meetings).toHaveLength(2);
    expect(meetings.every((m) => dstIds.has(m.periodId))).toBe(true);
    expect(service.listAudits(T).some((a) => a.action === 'timetable.clone_period')).toBe(true);
  });

  it('no target bell schedule -> fails closed with zero rows written', async () => {
    const { repo, service } = await seed({ targetSchedule: false });
    await expect(service.cloneForAcademicPeriod(T, SRC, DST)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await repo.listSections(T, { academicPeriodId: DST })).toHaveLength(0);
  });

  it('forced failure mid-clone leaves zero rows', async () => {
    const { repo, service } = await seed();
    let n = 0;
    const createMeeting = repo.createMeeting.bind(repo);
    repo.createMeeting = async (row) => {
      n += 1;
      if (n === 2) throw new Error('insert failed');
      return createMeeting(row);
    };
    await expect(service.cloneForAcademicPeriod(T, SRC, DST)).rejects.toThrow('insert failed');
    expect(await repo.listSections(T, { academicPeriodId: DST })).toHaveLength(0);
    expect(await repo.listMeetings(T, { academicPeriodId: DST })).toHaveLength(0);
  });

  it('resume: existing target section without meetings receives them; rerun is a no-op', async () => {
    const { repo, service } = await seed();
    await repo.createSection({
      id: randomUUID(),
      tenantId: T,
      institutionId: INST,
      academicPeriodId: DST,
      gradeId: null,
      code: '10-A',
      name: '10 A',
      primaryTeacherId: null,
      defaultRoomId: null,
      capacity: 30,
      status: 'DRAFT' as SectionEntity['status'],
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(await service.cloneForAcademicPeriod(T, SRC, DST)).toEqual({
      sectionsCloned: 0,
      meetingsCloned: 2,
    });
    expect(await service.cloneForAcademicPeriod(T, SRC, DST)).toEqual({
      sectionsCloned: 0,
      meetingsCloned: 0,
    });
  });

  /**
   * PRC-M549: cloneForAcademicPeriod filtered listSections/listMeetings only by
   * academicPeriodId, with no institutionId at all, so any institution's sections sharing an
   * academicPeriodId cloned together. A caller scoped to institution A (options.institutionId)
   * must never see institution B's sections/meetings in the clone result, even though both
   * share the same source/target academicPeriodId. This is a tenancy/authorization finding, so
   * failing-first proof is required: before threading institutionId through, this test fails
   * because institution B's section clones alongside institution A's.
   */
  it('institutionId option scopes the clone to one institution only (PRC-M549)', async () => {
    const { repo, service, dstPeriods } = await seed();
    const institutionB = randomUUID();
    // Seed a second institution's bell schedule + section + meeting sharing the same
    // source/target academicPeriodId as the institution-A fixture from seed().
    const schedule = async (academicPeriodId: string) => {
      const s = await repo.createBellSchedule({
        id: randomUUID(),
        tenantId: T,
        institutionId: institutionB,
        academicPeriodId,
        code: 'MAIN',
        name: 'Main',
        dayPattern: '1,2,3,4,5',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
      return repo.createPeriod({
        id: randomUUID(),
        tenantId: T,
        bellScheduleId: s.id,
        name: 'P1',
        periodOrder: 1,
        startTime: '07:00',
        endTime: '07:45',
        createdAt: now,
        updatedAt: now,
      });
    };
    const bSrcPeriod = await schedule(SRC);
    await schedule(DST);
    const sectionB: SectionEntity = {
      id: randomUUID(),
      tenantId: T,
      institutionId: institutionB,
      academicPeriodId: SRC,
      gradeId: null,
      code: 'B-10-A',
      name: 'B 10 A',
      primaryTeacherId: null,
      defaultRoomId: null,
      capacity: 30,
      status: 'PUBLISHED' as SectionEntity['status'],
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await repo.createSection(sectionB);
    await repo.createMeeting({
      id: randomUUID(),
      tenantId: T,
      institutionId: institutionB,
      academicPeriodId: SRC,
      sectionId: sectionB.id,
      subjectId: null,
      staffId: randomUUID(),
      periodId: bSrcPeriod.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.cloneForAcademicPeriod(T, SRC, DST, { institutionId: INST });
    expect(result).toEqual({ sectionsCloned: 1, meetingsCloned: 2 });
    const targetSections = await repo.listSections(T, { academicPeriodId: DST });
    expect(targetSections.every((s) => s.institutionId === INST)).toBe(true);
    expect(targetSections.some((s) => s.institutionId === institutionB)).toBe(false);
    const targetMeetings = await repo.listMeetings(T, { academicPeriodId: DST });
    expect(targetMeetings.every((m) => m.institutionId === INST)).toBe(true);
    void dstPeriods;
  });

  /**
   * PRC-L503: HTTP-level coverage for POST /timetable/clone-period — the role check (student
   * -> 403, already covered by read-access.test.ts) plus the institution-scope check from
   * PRC-M549 (missing/mismatched institutionId -> 400).
   */
  describe('POST /timetable/clone-period (HTTP)', () => {
    async function buildApp(role: string) {
      const { repo, service } = await seed();
      const app = Fastify({ logger: false });
      app.addHook('onRequest', async (request) => {
        (request as FastifyRequest & { tenantId?: string }).tenantId = T;
        (
          request as FastifyRequest & {
            user: { id: string; roles: string[]; tenantId?: string };
          }
        ).user = { id: 'u', roles: [role], tenantId: T };
      });
      await app.register(timetablePlugin, { repository: repo, service, prefix: '/timetable' });
      return app;
    }

    it('rejects a non-scheduler role with 403', async () => {
      const app = await buildApp('student');
      const res = await app.inject({
        method: 'POST',
        url: '/timetable/clone-period',
        payload: { sourcePeriodId: SRC, targetPeriodId: DST, institutionId: INST },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('rejects a missing institutionId with 400', async () => {
      const app = await buildApp('admin');
      const res = await app.inject({
        method: 'POST',
        url: '/timetable/clone-period',
        payload: { sourcePeriodId: SRC, targetPeriodId: DST },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('scopes the clone to institutionId and returns 201', async () => {
      const app = await buildApp('admin');
      const res = await app.inject({
        method: 'POST',
        url: '/timetable/clone-period',
        payload: { sourcePeriodId: SRC, targetPeriodId: DST, institutionId: INST },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ sectionsCloned: 1, meetingsCloned: 2 });
      await app.close();
    });
  });
});
