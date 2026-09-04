import { describe, expect, it, vi } from 'vitest';

import { PrismaEnrollmentRepository } from './prisma-enrollment-repository.js';

vi.mock('@proctira/database', () => ({
  withTenantTransaction: async (_prisma: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      enrollment: {
        create: vi.fn().mockResolvedValue({
          id: 'enr-1',
          tenantId: 'tenant-1',
          studentId: 'stu-1',
          institutionId: 'sch-1',
          gradeId: 'g-1',
          classId: 'c-1',
          academicPeriodId: 'p-1',
          status: 'ENROLLED',
          enrolledAt: new Date('2026-04-01'),
          exitedAt: null,
          createdAt: new Date('2026-04-01'),
          updatedAt: new Date('2026-04-01'),
        }),
      },
      institution: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sch-1', status: 'ACTIVE' }),
      },
    }),
}));

describe('PrismaEnrollmentRepository', () => {
  it('creates an enrollment and looks up the institution', async () => {
    const repo = new PrismaEnrollmentRepository({} as never);
    const created = await repo.createEnrollment({
      id: 'enr-1',
      tenantId: 'tenant-1',
      studentId: 'stu-1',
      institutionId: 'sch-1',
      gradeId: 'g-1',
      classId: 'c-1',
      academicPeriodId: 'p-1',
      status: 'ENROLLED',
      enrolledAt: new Date('2026-04-01'),
      exitedAt: null,
    });
    expect(created.status).toBe('ENROLLED');
    expect(created.classId).toBe('c-1');

    const institution = await repo.findInstitutionById('sch-1', 'tenant-1');
    expect(institution).toEqual({ id: 'sch-1', status: 'ACTIVE' });
  });
});
