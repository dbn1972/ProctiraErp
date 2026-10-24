/**
 * Grade Service
 *
 * Manages education grade CRUD operations within a tenant.
 * Grades represent education levels (e.g., Grade 1, Grade 2, etc.)
 *
 * @requirements 5.5
 */
import { NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';
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

    // PRC-M280: grade `order` drives rollover promotion, so it must be unique
    // within the tenant. A duplicate order collapses two grades into one slot
    // and sends students to an arbitrary grade on rollover. Reject up front.
    await this.requireUniqueOrder(tenantId, dto.order, null);

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
   * PRC-M280: enforce a unique grade `order` per tenant (excluding soft-deleted
   * rows and, on update, the row being changed). The DB also carries a partial
   * unique index (db/sql/200) as the authoritative guard; this gives a clean
   * 409 instead of a raw 23505.
   */
  private async requireUniqueOrder(
    tenantId: string,
    order: number,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await this.prisma.grade.findFirst({
      where: {
        tenantId,
        order,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictError(`Grade with order '${order}' already exists`);
    }
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

    // PRC-M280: keep grade order unique within the tenant on update too.
    if (dto.order !== undefined && dto.order !== grade.order) {
      await this.requireUniqueOrder(tenantId, dto.order, id);
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
   *
   * PRC-M284: a grade that still has live classes or enrolled students is
   * rejected — deleting it would otherwise silently orphan those rows.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const grade = await this.prisma.grade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!grade) {
      throw new NotFoundError(`Grade '${id}' not found`);
    }

    const [classCount, enrollmentCount] = await Promise.all([
      this.prisma.class.count({ where: { tenantId, gradeId: id, deletedAt: null } }),
      this.prisma.enrollment.count({ where: { tenantId, gradeId: id, status: 'ENROLLED' } }),
    ]);
    if (classCount > 0) {
      throw new BusinessRuleError(
        `Cannot delete grade '${id}': ${classCount} class(es) still reference it`,
      );
    }
    if (enrollmentCount > 0) {
      throw new BusinessRuleError(
        `Cannot delete grade '${id}': ${enrollmentCount} enrolled student(s) still reference it`,
      );
    }

    await this.prisma.grade.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
