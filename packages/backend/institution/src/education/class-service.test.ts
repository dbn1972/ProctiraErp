/**
 * Unit tests for ClassService with mocked Prisma.
 * Validates class-to-grade enforcement (one grade per class).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClassService } from './class-service.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { createInMemoryAcademicsPrisma } from './in-memory-prisma-lite.js';

function createMockPrisma() {
  return {
    grade: {
      findFirst: vi.fn(),
    },
    academicPeriod: {
      findFirst: vi.fn(),
    },
    institution: {
      findFirst: vi.fn(),
    },
    staff: {
      findFirst: vi.fn(),
    },
    class: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    enrollment: {
      count: vi.fn(),
    },
  } as any;
}

const TENANT_ID = 'tenant-001';

describe('ClassService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ClassService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ClassService({ prisma });
  });

  describe('create', () => {
    it('should create a class with valid grade, period, and institution', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.academicPeriod.findFirst.mockResolvedValue({ id: 'period-1' });
      prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1' });

      const created = {
        id: 'class-1',
        tenantId: TENANT_ID,
        institutionId: 'inst-1',
        gradeId: 'grade-1',
        academicPeriodId: 'period-1',
        name: 'Class A',
        capacity: 30,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.class.create.mockResolvedValue(created);

      const result = await service.create(TENANT_ID, {
        institutionId: 'inst-1',
        gradeId: 'grade-1',
        academicPeriodId: 'period-1',
        name: 'Class A',
        capacity: 30,
      });

      expect(result).toEqual(created);
      expect(prisma.class.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: 'Class A',
            capacity: 30,
            classTeacherStaffId: null,
            roomName: null,
          }),
        }),
      );
    });

    it('should throw NotFoundError if grade does not exist', async () => {
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, {
          institutionId: 'inst-1',
          gradeId: 'nonexistent',
          academicPeriodId: 'period-1',
          name: 'Class A',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if academic period does not exist', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.academicPeriod.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, {
          institutionId: 'inst-1',
          gradeId: 'grade-1',
          academicPeriodId: 'nonexistent',
          name: 'Class A',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if institution does not exist', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.academicPeriod.findFirst.mockResolvedValue({ id: 'period-1' });
      prisma.institution.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_ID, {
          institutionId: 'nonexistent',
          gradeId: 'grade-1',
          academicPeriodId: 'period-1',
          name: 'Class A',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    // PRC-M285: duplicate (institution, grade, period, name) must be rejected.
    it('should throw ConflictError when a class with the same name already exists for the grade/period', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.academicPeriod.findFirst.mockResolvedValue({ id: 'period-1' });
      prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1' });
      prisma.class.findFirst.mockResolvedValue({
        id: 'class-existing',
        tenantId: TENANT_ID,
        institutionId: 'inst-1',
        gradeId: 'grade-1',
        academicPeriodId: 'period-1',
        name: 'Class A',
        deletedAt: null,
      });

      await expect(
        service.create(TENANT_ID, {
          institutionId: 'inst-1',
          gradeId: 'grade-1',
          academicPeriodId: 'period-1',
          name: 'Class A',
        }),
      ).rejects.toThrow(ConflictError);
      expect(prisma.class.create).not.toHaveBeenCalled();
    });

    it('should set capacity to null when not provided', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.academicPeriod.findFirst.mockResolvedValue({ id: 'period-1' });
      prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1' });
      prisma.class.create.mockResolvedValue({ id: 'class-1', capacity: null });

      await service.create(TENANT_ID, {
        institutionId: 'inst-1',
        gradeId: 'grade-1',
        academicPeriodId: 'period-1',
        name: 'Class B',
      });

      expect(prisma.class.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ capacity: null }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should update class name', async () => {
      const existing = {
        id: 'class-1',
        tenantId: TENANT_ID,
        gradeId: 'grade-1',
        deletedAt: null,
      };
      prisma.class.findFirst.mockResolvedValue(existing);
      prisma.class.update.mockResolvedValue({ ...existing, name: 'Class B' });

      const result = await service.update(TENANT_ID, 'class-1', { name: 'Class B' });
      expect(result.name).toBe('Class B');
    });

    it('should validate new grade exists when changing grade', async () => {
      const existing = {
        id: 'class-1',
        tenantId: TENANT_ID,
        gradeId: 'grade-1',
        deletedAt: null,
      };
      prisma.class.findFirst.mockResolvedValue(existing);
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(
        service.update(TENANT_ID, 'class-1', { gradeId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should allow changing grade to a valid grade (one grade per class)', async () => {
      const existing = {
        id: 'class-1',
        tenantId: TENANT_ID,
        gradeId: 'grade-1',
        deletedAt: null,
      };
      prisma.class.findFirst.mockResolvedValue(existing);
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-2' });
      prisma.class.update.mockResolvedValue({ ...existing, gradeId: 'grade-2' });

      const result = await service.update(TENANT_ID, 'class-1', { gradeId: 'grade-2' });
      expect(result.gradeId).toBe('grade-2');
    });

    it('should throw NotFoundError if class does not exist', async () => {
      prisma.class.findFirst.mockResolvedValue(null);

      await expect(service.update(TENANT_ID, 'nonexistent', { name: 'X' })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('getById', () => {
    it('should return a class by ID', async () => {
      const cls = { id: 'class-1', tenantId: TENANT_ID, deletedAt: null };
      prisma.class.findFirst.mockResolvedValue(cls);

      const result = await service.getById(TENANT_ID, 'class-1');
      expect(result).toEqual(cls);
    });

    it('should throw NotFoundError if class not found', async () => {
      prisma.class.findFirst.mockResolvedValue(null);

      await expect(service.getById(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should list classes for an institution', async () => {
      const classes = [{ id: 'c1' }, { id: 'c2' }];
      prisma.class.findMany.mockResolvedValue(classes);

      const result = await service.list(TENANT_ID, 'inst-1');
      expect(result).toEqual(classes);
    });

    it('should filter by academic period and grade', async () => {
      prisma.class.findMany.mockResolvedValue([]);

      await service.list(TENANT_ID, 'inst-1', {
        academicPeriodId: 'period-1',
        gradeId: 'grade-1',
      });

      expect(prisma.class.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          institutionId: 'inst-1',
          deletedAt: null,
          academicPeriodId: 'period-1',
          gradeId: 'grade-1',
        },
        include: {
          classTeacher: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('update assignment', () => {
    it('rejects a class teacher from another tenant', async () => {
      prisma.class.findFirst.mockResolvedValue({
        id: 'class-1',
        tenantId: TENANT_ID,
        gradeId: 'grade-1',
        deletedAt: null,
      });
      prisma.staff.findFirst.mockResolvedValue(null);

      await expect(
        service.update(TENANT_ID, 'class-1', { classTeacherStaffId: 'staff-other' }),
      ).rejects.toThrow(NotFoundError);
      expect(prisma.class.update).not.toHaveBeenCalled();
    });
  });

  describe('requireStaff crash guard (PRC-L476)', () => {
    it('resolves with NotFoundError (not a crash) when staff is not seeded', async () => {
      const institutionId = 'inst-shim-1';
      const institutionRepository = {
        findById: vi.fn(async (id: string) =>
          id === institutionId
            ? ({ id, tenantId: TENANT_ID, status: 'ACTIVE', deletedAt: null } as any)
            : null,
        ),
      } as any;
      const shimPrisma = createInMemoryAcademicsPrisma({ institutionRepository });
      const grade = await shimPrisma.grade.create({
        data: { tenantId: TENANT_ID, name: 'G1', code: 'G1', order: 1 },
      });
      const period = await shimPrisma.academicPeriod.create({
        data: {
          tenantId: TENANT_ID,
          name: 'AY',
          code: 'AY',
          startDate: new Date(),
          endDate: new Date(),
        },
      });
      const shimService = new ClassService({ prisma: shimPrisma });

      await expect(
        shimService.create(TENANT_ID, {
          institutionId,
          gradeId: grade.id,
          academicPeriodId: period.id,
          name: 'Class A',
          classTeacherStaffId: 'staff-not-seeded',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should soft-delete a class', async () => {
      prisma.class.findFirst.mockResolvedValue({ id: 'class-1', deletedAt: null });
      prisma.enrollment.count.mockResolvedValue(0);
      prisma.class.update.mockResolvedValue({});

      await service.delete(TENANT_ID, 'class-1');

      expect(prisma.class.update).toHaveBeenCalledWith({
        where: { id: 'class-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundError if class not found', async () => {
      prisma.class.findFirst.mockResolvedValue(null);

      await expect(service.delete(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });

    // PRC-M284: deleting a class with ENROLLED students must be rejected.
    it('should throw BusinessRuleError if the class has enrolled students (PRC-M284)', async () => {
      prisma.class.findFirst.mockResolvedValue({ id: 'class-1', deletedAt: null });
      prisma.enrollment.count.mockResolvedValue(4);

      await expect(service.delete(TENANT_ID, 'class-1')).rejects.toThrow(BusinessRuleError);
      expect(prisma.class.update).not.toHaveBeenCalled();
    });
  });
});
