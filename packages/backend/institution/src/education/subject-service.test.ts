/**
 * Unit tests for SubjectService with mocked Prisma.
 * Validates subject CRUD and subject-to-grade linking via InstitutionSubject.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubjectService } from './subject-service.js';
import { ConflictError, NotFoundError } from '@proctira/common';

function createMockPrisma() {
  return {
    subject: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    grade: {
      findFirst: vi.fn(),
    },
    institution: {
      findFirst: vi.fn(),
    },
    institutionSubject: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  } as any;
}

const TENANT_ID = 'tenant-001';

describe('SubjectService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: SubjectService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SubjectService({ prisma });
  });

  describe('create', () => {
    it('should create a subject successfully', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);
      const created = {
        id: 'subj-1',
        tenantId: TENANT_ID,
        name: 'Mathematics',
        code: 'MATH',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.subject.create.mockResolvedValue(created);

      const result = await service.create(TENANT_ID, { name: 'Mathematics', code: 'MATH' });
      expect(result).toEqual(created);
    });

    it('should throw ConflictError if code already exists', async () => {
      prisma.subject.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(TENANT_ID, { name: 'Math', code: 'MATH' })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe('update', () => {
    it('should update a subject successfully', async () => {
      const existing = {
        id: 'subj-1',
        tenantId: TENANT_ID,
        name: 'Mathematics',
        code: 'MATH',
        deletedAt: null,
      };
      prisma.subject.findFirst.mockResolvedValue(existing);
      prisma.subject.findUnique.mockResolvedValue(null);
      prisma.subject.update.mockResolvedValue({ ...existing, name: 'Maths' });

      const result = await service.update(TENANT_ID, 'subj-1', { name: 'Maths' });
      expect(result.name).toBe('Maths');
    });

    it('should throw NotFoundError if subject not found', async () => {
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(service.update(TENANT_ID, 'nonexistent', { name: 'X' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError if new code already exists', async () => {
      const existing = { id: 'subj-1', code: 'MATH', deletedAt: null };
      prisma.subject.findFirst.mockResolvedValue(existing);
      prisma.subject.findUnique.mockResolvedValue({ id: 'other' });

      await expect(service.update(TENANT_ID, 'subj-1', { code: 'SCI' })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe('getById', () => {
    it('should return a subject by ID', async () => {
      const subject = { id: 'subj-1', tenantId: TENANT_ID, deletedAt: null };
      prisma.subject.findFirst.mockResolvedValue(subject);

      const result = await service.getById(TENANT_ID, 'subj-1');
      expect(result).toEqual(subject);
    });

    it('should throw NotFoundError if subject not found', async () => {
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(service.getById(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return all subjects ordered by name', async () => {
      const subjects = [
        { id: 's1', name: 'Art' },
        { id: 's2', name: 'Math' },
      ];
      prisma.subject.findMany.mockResolvedValue(subjects);

      const result = await service.list(TENANT_ID);
      expect(result).toEqual(subjects);
    });
  });

  describe('delete', () => {
    it('should soft-delete a subject', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 'subj-1', deletedAt: null });
      prisma.subject.update.mockResolvedValue({});

      await service.delete(TENANT_ID, 'subj-1');

      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 'subj-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundError if subject not found', async () => {
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(service.delete(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('linkToGrade', () => {
    it('should link a subject to a grade within an institution', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 'subj-1', name: 'Math' });
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1', name: 'Grade 1' });
      prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1' });
      prisma.institutionSubject.findUnique.mockResolvedValue(null);

      const link = {
        id: 'link-1',
        tenantId: TENANT_ID,
        institutionId: 'inst-1',
        subjectId: 'subj-1',
        gradeId: 'grade-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.institutionSubject.create.mockResolvedValue(link);

      const result = await service.linkToGrade(TENANT_ID, {
        institutionId: 'inst-1',
        subjectId: 'subj-1',
        gradeId: 'grade-1',
      });

      expect(result).toEqual(link);
    });

    it('should throw NotFoundError if subject does not exist', async () => {
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(
        service.linkToGrade(TENANT_ID, {
          institutionId: 'inst-1',
          subjectId: 'nonexistent',
          gradeId: 'grade-1',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if grade does not exist', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 'subj-1' });
      prisma.grade.findFirst.mockResolvedValue(null);

      await expect(
        service.linkToGrade(TENANT_ID, {
          institutionId: 'inst-1',
          subjectId: 'subj-1',
          gradeId: 'nonexistent',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if institution does not exist', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 'subj-1' });
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      prisma.institution.findFirst.mockResolvedValue(null);

      await expect(
        service.linkToGrade(TENANT_ID, {
          institutionId: 'nonexistent',
          subjectId: 'subj-1',
          gradeId: 'grade-1',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError if link already exists', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 'subj-1', name: 'Math' });
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-1', name: 'Grade 1' });
      prisma.institution.findFirst.mockResolvedValue({ id: 'inst-1' });
      prisma.institutionSubject.findUnique.mockResolvedValue({ id: 'existing-link' });

      await expect(
        service.linkToGrade(TENANT_ID, {
          institutionId: 'inst-1',
          subjectId: 'subj-1',
          gradeId: 'grade-1',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('unlinkFromGrade', () => {
    it('should remove a subject-grade link', async () => {
      prisma.institutionSubject.findFirst.mockResolvedValue({ id: 'link-1' });
      prisma.institutionSubject.delete.mockResolvedValue({});

      await service.unlinkFromGrade(TENANT_ID, 'link-1');

      expect(prisma.institutionSubject.delete).toHaveBeenCalledWith({
        where: { id: 'link-1' },
      });
    });

    it('should throw NotFoundError if link not found', async () => {
      prisma.institutionSubject.findFirst.mockResolvedValue(null);

      await expect(service.unlinkFromGrade(TENANT_ID, 'nonexistent')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('listInstitutionSubjects', () => {
    it('should list all subject-grade links for an institution', async () => {
      const links = [{ id: 'link-1' }, { id: 'link-2' }];
      prisma.institutionSubject.findMany.mockResolvedValue(links);

      const result = await service.listInstitutionSubjects(TENANT_ID, 'inst-1');
      expect(result).toEqual(links);
    });

    it('should filter by gradeId', async () => {
      prisma.institutionSubject.findMany.mockResolvedValue([]);

      await service.listInstitutionSubjects(TENANT_ID, 'inst-1', { gradeId: 'grade-1' });

      expect(prisma.institutionSubject.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          institutionId: 'inst-1',
          gradeId: 'grade-1',
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
