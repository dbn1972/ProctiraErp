import { describe, expect, it } from 'vitest';

import { CurriculumService } from './service.js';
import { InMemoryCurriculumStore } from './store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const GRADE = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

describe('CurriculumService coverage', () => {
  it('creates a lesson plan, marks taught, and reports coverage percent', async () => {
    const service = new CurriculumService(new InMemoryCurriculumStore());
    const u1 = await service.createUnit(TENANT, {
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
      code: 'U1',
      name: 'Number systems',
      sequence: 1,
    });
    await service.createUnit(TENANT, {
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
      code: 'U2',
      name: 'Algebra',
      sequence: 2,
    });
    const plan = await service.createLessonPlan(TENANT, u1.id, {
      title: 'Place value',
      objectives: 'Read and write numbers to 1000',
      plannedDate: '2026-06-01',
    });
    expect(plan.unitId).toBe(u1.id);

    let coverage = await service.coverage(TENANT, {
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
    });
    expect(coverage).toMatchObject({ planned: 2, taught: 0, percent: 0 });

    await service.markTaught(TENANT, u1.id, {}, 'teacher-1');
    coverage = await service.coverage(TENANT, {
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
    });
    expect(coverage).toMatchObject({ planned: 2, taught: 1, percent: 50 });
  });

  it('isolates units across tenants', async () => {
    const service = new CurriculumService(new InMemoryCurriculumStore());
    await service.createUnit(TENANT, {
      subjectId: SUBJECT,
      gradeId: GRADE,
      academicPeriodId: PERIOD,
      code: 'U1',
      name: 'Hidden',
    });
    const foreign = await service.listUnits(TENANT_B, { subjectId: SUBJECT });
    expect(foreign).toEqual([]);
  });
});
