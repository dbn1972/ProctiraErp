/**
 * Academic Period Service
 *
 * Manages academic period CRUD with status lifecycle (active, inactive, archived).
 * Provides active period validation for enrollment/attendance/assessment operations.
 */
import { NotFoundError, ConflictError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { PrismaClient, AcademicPeriod } from '@proctira/database';

import type {
  CreateAcademicPeriodDto,
  UpdateAcademicPeriodDto,
  AcademicPeriodStatusType,
} from './academic-period-schemas.js';

export interface AcademicPeriodServiceDeps {
  prisma: PrismaClient;
}

export class AcademicPeriodService {
  private readonly prisma: PrismaClient;

  constructor(deps: AcademicPeriodServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Create a new academic period for a tenant.
   */
  async create(tenantId: string, dto: CreateAcademicPeriodDto): Promise<AcademicPeriod> {
    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new ValidationError('End date must be after start date', [
        { field: 'endDate', rule: 'dateRange', message: 'End date must be after start date' },
      ]);
    }

    // Check unique code within tenant
    const existing = await this.prisma.academicPeriod.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });

    if (existing) {
      throw new ConflictError(`Academic period with code '${dto.code}' already exists`);
    }

    return this.prisma.academicPeriod.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        startDate,
        endDate,
        status: dto.status ?? 'active',
      },
    });
  }

  /**
   * Update an existing academic period.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateAcademicPeriodDto,
  ): Promise<AcademicPeriod> {
    const period = await this.prisma.academicPeriod.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!period) {
      throw new NotFoundError(`Academic period '${id}' not found`);
    }

    // Cannot update archived periods
    if (period.status === 'archived') {
      throw new BusinessRuleError('Cannot update an archived academic period');
    }

    // Validate status transition
    if (dto.status) {
      this.validateStatusTransition(period.status as AcademicPeriodStatusType, dto.status);
    }

    // Validate dates if provided
    const startDate = dto.startDate ? new Date(dto.startDate) : period.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : period.endDate;

    if (endDate <= startDate) {
      throw new ValidationError('End date must be after start date', [
        { field: 'endDate', rule: 'dateRange', message: 'End date must be after start date' },
      ]);
    }

    // Check unique code if changing
    if (dto.code && dto.code !== period.code) {
      const existing = await this.prisma.academicPeriod.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictError(`Academic period with code '${dto.code}' already exists`);
      }
    }

    return this.prisma.academicPeriod.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.startDate !== undefined && { startDate }),
        ...(dto.endDate !== undefined && { endDate }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  /**
   * Get an academic period by ID.
   */
  async getById(tenantId: string, id: string): Promise<AcademicPeriod> {
    const period = await this.prisma.academicPeriod.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!period) {
      throw new NotFoundError(`Academic period '${id}' not found`);
    }

    return period;
  }

  /**
   * List academic periods for a tenant with optional status filter.
   */
  async list(tenantId: string, options?: { status?: string }): Promise<AcademicPeriod[]> {
    return this.prisma.academicPeriod.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(options?.status && { status: options.status }),
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Soft-delete an academic period.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const period = await this.prisma.academicPeriod.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!period) {
      throw new NotFoundError(`Academic period '${id}' not found`);
    }

    await this.prisma.academicPeriod.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validate that an academic period is active.
   * Used by enrollment, attendance, and assessment operations.
   *
   * @throws BusinessRuleError if the period is not active
   */
  async validateActivePeriod(tenantId: string, academicPeriodId: string): Promise<AcademicPeriod> {
    const period = await this.prisma.academicPeriod.findFirst({
      where: { id: academicPeriodId, tenantId, deletedAt: null },
    });

    if (!period) {
      throw new NotFoundError(`Academic period '${academicPeriodId}' not found`);
    }

    if (period.status !== 'active') {
      throw new BusinessRuleError(
        `The referenced academic period '${period.name}' is not currently active. ` +
          `Current status: ${period.status}. Only active periods allow enrollment, attendance, and assessment operations.`,
      );
    }

    return period;
  }

  /**
   * Validate status transitions.
   * Allowed transitions:
   * - active → inactive
   * - active → archived
   * - inactive → active
   * - inactive → archived
   * - archived → (none, terminal state)
   */
  private validateStatusTransition(
    current: AcademicPeriodStatusType,
    target: AcademicPeriodStatusType,
  ): void {
    if (current === target) return;

    const allowedTransitions: Record<AcademicPeriodStatusType, AcademicPeriodStatusType[]> = {
      active: ['inactive', 'archived'],
      inactive: ['active', 'archived'],
      archived: [], // terminal state
    };

    const allowed = allowedTransitions[current];
    if (!allowed || !allowed.includes(target)) {
      throw new BusinessRuleError(
        `Cannot transition academic period from '${current}' to '${target}'. ` +
          `Allowed transitions from '${current}': ${allowed?.join(', ') || 'none'}`,
      );
    }
  }
}
