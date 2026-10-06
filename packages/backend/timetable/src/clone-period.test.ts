/**
 * PRC-M397: clone-period remaps bell periods, clears publishedAt, validates,
 * writes atomically, resumes, and audits.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
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
});
