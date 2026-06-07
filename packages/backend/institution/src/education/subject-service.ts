/**
 * Subject Service
 *
 * Manages subject CRUD and subject-to-grade linking via InstitutionSubject.
 * Each subject is linked to at least one grade within an institution.
 *
 * @requirements 5.5
 */
import { NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';
import type { PrismaClient, Subject, InstitutionSubject } from '@proctira/database';

import type {
  CreateSubjectDto,
  UpdateSubjectDto,
  LinkSubjectToGradeDto,
} from './subject-schemas.js';

export interface SubjectServiceDeps {
  prisma: PrismaClient;
}

export class SubjectService {
  private readonly prisma: PrismaClient;

  constructor(deps: SubjectServiceDeps) {
    this.prisma = deps.prisma;
  }

  // ─── Subject CRUD ────────────────────────────────────────────────────────────

  /**
   * Create a new subject for a tenant.
   */
  async create(tenantId: string, dto: CreateSubjectDto): Promise<Subject> {
    // Check unique code within tenant
    const existing = await this.prisma.subject.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });

    if (existing) {
      throw new ConflictError(`Subject with code '${dto.code}' already exists`);
    }

    return this.prisma.subject.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
      },
    });
  }

  /**
   * Update an existing subject.
   */
  async update(tenantId: string, id: string, dto: UpdateSubjectDto): Promise<Subject> {
    const subject = await this.prisma.subject.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subject) {
      throw new NotFoundError(`Subject '${id}' not found`);
    }

    // Check unique code if changing
    if (dto.code && dto.code !== subject.code) {
      const existing = await this.prisma.subject.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictError(`Subject with code '${dto.code}' already exists`);
      }
    }

    return this.prisma.subject.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
      },
    });
  }

  /**
   * Get a subject by ID.
   */
  async getById(tenantId: string, id: string): Promise<Subject> {
    const subject = await this.prisma.subject.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subject) {
      throw new NotFoundError(`Subject '${id}' not found`);
    }

    return subject;
  }

  /**
   * List all subjects for a tenant.
   */
  async list(tenantId: string): Promise<Subject[]> {
    return this.prisma.subject.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Soft-delete a subject.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const subject = await this.prisma.subject.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subject) {
      throw new NotFoundError(`Subject '${id}' not found`);
    }

    await this.prisma.subject.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── InstitutionSubject (Subject-to-Grade Linking) ───────────────────────────

  /**
   * Link a subject to a grade within an institution.
   * Enforces that the subject, grade, and institution all exist.
   */
  async linkToGrade(tenantId: string, dto: LinkSubjectToGradeDto): Promise<InstitutionSubject> {
    // Validate subject exists
    const subject = await this.prisma.subject.findFirst({
      where: { id: dto.subjectId, tenantId, deletedAt: null },
    });
    if (!subject) {
      throw new NotFoundError(`Subject '${dto.subjectId}' not found`);
    }

    // Validate grade exists
    const grade = await this.prisma.grade.findFirst({
      where: { id: dto.gradeId, tenantId, deletedAt: null },
    });
    if (!grade) {
      throw new NotFoundError(`Grade '${dto.gradeId}' not found`);
    }

    // Validate institution exists
    const institution = await this.prisma.institution.findFirst({
      where: { id: dto.institutionId, tenantId },
    });
    if (!institution) {
      throw new NotFoundError(`Institution '${dto.institutionId}' not found`);
    }

    // Check if link already exists
    const existing = await this.prisma.institutionSubject.findUnique({
      where: {
        tenantId_institutionId_subjectId_gradeId: {
          tenantId,
          institutionId: dto.institutionId,
          subjectId: dto.subjectId,
          gradeId: dto.gradeId,
        },
      },
    });

    if (existing) {
      throw new ConflictError(
        `Subject '${subject.name}' is already linked to grade '${grade.name}' in this institution`,
      );
    }

    return this.prisma.institutionSubject.create({
      data: {
        tenantId,
        institutionId: dto.institutionId,
        subjectId: dto.subjectId,
        gradeId: dto.gradeId,
      },
    });
  }

  /**
   * Remove a subject-to-grade link within an institution.
   */
  async unlinkFromGrade(tenantId: string, id: string): Promise<void> {
    const link = await this.prisma.institutionSubject.findFirst({
      where: { id, tenantId },
    });

    if (!link) {
      throw new NotFoundError(`Institution subject link '${id}' not found`);
    }

    await this.prisma.institutionSubject.delete({
      where: { id },
    });
  }

  /**
   * List all subject-to-grade links for an institution.
   */
  async listInstitutionSubjects(
    tenantId: string,
    institutionId: string,
    options?: { gradeId?: string },
  ): Promise<InstitutionSubject[]> {
    return this.prisma.institutionSubject.findMany({
      where: {
        tenantId,
        institutionId,
        ...(options?.gradeId && { gradeId: options.gradeId }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
