/**
 * Grade Service
 *
 * Manages education grade CRUD operations within a tenant.
 * Grades represent education levels (e.g., Grade 1, Grade 2, etc.)
 *
 * @requirements 5.5
 */
import { NotFoundError, ConflictError } from '@proctira/common';
import type { PrismaClient, Grade } from '@proctira/database';

import type { CreateGradeDto, UpdateGradeDto } from './grade-schemas.js';

export interface GradeServiceDeps {
  prisma: PrismaClient;
}

export class GradeService {
  private readonly prisma: PrismaClient;

  constructor(deps: GradeServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Create a new education grade for a tenant.
   */
  async create(tenantId: string, dto: CreateGradeDto): Promise<Grade> {
    // Check unique code within tenant
    const existing = await this.prisma.grade.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });

    if (existing) {
      throw new ConflictError(`Grade with code '${dto.code}' already exists`);
    }

    return this.prisma.grade.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        order: dto.order,
      },
    });
  }

  /**
   * Update an existing grade.
   */
  async update(tenantId: string, id: string, dto: UpdateGradeDto): Promise<Grade> {
    const grade = await this.prisma.grade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!grade) {
      throw new NotFoundError(`Grade '${id}' not found`);
    }

    // Check unique code if changing
    if (dto.code && dto.code !== grade.code) {
      const existing = await this.prisma.grade.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictError(`Grade with code '${dto.code}' already exists`);
      }
    }

    return this.prisma.grade.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  /**
   * Get a grade by ID.
   */
  async getById(tenantId: string, id: string): Promise<Grade> {
    const grade = await this.prisma.grade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!grade) {
      throw new NotFoundError(`Grade '${id}' not found`);
    }

    return grade;
  }

  /**
   * List all grades for a tenant, ordered by the `order` field.
   */
  async list(tenantId: string): Promise<Grade[]> {
    return this.prisma.grade.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Soft-delete a grade.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const grade = await this.prisma.grade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!grade) {
      throw new NotFoundError(`Grade '${id}' not found`);
    }

    await this.prisma.grade.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
