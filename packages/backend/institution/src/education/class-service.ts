/**
 * Class Service
 *
 * Manages class CRUD operations within an institution.
 * Enforces that each class is assigned to exactly one grade (class-to-grade assignment).
 *
 * @requirements 5.5
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PrismaClient, Class } from '@proctira/database';

import type { CreateClassDto, UpdateClassDto } from './class-schemas.js';

export interface ClassServiceDeps {
  prisma: PrismaClient;
}

export class ClassService {
  private readonly prisma: PrismaClient;

  constructor(deps: ClassServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Create a new class for an institution.
   * Validates that the grade and academic period exist within the tenant.
   */
  async create(tenantId: string, dto: CreateClassDto): Promise<Class> {
    // Validate grade exists
    const grade = await this.prisma.grade.findFirst({
      where: { id: dto.gradeId, tenantId, deletedAt: null },
    });
    if (!grade) {
      throw new NotFoundError(`Grade '${dto.gradeId}' not found`);
    }

    // Validate academic period exists
    const period = await this.prisma.academicPeriod.findFirst({
      where: { id: dto.academicPeriodId, tenantId, deletedAt: null },
    });
    if (!period) {
      throw new NotFoundError(`Academic period '${dto.academicPeriodId}' not found`);
    }

    // Validate institution exists
    const institution = await this.prisma.institution.findFirst({
      where: { id: dto.institutionId, tenantId },
    });
    if (!institution) {
      throw new NotFoundError(`Institution '${dto.institutionId}' not found`);
    }

    return this.prisma.class.create({
      data: {
        tenantId,
        institutionId: dto.institutionId,
        gradeId: dto.gradeId,
        academicPeriodId: dto.academicPeriodId,
        name: dto.name,
        capacity: dto.capacity ?? null,
      },
    });
  }

  /**
   * Update an existing class.
   * If gradeId is provided, enforces that the new grade exists.
   * A class can only be assigned to one grade at a time.
   */
  async update(tenantId: string, id: string, dto: UpdateClassDto): Promise<Class> {
    const cls = await this.prisma.class.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!cls) {
      throw new NotFoundError(`Class '${id}' not found`);
    }

    // If changing grade, validate the new grade exists
    if (dto.gradeId && dto.gradeId !== cls.gradeId) {
      const grade = await this.prisma.grade.findFirst({
        where: { id: dto.gradeId, tenantId, deletedAt: null },
      });
      if (!grade) {
        throw new NotFoundError(`Grade '${dto.gradeId}' not found`);
      }
    }

    return this.prisma.class.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.gradeId !== undefined && { gradeId: dto.gradeId }),
      },
    });
  }

  /**
   * Get a class by ID.
   */
  async getById(tenantId: string, id: string): Promise<Class> {
    const cls = await this.prisma.class.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!cls) {
      throw new NotFoundError(`Class '${id}' not found`);
    }

    return cls;
  }

  /**
   * List classes for an institution, optionally filtered by academic period and/or grade.
   */
  async list(
    tenantId: string,
    institutionId: string,
    options?: { academicPeriodId?: string; gradeId?: string },
  ): Promise<Class[]> {
    return this.prisma.class.findMany({
      where: {
        tenantId,
        institutionId,
        deletedAt: null,
        ...(options?.academicPeriodId && { academicPeriodId: options.academicPeriodId }),
        ...(options?.gradeId && { gradeId: options.gradeId }),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Soft-delete a class.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const cls = await this.prisma.class.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!cls) {
      throw new NotFoundError(`Class '${id}' not found`);
    }

    await this.prisma.class.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
