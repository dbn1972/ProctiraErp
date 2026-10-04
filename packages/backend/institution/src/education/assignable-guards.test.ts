/**
 * PRC-L123 — class/subject creation must reject inactive or soft-deleted
 * institutions and archived academic periods.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClassService } from './class-service.js';
import { SubjectService } from './subject-service.js';

const TENANT = 'tenant-001';

function mockPrisma() {
  return {
    grade: { findFirst: vi.fn().mockResolvedValue({ id: 'grade-1', name: 'G1' }) },
    academicPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'period-1', status: 'active' }),
    },
    institution: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    subject: { findFirst: vi.fn().mockResolvedValue({ id: 'subj-1', name: 'Math' }) },
    institutionSubject: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    class: { create: vi.fn().mockResolvedValue({ id: 'class-1' }) },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const classDto = {
  institutionId: 'inst-1',
  gradeId: 'grade-1',
  academicPeriodId: 'period-1',
  name: 'Class A',
};

describe('PRC-L123 assignable institution / period guards', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  beforeEach(() => {
    prisma = mockPrisma();
  });

  it('rejects class creation for an INACTIVE institution', async () => {
    prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1', status: 'INACTIVE' });
    await expect(new ClassService({ prisma }).create(TENANT, classDto)).rejects.toThrow(
      BusinessRuleError,
    );
    expect(prisma.class.create).not.toHaveBeenCalled();
  });

  it('treats a soft-deleted institution as not found', async () => {
    prisma.institution.findFirst.mockResolvedValue({
      id: 'inst-1',
      status: 'ACTIVE',
      deletedAt: new Date(),
    });
    await expect(new ClassService({ prisma }).create(TENANT, classDto)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('filters soft-deleted institutions in the lookup', async () => {
    prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1', status: 'active' });
    await new ClassService({ prisma }).create(TENANT, classDto);
    expect(prisma.institution.findFirst).toHaveBeenCalledWith({
      where: { id: 'inst-1', tenantId: TENANT, deletedAt: null },
    });
    expect(prisma.class.create).toHaveBeenCalled();
  });

  it('rejects class creation in an archived academic period', async () => {
    prisma.academicPeriod.findFirst.mockResolvedValue({ id: 'period-1', status: 'archived' });
    prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1', status: 'ACTIVE' });
    await expect(new ClassService({ prisma }).create(TENANT, classDto)).rejects.toThrow(/archived/);
    expect(prisma.class.create).not.toHaveBeenCalled();
  });

  it('rejects subject-to-grade links for an INACTIVE institution', async () => {
    prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1', status: 'inactive' });
    await expect(
      new SubjectService({ prisma }).linkToGrade(TENANT, {
        institutionId: 'inst-1',
        subjectId: 'subj-1',
        gradeId: 'grade-1',
      }),
    ).rejects.toThrow(BusinessRuleError);
    expect(prisma.institutionSubject.create).not.toHaveBeenCalled();
  });
});
