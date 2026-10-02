/**
 * PRC-L104 — exam date rules use tenant-timezone calendar dates and the
 * 7-day future rule applies only to date values that change on update.
 */
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@proctira/common';
import { ExaminationService, calendarDateInZone } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import type { CreateExaminationInput } from './schemas.js';

const TENANT = 'tenant-l104';

function input(startDate: string, endDate: string): CreateExaminationInput {
  return {
    name: 'Board Exam',
    code: `EXAM-${Math.random().toString(36).slice(2, 8)}`,
    academicPeriodId: '11111111-1111-4111-8111-111111111111',
    startDate,
    endDate,
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [
      {
        name: 'Center A',
        code: 'CTR-A',
        institutionId: '22222222-2222-4222-8222-222222222222',
        capacity: 100,
      },
    ],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39.99 },
        ],
      },
    ],
  };
}

describe('exam date rules (PRC-L104)', () => {
  it('updating endDate of an exam starting in 3 days succeeds', async () => {
    let now = new Date('2026-01-01T06:00:00Z');
    const svc = new ExaminationService(new InMemoryExaminationRepository(), undefined, {
      timeZone: 'UTC',
      now: () => now,
    });
    const exam = await svc.create(TENANT, input('2026-01-10', '2026-01-12'));
    now = new Date('2026-01-07T06:00:00Z'); // start date now 3 days away
    const updated = await svc.update(TENANT, exam.id, {
      startDate: '2026-01-10', // unchanged value echoed by the client
      endDate: '2026-01-15',
    });
    expect(updated.endDate).toBe('2026-01-15');
  });

  it('still rejects moving a date into the 7-day window', async () => {
    let now = new Date('2026-01-01T06:00:00Z');
    const svc = new ExaminationService(new InMemoryExaminationRepository(), undefined, {
      now: () => now,
    });
    const exam = await svc.create(TENANT, input('2026-01-20', '2026-01-22'));
    now = new Date('2026-01-07T06:00:00Z');
    await expect(svc.update(TENANT, exam.id, { startDate: '2026-01-09' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('boundary at tenant midnight uses the tenant calendar date', async () => {
    // 19:00 UTC on Jan 1 is 00:30 on Jan 2 in Asia/Kolkata.
    const now = () => new Date('2026-01-01T19:00:00Z');
    expect(calendarDateInZone(now(), 'Asia/Kolkata')).toBe('2026-01-02');
    const ist = new ExaminationService(new InMemoryExaminationRepository(), undefined, {
      timeZone: () => 'Asia/Kolkata',
      now,
    });
    const utc = new ExaminationService(new InMemoryExaminationRepository(), undefined, {
      timeZone: 'UTC',
      now,
    });
    // min date: IST 2026-01-09, UTC 2026-01-08
    await expect(ist.create(TENANT, input('2026-01-08', '2026-01-10'))).rejects.toThrow(
      ValidationError,
    );
    await expect(ist.create(TENANT, input('2026-01-09', '2026-01-10'))).resolves.toBeDefined();
    await expect(utc.create(TENANT, input('2026-01-08', '2026-01-10'))).resolves.toBeDefined();
  });
});
