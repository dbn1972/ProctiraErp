/**
 * Unit tests for GradeService with mocked Prisma.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GradeService } from './grade-service.js';
import { ConflictError, NotFoundError } from '@proctira/common';

function createMockPrisma() {
  return {
    grade: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

const TENANT_ID = 'tenant-001';

describe('GradeService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: GradeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new GradeService({ prisma });
  });

  describe('create', () => {
    it('should create a grade successfully', async () => {
      prisma.grade.findUnique.mockResolvedValue(null);
      const created = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.grade.create.mockResolvedValue(created);

      const result = await service.create(TENANT_ID, { name: 'Grade 1', code: 'G1', order: 1 });

      expect(result).toEqual(created);
      expect(prisma.grade.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT_ID, name: 'Grade 1', code: 'G1', order: 1 },
      });
    });

    it('should throw ConflictError if code already exists', async () => {
      prisma.grade.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(TENANT_ID, { name: 'Grade 1', code: 'G1', order: 1 }),
      ).rejects.toThrow(ConflictError);
    });

    // PRC-M280: grade `order` drives rollover promotion and must be unique per
    // tenant. A duplicate order collapses two grades into one rollover slot.
    it('should throw ConflictError if order already exists (PRC-M280)', async () => {
      prisma.grade.findUnique.mockResolvedValue(null); // code is free
      prisma.grade.findFirst.mockResolvedValue({ id: 'order-holder', order: 1 });

      await expect(
        service.create(TENANT_ID, { name: 'Grade 1', code: 'G1', order: 1 }),
      ).rejects.toThrow(ConflictError);
      expect(prisma.grade.create).not.toHaveBeenCalled();
    });

    it('should scope the order-uniqueness check to live rows in the tenant (PRC-M280)', async () => {
      prisma.grade.findUnique.mockResolvedValue(null);
      prisma.grade.findFirst.mockResolvedValue(null); // no live clash
      prisma.grade.create.mockResolvedValue({ id: 'g', order: 3 });

      await service.create(TENANT_ID, { name: 'Grade 3', code: 'G3', order: 3 });

      expect(prisma.grade.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, order: 3, deletedAt: null },
      });
    });
  });

  describe('update', () => {
    it('should update a grade successfully', async () => {
      const existing = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.grade.findFirst.mockResolvedValue(existing);
      prisma.grade.findUnique.mockResolvedValue(null);
      const updated = { ...existing, name: 'Grade One' };
      prisma.grade.update.mockResolvedValue(updated);

      const result = await service.update(TENANT_ID, 'grade-1', { name: 'Grade One' });

      expect(result.name).toBe('Grade One');
    });

    it('should throw NotFoundError if grade does not exist', async () => {
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(service.update(TENANT_ID, 'nonexistent', { name: 'X' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError if new code already exists', async () => {
      const existing = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        deletedAt: null,
      };
      prisma.grade.findFirst.mockResolvedValue(existing);
      prisma.grade.findUnique.mockResolvedValue({ id: 'other-grade' });

      await expect(service.update(TENANT_ID, 'grade-1', { code: 'G2' })).rejects.toThrow(
        ConflictError,
      );
    });

    // PRC-M280: order uniqueness is enforced on update too, excluding the row
    // being changed.
    it('should throw ConflictError if the new order collides with another grade (PRC-M280)', async () => {
      const existing = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        deletedAt: null,
      };
      // 1st findFirst = grade lookup; 2nd findFirst = order-clash check.
      prisma.grade.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: 'grade-2', order: 2 });

      await expect(service.update(TENANT_ID, 'grade-1', { order: 2 })).rejects.toThrow(
        ConflictError,
      );
      expect(prisma.grade.findFirst).toHaveBeenLastCalledWith({
        where: { tenantId: TENANT_ID, order: 2, deletedAt: null, NOT: { id: 'grade-1' } },
      });
      expect(prisma.grade.update).not.toHaveBeenCalled();
    });

    it('should not run the order-uniqueness check when order is unchanged (PRC-M280)', async () => {
      const existing = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        deletedAt: null,
      };
      prisma.grade.findFirst.mockResolvedValue(existing);
      prisma.grade.update.mockResolvedValue({ ...existing, name: 'Grade One' });

      await service.update(TENANT_ID, 'grade-1', { name: 'Grade One', order: 1 });

      // Only the initial grade lookup — no second findFirst for the clash check.
      expect(prisma.grade.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.grade.update).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return a grade by ID', async () => {
      const grade = {
        id: 'grade-1',
        tenantId: TENANT_ID,
        name: 'Grade 1',
        code: 'G1',
        order: 1,
        deletedAt: null,
      };
      prisma.grade.findFirst.mockResolvedValue(grade);

      const result = await service.getById(TENANT_ID, 'grade-1');
      expect(result).toEqual(grade);
    });

    it('should throw NotFoundError if grade not found', async () => {
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(service.getById(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return all grades ordered by order field', async () => {
      const grades = [
        { id: 'g1', name: 'Grade 1', order: 1 },
        { id: 'g2', name: 'Grade 2', order: 2 },
      ];
      prisma.grade.findMany.mockResolvedValue(grades);

      const result = await service.list(TENANT_ID);
      expect(result).toEqual(grades);
      expect(prisma.grade.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
        orderBy: { order: 'asc' },
      });
    });
  });

  describe('delete', () => {
    it('should soft-delete a grade', async () => {
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1', deletedAt: null });
      prisma.grade.update.mockResolvedValue({});

      await service.delete(TENANT_ID, 'grade-1');

      expect(prisma.grade.update).toHaveBeenCalledWith({
        where: { id: 'grade-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundError if grade not found', async () => {
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(service.delete(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
