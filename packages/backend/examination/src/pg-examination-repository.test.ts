/**
 * G-812 — Examination repository smoke.
 *
 * Live Prisma path is gated by G812_LIVE=1 (see institution suite).
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createExaminationRepository,
  isPgExaminationEnabled,
} from './repository-factory.js';

const live = isPgExaminationEnabled() && process.env['G812_LIVE'] === '1';

describe('ExaminationRepository (G-812)', () => {
  const savedUrl = process.env['DATABASE_URL'];

  afterEach(() => {
    if (savedUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = savedUrl;
  });

  it('uses in-memory repository when DATABASE_URL is unset', async () => {
    delete process.env['DATABASE_URL'];
    expect(isPgExaminationEnabled()).toBe(false);
    const repo = createExaminationRepository();
    const tenantId = randomUUID();
    const id = randomUUID();
    await repo.create({
      id,
      tenantId,
      name: 'Memory Exam',
      code: `MEM-${id.slice(0, 6)}`,
      description: null,
      academicPeriodId: randomUUID(),
      startDate: '2026-09-01',
      endDate: '2026-09-15',
      status: 'DRAFT',
      subjects: [],
      centers: [],
      sessions: [],
      gradingSchemes: [],
    });
    expect(await repo.findById(id, tenantId)).not.toBeNull();
    expect(await repo.findById(id, randomUUID())).toBeNull();
  });

  it.skipIf(!live)(
    'live Postgres: create → read within tenant → cross-tenant deny',
    async () => {
      const repo = createExaminationRepository();
      const tenantId = randomUUID();
      const id = randomUUID();
      await repo.create({
        id,
        tenantId,
        name: 'Live Exam',
        code: `LIVE-${id.slice(0, 6)}`,
        description: null,
        academicPeriodId: randomUUID(),
        startDate: '2026-09-01',
        endDate: '2026-09-15',
        status: 'DRAFT',
        subjects: [],
        centers: [],
        sessions: [],
        gradingSchemes: [],
      });
      expect(await repo.findById(id, tenantId)).not.toBeNull();
      expect(await repo.findById(id, randomUUID())).toBeNull();
    },
  );
});
