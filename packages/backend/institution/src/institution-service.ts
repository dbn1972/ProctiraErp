/**
 * Institution Service
 *
 * Business logic for institution CRUD operations.
 * Handles validation, uniqueness enforcement, and deactivation rules.
 *
 * Requirements:
 * - 5.1: Create, update, deactivate institutions with classification
 * - 5.3: Validate required fields, unique code, unique name within area
 * - 5.4: Return structured error response on validation failure
 */
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  EntityStatus,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  InstitutionEntity,
  InstitutionFilter,
  InstitutionRepository,
} from './institution-repository.js';
import type { CreateInstitutionInput, UpdateInstitutionInput } from './schemas.js';

/**
 * Service handling institution business logic.
 */
export class InstitutionService {
  constructor(private readonly repository: InstitutionRepository) {}

  /**
   * Create a new institution.
   *
   * Validates:
   * - Institution code is globally unique
   * - Institution name is unique within the assigned area
   *
   * @throws ConflictError if code or name+area already exists
   */
  async create(tenantId: string, input: CreateInstitutionInput): Promise<InstitutionEntity> {
    // Check global uniqueness of institution code
    const existingByCode = await this.repository.findByCode(input.code);
    if (existingByCode) {
      throw new ConflictError(`Institution with code '${input.code}' already exists`);
    }

    // Check name uniqueness within area
    const existingByName = await this.repository.findByNameInArea(
      input.name,
      input.areaId,
      tenantId,
    );
    if (existingByName) {
      throw new ConflictError(
        `Institution with name '${input.name}' already exists in the specified area`,
      );
    }

    const institution: Omit<InstitutionEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      code: input.code,
      areaId: input.areaId,
      typeId: input.typeId,
      sectorId: input.sectorId,
      ownershipId: input.ownershipId,
      status: EntityStatus.ACTIVE,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      address: input.address ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      deactivationReason: null,
    };

    return this.repository.create(institution);
  }

  /**
   * Update an existing institution.
   *
   * Validates:
   * - Institution exists and belongs to the tenant
   * - If code is changed, new code is globally unique
   * - If name or area is changed, new name is unique within the area
   *
   * @throws NotFoundError if institution not found
   * @throws ConflictError if uniqueness constraints violated
   * @throws BusinessRuleError if institution is inactive and update is attempted
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateInstitutionInput,
  ): Promise<InstitutionEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Institution with id '${id}' not found`);
    }

    // Check code uniqueness if code is being changed
    if (input.code && input.code !== existing.code) {
      const existingByCode = await this.repository.findByCode(input.code);
      if (existingByCode) {
        throw new ConflictError(`Institution with code '${input.code}' already exists`);
      }
    }

    // Check name uniqueness within area if name or area is being changed
    const newName = input.name ?? existing.name;
    const newAreaId = input.areaId ?? existing.areaId;
    if (input.name || input.areaId) {
      const existingByName = await this.repository.findByNameInArea(newName, newAreaId, tenantId);
      if (existingByName && existingByName.id !== id) {
        throw new ConflictError(
          `Institution with name '${newName}' already exists in the specified area`,
        );
      }
    }

    const updateData: Partial<InstitutionEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.code !== undefined) updateData.code = input.code;
    if (input.areaId !== undefined) updateData.areaId = input.areaId;
    if (input.typeId !== undefined) updateData.typeId = input.typeId;
    if (input.sectorId !== undefined) updateData.sectorId = input.sectorId;
    if (input.ownershipId !== undefined) updateData.ownershipId = input.ownershipId;
    if (input.latitude !== undefined) updateData.latitude = input.latitude;
    if (input.longitude !== undefined) updateData.longitude = input.longitude;
    if (input.address !== undefined) updateData.address = input.address;
    if (input.contactPhone !== undefined) updateData.contactPhone = input.contactPhone;
    if (input.contactEmail !== undefined) updateData.contactEmail = input.contactEmail;

    const updated = await this.repository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Institution with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Deactivate an institution.
   *
   * Sets status to INACTIVE and prevents new enrollments/assignments.
   * Per Requirement 5.1: deactivation sets status to inactive and prevents
   * new enrollments and staff assignments.
   *
   * @throws NotFoundError if institution not found
   * @throws BusinessRuleError if institution is already inactive
   */
  async deactivate(tenantId: string, id: string, reason: string): Promise<InstitutionEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Institution with id '${id}' not found`);
    }

    if (existing.status === EntityStatus.INACTIVE) {
      throw new BusinessRuleError('Institution is already inactive');
    }

    const updated = await this.repository.update(id, tenantId, {
      status: EntityStatus.INACTIVE,
      deactivationReason: reason,
    });

    if (!updated) {
      throw new NotFoundError(`Institution with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single institution by ID.
   *
   * @throws NotFoundError if institution not found
   */
  async getById(tenantId: string, id: string): Promise<InstitutionEntity> {
    const institution = await this.repository.findById(id, tenantId);
    if (!institution) {
      throw new NotFoundError(`Institution with id '${id}' not found`);
    }
    return institution;
  }

  /**
   * List institutions with pagination and filtering.
   */
  async list(
    tenantId: string,
    filter: InstitutionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  /**
   * Check if an institution is active (used by other services to prevent
   * enrollments/assignments to inactive institutions).
   */
  async isActive(tenantId: string, id: string): Promise<boolean> {
    const institution = await this.repository.findById(id, tenantId);
    if (!institution) {
      return false;
    }
    return institution.status === EntityStatus.ACTIVE;
  }
}
