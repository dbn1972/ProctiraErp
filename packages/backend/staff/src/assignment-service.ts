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

import type {
  StaffAssignmentEntity,
  StaffAssignmentFilter,
  StaffAssignmentRepository,
} from './assignment-repository.js';
import type { CreateAssignmentInput, UpdateAssignmentInput } from './assignment-schemas.js';

/**
 * Service handling staff assignment business logic.
 */
export class StaffAssignmentService {
  constructor(private readonly repository: StaffAssignmentRepository) {}

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

    // Check total allocation constraint
    const activeAssignments = await this.repository.findActiveByStaffId(input.staffId, tenantId);
    const currentTotal = activeAssignments.reduce((sum, a) => sum + a.allocationPercentage, 0);

    if (currentTotal + input.allocationPercentage > 100) {
      throw new BusinessRuleError(
        `Total allocation would exceed 100%. Current allocation: ${currentTotal}%, requested: ${input.allocationPercentage}%, total would be: ${currentTotal + input.allocationPercentage}%`,
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

    return this.repository.create(assignment);
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

    // Check allocation constraint if allocation changes
    if (input.allocationPercentage !== undefined) {
      const newStatus = input.status ?? existing.status;
      // Only check allocation if the assignment will be active
      if (newStatus === 'ACTIVE') {
        const activeAssignments = await this.repository.findActiveByStaffId(
          existing.staffId,
          tenantId,
        );
        const currentTotal = activeAssignments
          .filter((a) => a.id !== id) // Exclude current assignment
          .reduce((sum, a) => sum + a.allocationPercentage, 0);

        if (currentTotal + input.allocationPercentage > 100) {
          throw new BusinessRuleError(
            `Total allocation would exceed 100%. Current allocation (excluding this assignment): ${currentTotal}%, requested: ${input.allocationPercentage}%, total would be: ${currentTotal + input.allocationPercentage}%`,
          );
        }
      }
    }

    const updateData: Partial<StaffAssignmentEntity> = {};
    if (input.role !== undefined) updateData.role = input.role;
    if (input.allocationPercentage !== undefined)
      updateData.allocationPercentage = input.allocationPercentage;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.status !== undefined) updateData.status = input.status as 'ACTIVE' | 'INACTIVE';

    const updated = await this.repository.update(id, tenantId, updateData);
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
  async getTotalAllocation(tenantId: string, staffId: string): Promise<number> {
    const activeAssignments = await this.repository.findActiveByStaffId(staffId, tenantId);
    return activeAssignments.reduce((sum, a) => sum + a.allocationPercentage, 0);
  }
}
