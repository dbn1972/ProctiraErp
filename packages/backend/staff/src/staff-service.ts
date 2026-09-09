/**
 * Staff Service
 *
 * Business logic for staff CRUD operations.
 * Handles validation, uniqueness enforcement, and custom fields.
 *
 * Requirements:
 * - 7.1: Manage staff records including personal information, qualifications, employment history, position
 * - 7.6: Support custom fields via JSONB custom_data column
 * - 7.7: Validate required fields (name, DOB, identity number, contact, position); unique identity number
 */
import { ConflictError, NotFoundError, EntityStatus } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { CreateStaffInput, UpdateStaffInput } from './schemas.js';
import type { StaffEntity, StaffFilter, StaffRepository } from './staff-repository.js';

/**
 * Service handling staff business logic.
 */
export class StaffService {
  constructor(private readonly repository: StaffRepository) {}

  /**
   * Create a new staff record.
   *
   * Validates:
   * - Identity number is globally unique across all staff records
   *
   * @throws ConflictError if identity number already exists
   */
  async create(tenantId: string, input: CreateStaffInput): Promise<StaffEntity> {
    // Check global uniqueness of identity number
    const existingByIdentity = await this.repository.findByIdentityNumber(input.identityNumber);
    if (existingByIdentity) {
      throw new ConflictError(
        `Staff with identity number '${input.identityNumber}' already exists`,
      );
    }

    const staff: Omit<StaffEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      identityNumber: input.identityNumber,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail ?? null,
      position: input.position,
      status: EntityStatus.ACTIVE,
      customData: input.customData ?? null,
    };

    return this.repository.create(staff);
  }

  /**
   * Update an existing staff record.
   *
   * Validates:
   * - Staff exists and belongs to the tenant
   * - If identity number is changed, new identity number is globally unique
   *
   * @throws NotFoundError if staff not found
   * @throws ConflictError if identity number uniqueness violated
   */
  async update(tenantId: string, id: string, input: UpdateStaffInput): Promise<StaffEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }

    // Check identity number uniqueness if being changed
    if (input.identityNumber && input.identityNumber !== existing.identityNumber) {
      const existingByIdentity = await this.repository.findByIdentityNumber(input.identityNumber);
      if (existingByIdentity) {
        throw new ConflictError(
          `Staff with identity number '${input.identityNumber}' already exists`,
        );
      }
    }

    const updateData: Partial<StaffEntity> = {};
    if (input.firstName !== undefined) updateData.firstName = input.firstName;
    if (input.lastName !== undefined) updateData.lastName = input.lastName;
    if (input.dateOfBirth !== undefined) updateData.dateOfBirth = input.dateOfBirth;
    if (input.identityNumber !== undefined) updateData.identityNumber = input.identityNumber;
    if (input.contactPhone !== undefined) updateData.contactPhone = input.contactPhone;
    if (input.contactEmail !== undefined) updateData.contactEmail = input.contactEmail;
    if (input.position !== undefined) updateData.position = input.position;
    if (input.customData !== undefined) updateData.customData = input.customData;

    const updated = await this.repository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single staff record by ID.
   *
   * @throws NotFoundError if staff not found
   */
  async getById(tenantId: string, id: string): Promise<StaffEntity> {
    const staff = await this.repository.findById(id, tenantId);
    if (!staff) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }
    return staff;
  }

  /**
   * List staff with pagination and filtering.
   * Supports full-text search on staff name and identity number.
   */
  async list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  /**
   * Delete a staff record.
   *
   * @throws NotFoundError if staff not found
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }
  }
}
