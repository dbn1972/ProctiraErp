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
  AcademicPeriodKindType,
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

    const kind: AcademicPeriodKindType = dto.kind ?? 'year';
    const parentId = await this.resolveParent(tenantId, kind, dto.parentId ?? null, {
      startDate,
      endDate,
    });

    return this.prisma.academicPeriod.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        startDate,
        endDate,
        status: dto.status ?? 'active',
        kind,
        parentId,
      },
    });
  }

  /**
   * G-905 — a `year` has no parent; every other kind must nest under a `year`
   * of the same tenant and fall inside its date range.
   */
  private async resolveParent(
    tenantId: string,
    kind: AcademicPeriodKindType,
    parentId: string | null,
    range: { startDate: Date; endDate: Date },
    selfId?: string,
  ): Promise<string | null> {
    if (kind === 'year') {
      if (parentId) {
        throw new ValidationError('An academic year cannot have a parent period', [
          { field: 'parentId', rule: 'noParentForYear', message: 'Years are top-level periods' },
        ]);
      }
      return null;
    }
    if (!parentId) {
      throw new ValidationError(`A ${kind} must belong to an academic year`, [
        { field: 'parentId', rule: 'required', message: 'parentId is required for sub-periods' },
      ]);
    }
    if (selfId && parentId === selfId) {
      throw new ValidationError('A period cannot be its own parent', [
        { field: 'parentId', rule: 'selfReference', message: 'parentId must differ from id' },
      ]);
    }
    const parent = await this.prisma.academicPeriod.findFirst({
      where: { id: parentId, tenantId, deletedAt: null },
    });
    if (!parent) {
      throw new NotFoundError(`Parent academic period '${parentId}' not found`);
    }
    const parentKind = (parent as { kind?: string }).kind ?? 'year';
    if (parentKind !== 'year') {
      throw new BusinessRuleError('Sub-periods can only nest under an academic year');
    }
    if (range.startDate < parent.startDate || range.endDate > parent.endDate) {
      throw new ValidationError('Sub-period must fall inside its academic year', [
        {
          field: 'startDate',
          rule: 'withinParent',
          message: `Must fall between ${parent.startDate.toISOString().slice(0, 10)} and ${parent.endDate
            .toISOString()
            .slice(0, 10)}`,
        },
      ]);
    }
    return parentId;
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

    const currentKind = ((period as { kind?: string }).kind ?? 'year') as AcademicPeriodKindType;
    const currentParent = (period as { parentId?: string | null }).parentId ?? null;
    const kind = dto.kind ?? currentKind;
    const hierarchyTouched =
      dto.kind !== undefined ||
      dto.parentId !== undefined ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined;
    // Promoting a term to a year is fine; demoting a year that still owns
    // terms would orphan them — check before parent validation so the caller
    // sees the real reason rather than "parentId is required".
    if (kind !== 'year' && currentKind === 'year') {
      const children = await this.prisma.academicPeriod.count({
        where: { tenantId, parentId: id, deletedAt: null },
      });
      if (children > 0) {
        throw new BusinessRuleError(
          `Cannot change an academic year with ${children} sub-period(s) into a ${kind}`,
        );
      }
    }
    let parentId = currentParent;
    if (hierarchyTouched) {
      parentId = await this.resolveParent(
        tenantId,
        kind,
        dto.parentId !== undefined ? dto.parentId : currentParent,
        { startDate, endDate },
        id,
      );
    }

    return this.prisma.academicPeriod.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.startDate !== undefined && { startDate }),
        ...(dto.endDate !== undefined && { endDate }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(hierarchyTouched && { kind, parentId }),
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
  async list(
    tenantId: string,
    options?: { status?: string; parentId?: string; kind?: string },
  ): Promise<AcademicPeriod[]> {
    return this.prisma.academicPeriod.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(options?.status && { status: options.status }),
        ...(options?.kind && { kind: options.kind }),
        ...(options?.parentId && { parentId: options.parentId }),
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

    const children = await this.prisma.academicPeriod.count({
      where: { tenantId, parentId: id, deletedAt: null },
    });
    if (children > 0) {
      throw new BusinessRuleError(
        `Cannot delete an academic year that still has ${children} sub-period(s)`,
      );
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
