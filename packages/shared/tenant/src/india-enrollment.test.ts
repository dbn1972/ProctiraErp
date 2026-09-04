import { describe, expect, it, vi } from 'vitest';

import {
  INDIA_DEMO_STUDENT_FIRST_NAME,
  INDIA_DEMO_STUDENT_NATIONAL_ID,
  seedIndiaDemoEnrollment,
  type IndiaEnrollmentStore,
} from './india-enrollment.js';

function createStore(): IndiaEnrollmentStore {
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-india' }) },
    institution: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'school-1',
        name: 'Kendriya Vidyalaya Proctira',
        code: 'KV-DEL-001',
      }),
    },
    academicPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'period-1', code: 'AY-2026-27' }),
    },
    class: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'class-1a',
        name: 'Class 1 A',
        gradeId: 'grade-1',
      }),
    },
    student: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'stu-1',
        firstName: INDIA_DEMO_STUDENT_FIRST_NAME,
        lastName: 'Sharma',
        nationalId: INDIA_DEMO_STUDENT_NATIONAL_ID,
      }),
    },
    enrollment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'enr-1',
        studentId: 'stu-1',
        institutionId: 'school-1',
        classId: 'class-1a',
        status: 'ENROLLED',
      }),
    },
    enrollmentHistory: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'hist-1' }),
    },
  };
}

describe('seedIndiaDemoEnrollment', () => {
  it('admits Aarav Sharma into Class 1 A and records history', async () => {
    const db = createStore();
    const result = await seedIndiaDemoEnrollment(db);

    expect(result.student.nationalId).toBe(INDIA_DEMO_STUDENT_NATIONAL_ID);
    expect(result.enrollment.status).toBe('ENROLLED');
    expect(result.enrollment.classId).toBe('class-1a');
    expect(db.student.create).toHaveBeenCalled();
    expect(db.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classId: 'class-1a',
          gradeId: 'grade-1',
          status: 'ENROLLED',
        }),
      }),
    );
    expect(db.enrollmentHistory.create).toHaveBeenCalled();
  });

  it('fails when the demo school was not seeded', async () => {
    const db = createStore();
    db.institution.findFirst = vi.fn().mockResolvedValue(null);
    await expect(seedIndiaDemoEnrollment(db)).rejects.toThrow(/demo school is missing/);
  });

  it('is idempotent when the student is already enrolled', async () => {
    const db = createStore();
    db.student.findFirst = vi.fn().mockResolvedValue({
      id: 'stu-1',
      firstName: INDIA_DEMO_STUDENT_FIRST_NAME,
      lastName: 'Sharma',
      nationalId: INDIA_DEMO_STUDENT_NATIONAL_ID,
    });
    db.enrollment.findFirst = vi.fn().mockResolvedValue({
      id: 'enr-1',
      studentId: 'stu-1',
      institutionId: 'school-1',
      classId: 'class-1a',
      status: 'ENROLLED',
    });
    db.enrollmentHistory.findFirst = vi.fn().mockResolvedValue({ id: 'hist-1' });

    const result = await seedIndiaDemoEnrollment(db);
    expect(result.enrollment.id).toBe('enr-1');
    expect(db.student.create).not.toHaveBeenCalled();
    expect(db.enrollment.create).not.toHaveBeenCalled();
    expect(db.enrollmentHistory.create).not.toHaveBeenCalled();
  });
});
