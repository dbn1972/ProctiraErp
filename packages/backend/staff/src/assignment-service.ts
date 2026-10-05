/**
 * Staff Assignment Service
 *
 * Business logic for staff assignment operations.
 *
 * Requirements:
 * - 7.2: Track staff assignments to institutions, subjects, and classes with start/end dates,
 *         preventing overlapping assignments to the same institution-subject-class combination
 * - 7.5: Track each assignment independently with role and time allocation as percentage,
 *         where total allocation across all active assignments shall not exceed 100%
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  AllocationExceededError,
  type StaffAssignmentEntity,
  type StaffAssignmentFilter,
  type StaffAssignmentRepository,
} from './assignment-repository.js';
import type { CreateAssignmentInput, UpdateAssignmentInput } from './assignment-schemas.js';
import { assertStaffInTenant, type StaffExistsCheck } from './staff-reference.js';

const ALLOCATION_GUARD = { maxTotalPercentage: 100 } as const;

/**
 * Service handling staff assignment business logic.
 */
export class StaffAssignmentService {
  constructor(
    private readonly repository: StaffAssignmentRepository,
    /** PRC-M374: tenant-scoped staff existence check. */
    private readonly staffExists?: StaffExistsCheck,
  ) {}

  /**
   * Create a new staff assignment.
   *
   * Validates:
   * - No overlapping assignment to the same institution-subject-class for the same staff
   * - Total allocation across all active assignments does not exceed 100%
   * - End date (if provided) is after start date
   *
   * @throws ConflictError if overlapping assignment exists
   * @throws BusinessRuleError if total allocation would exceed 100%
   * @throws BusinessRuleError if endDate is before startDate
   */
  async create(tenantId: string, input: CreateAssignmentInput): Promise<StaffAssignmentEntity> {
    await assertStaffInTenant(this.staffExists, tenantId, input.staffId);
    // Validate end date is after start date
    if (input.endDate && input.endDate <= input.startDate) {
      throw new BusinessRuleError('End date must be after start date');
    }

    // Check for overlapping assignments to the same institution-subject-class
    const overlapping = await this.repository.findOverlapping(
      tenantId,
      input.staffId,
      input.institutionId,
      input.subjectId,
      input.classId,
      input.startDate,
      input.endDate ?? null,
    );

    if (overlapping.length > 0) {
      throw new ConflictError(
        'Staff member already has an overlapping assignment to this institution-subject-class combination',
      );
    }

    const assignment: Omit<StaffAssignmentEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      institutionId: input.institutionId,
      subjectId: input.subjectId,
      classId: input.classId,
      role: input.role,
      allocationPercentage: input.allocationPercentage,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: 'ACTIVE',
    };

    // PRC-M375: cap is checked by the repository in the write transaction,
    // counting only assignments whose period overlaps this one.
    return this.withAllocationError(() => this.repository.create(assignment, ALLOCATION_GUARD));
  }

  /**
   * Update an existing staff assignment.
   *
   * Validates:
   * - Assignment exists and belongs to the tenant
   * - If dates change, no overlapping assignment exists
   * - If allocation changes, total does not exceed 100%
   * - End date (if provided) is after start date
   *
   * @throws NotFoundError if assignment not found
   * @throws ConflictError if overlapping assignment exists
   * @throws BusinessRuleError if total allocation would exceed 100%
   * @throws BusinessRuleError if endDate is before startDate
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateAssignmentInput,
  ): Promise<StaffAssignmentEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Assignment with id '${id}' not found`);
    }

    const newStartDate = input.startDate ?? existing.startDate;
    const newEndDate = input.endDate !== undefined ? input.endDate : existing.endDate;

    // Validate end date is after start date
    if (newEndDate && newEndDate <= newStartDate) {
      throw new BusinessRuleError('End date must be after start date');
    }

    // Check for overlapping assignments if dates changed
    if (input.startDate !== undefined || input.endDate !== undefined) {
      const overlapping = await this.repository.findOverlapping(
        tenantId,
        existing.staffId,
        existing.institutionId,
        existing.subjectId,
        existing.classId,
        newStartDate,
        newEndDate,
        id, // Exclude current assignment from overlap check
      );

      if (overlapping.length > 0) {
        throw new ConflictError(
          'Staff member already has an overlapping assignment to this institution-subject-class combination',
        );
      }
    }

    const updateData: Partial<StaffAssignmentEntity> = {};
    if (input.role !== undefined) updateData.role = input.role;
    if (input.allocationPercentage !== undefined)
      updateData.allocationPercentage = input.allocationPercentage;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.status !== undefined) updateData.status = input.status as 'ACTIVE' | 'INACTIVE';

    // PRC-M375: re-check on any change that can raise overlapping allocation,
    // including an INACTIVE -> ACTIVE re-activation.
    const affectsAllocation =
      input.allocationPercentage !== undefined ||
      input.startDate !== undefined ||
      input.endDate !== undefined ||
      (input.status === 'ACTIVE' && existing.status !== 'ACTIVE');
    const updated = await this.withAllocationError(() =>
      this.repository.update(
        id,
        tenantId,
        updateData,
        affectsAllocation ? ALLOCATION_GUARD : undefined,
      ),
    );
    if (!updated) {
      throw new NotFoundError(`Assignment with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single assignment by ID.
   *
   * @throws NotFoundError if assignment not found
   */
  async getById(tenantId: string, id: string): Promise<StaffAssignmentEntity> {
    const assignment = await this.repository.findById(id, tenantId);
    if (!assignment) {
      throw new NotFoundError(`Assignment with id '${id}' not found`);
    }
    return assignment;
  }

  /**
   * List assignments with pagination and filtering.
   */
  async list(
    tenantId: string,
    filter: StaffAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffAssignmentEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  /**
   * Delete an assignment.
   *
   * @throws NotFoundError if assignment not found
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Assignment with id '${id}' not found`);
    }
  }

  /**
   * Get total allocation percentage for a staff member across all active assignments.
   */
  private async withAllocationError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AllocationExceededError) throw new BusinessRuleError(error.message);
      throw error;
    }
  }

  async getTotalAllocation(tenantId: string, staffId: string): Promise<number> {
    const activeAssignments = await this.repository.findActiveByStaffId(staffId, tenantId);
    return activeAssignments.reduce((sum, a) => sum + a.allocationPercentage, 0);
  }
}
