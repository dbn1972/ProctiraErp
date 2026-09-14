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
import { isEffectiveOn, toUtcDateOnly } from './effective-dating.js';

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

    // First version of a code must not collide with an active (non-deleted) row.
    const existing = await this.prisma.academicPeriod.findFirst({
      where: { tenantId, code: dto.code, deletedAt: null },
    });

    if (existing) {
      throw new ConflictError(
        `Academic period with code '${dto.code}' already exists — supersede it instead of mutating dates`,
      );
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
        version: 1,
      } as never,
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
   * W1-DATA-07: start/end (effective) dates and code are immutable — use
   * {@link supersede} to append a non-overlapping successor version.
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

    if (dto.startDate !== undefined || dto.endDate !== undefined || dto.code !== undefined) {
      throw new BusinessRuleError(
        'Academic period dates and code are immutable; insert a non-overlapping successor via supersede',
      );
    }

    // Validate status transition
    if (dto.status) {
      this.validateStatusTransition(period.status as AcademicPeriodStatusType, dto.status);
    }

    const currentKind = ((period as { kind?: string }).kind ?? 'year') as AcademicPeriodKindType;
    const currentParent = (period as { parentId?: string | null }).parentId ?? null;
    const kind = dto.kind ?? currentKind;
    const hierarchyTouched = dto.kind !== undefined || dto.parentId !== undefined;
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
        { startDate: period.startDate, endDate: period.endDate },
        id,
      );
    }

    return this.prisma.academicPeriod.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(hierarchyTouched && { kind, parentId }),
      },
    });
  }

  /**
   * W1-DATA-07: append a successor version with a new effective window.
   * Prior version is archived (dates untouched). Windows must not overlap.
   */
  async supersede(
    tenantId: string,
    id: string,
    dto: CreateAcademicPeriodDto,
  ): Promise<AcademicPeriod> {
    const prior = await this.prisma.academicPeriod.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!prior) {
      throw new NotFoundError(`Academic period '${id}' not found`);
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new ValidationError('End date must be after start date', [
        { field: 'endDate', rule: 'dateRange', message: 'End date must be after start date' },
      ]);
    }

    const code = dto.code ?? prior.code;
    if (code !== prior.code) {
      throw new ValidationError('Successor must keep the same code (versioned append-only)', [
        { field: 'code', rule: 'sameCode', message: 'code must match the prior version' },
      ]);
    }

    if (isEffectiveOn(prior.startDate, prior.endDate, startDate) ||
        isEffectiveOn(prior.startDate, prior.endDate, endDate) ||
        isEffectiveOn(startDate, endDate, prior.startDate)) {
      throw new ConflictError(
        `Successor window overlaps prior version ${toUtcDateOnly(prior.startDate)}..${toUtcDateOnly(prior.endDate)}`,
      );
    }

    const kind: AcademicPeriodKindType =
      dto.kind ?? (((prior as { kind?: string }).kind ?? 'year') as AcademicPeriodKindType);
    const parentId = await this.resolveParent(
      tenantId,
      kind,
      dto.parentId !== undefined
        ? dto.parentId
        : ((prior as { parentId?: string | null }).parentId ?? null),
      { startDate, endDate },
    );

    const priorVersion = (prior as { version?: number }).version ?? 1;
    const next = await this.prisma.academicPeriod.create({
      data: {
        tenantId,
        name: dto.name,
        code,
        startDate,
        endDate,
        status: dto.status ?? 'active',
        kind,
        parentId,
        version: priorVersion + 1,
        supersedesId: prior.id,
      } as never,
    });

    if (prior.status !== 'archived') {
      await this.prisma.academicPeriod.update({
        where: { id: prior.id },
        data: { status: 'archived' },
      });
    }

    return next;
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
    options?: { status?: string; parentId?: string; kind?: string; asOf?: string },
  ): Promise<AcademicPeriod[]> {
    const asOf = options?.asOf ? toUtcDateOnly(options.asOf) : undefined;
    const asOfDate = asOf ? new Date(`${asOf}T00:00:00.000Z`) : undefined;
    return this.prisma.academicPeriod.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(options?.status && { status: options.status }),
        ...(options?.kind && { kind: options.kind }),
        ...(options?.parentId && { parentId: options.parentId }),
        ...(asOfDate && {
          startDate: { lte: asOfDate },
          endDate: { gte: asOfDate },
        }),
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
  async validateActivePeriod(
    tenantId: string,
    academicPeriodId: string,
    asOf: Date | string = new Date(),
  ): Promise<AcademicPeriod> {
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

    if (!isEffectiveOn(period.startDate, period.endDate, asOf)) {
      throw new BusinessRuleError(
        `The referenced academic period '${period.name}' is not effective on ${toUtcDateOnly(asOf)}. ` +
          `Valid window: ${toUtcDateOnly(period.startDate)} .. ${toUtcDateOnly(period.endDate)}.`,
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
