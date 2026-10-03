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
import { ConflictError, NotFoundError, EntityStatus, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { readOffboardMeta, writeOffboardMeta, type StaffOffboardMeta } from './offboard-meta.js';
import type { OffboardStaffInput } from './offboard-schemas.js';
import type { CreateStaffInput, UpdateStaffInput } from './schemas.js';
import type { StaffEntity, StaffFilter, StaffRepository } from './staff-repository.js';

export interface StaffOffboardStatusView {
  staffId: string;
  employmentStatus: 'ACTIVE' | 'INACTIVE';
  offboardStatus: 'active' | 'offboarded';
  effectiveDate: string | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** PRC-M371: keys beginning with '__' are server-owned (e.g. __offboard, __profile). */
const RESERVED_CUSTOM_DATA_PREFIX = '__';

function assertNoReservedCustomDataKeys(customData: Record<string, unknown> | null | undefined) {
  if (!customData) return;
  const reserved = Object.keys(customData).filter((key) =>
    key.startsWith(RESERVED_CUSTOM_DATA_PREFIX),
  );
  if (reserved.length > 0) {
    throw new ValidationError('customData contains reserved keys', [
      {
        field: 'customData',
        rule: 'reserved',
        message: `Keys starting with "${RESERVED_CUSTOM_DATA_PREFIX}" are reserved: ${reserved.join(', ')}`,
      },
    ]);
  }
}

/** Server-owned keys from the stored customData, preserved across client replaces. */
function reservedCustomData(
  customData: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customData ?? {})) {
    if (key.startsWith(RESERVED_CUSTOM_DATA_PREFIX)) out[key] = value;
  }
  return out;
}

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
    assertNoReservedCustomDataKeys(input.customData);
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
    assertNoReservedCustomDataKeys(input.customData);
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
    if (input.customData !== undefined) {
      // PRC-M371: client keys replace user data; server-owned keys survive.
      const reserved = reservedCustomData(existing.customData);
      updateData.customData = { ...input.customData, ...reserved };
    }

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
   * PRC-L153: verify a batch of staff ids belongs to the tenant (one query when supported).
   * @throws NotFoundError naming the first missing id
   */
  async assertStaffExist(tenantId: string, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    let existing: Set<string>;
    if (this.repository.findExistingIds) {
      existing = new Set(await this.repository.findExistingIds(unique, tenantId));
    } else {
      existing = new Set<string>();
      for (const id of unique) {
        if (await this.repository.findById(id, tenantId)) existing.add(id);
      }
    }
    const missing = unique.find((id) => !existing.has(id));
    if (missing) throw new NotFoundError(`Staff with id '${missing}' not found`);
  }

  /** PRC-L153: compensating removal of a row created earlier in the same request. */
  async purgeCreated(tenantId: string, id: string): Promise<void> {
    if (this.repository.purgeCreated) {
      await this.repository.purgeCreated(id, tenantId);
    } else {
      await this.repository.delete(id, tenantId);
    }
  }

  /**
   * Delete a staff record.
   *
   * @throws NotFoundError if staff not found
   */
  async delete(tenantId: string, id: string): Promise<void> {
    // PRC-L157: block delete when HR/payroll history references this staff member.
    if (this.repository.countDependents) {
      const counts = await this.repository.countDependents(id, tenantId);
      const kinds = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([kind]) => kind);
      if (kinds.length > 0) {
        throw new ConflictError(
          `Staff with id '${id}' has dependent records (${kinds.join(', ')}); offboard the staff member instead of deleting`,
        );
      }
    }
    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }
  }

  /**
   * Thin offboard status stub (P1-HR): mark staff INACTIVE and record metadata.
   * Does not run IT revoke, asset return, final pay, or contract termination.
   *
   * @throws NotFoundError if staff not found for tenant
   * @throws ConflictError if already offboarded
   */
  async offboard(
    tenantId: string,
    id: string,
    input: OffboardStaffInput,
    decidedBy: string,
  ): Promise<StaffOffboardStatusView> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }

    const prior = readOffboardMeta(existing.customData);
    if (prior || existing.status === EntityStatus.INACTIVE) {
      throw new ConflictError(`Staff with id '${id}' is already inactive/offboarded`);
    }

    const meta: StaffOffboardMeta = {
      status: 'offboarded',
      effectiveDate: input.effectiveDate,
      reason: input.reason?.trim() ? input.reason.trim() : null,
      decidedBy,
      decidedAt: new Date().toISOString(),
    };

    const updated = await this.repository.update(id, tenantId, {
      status: EntityStatus.INACTIVE,
      customData: writeOffboardMeta(existing.customData, meta),
    });
    if (!updated) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }

    return this.toOffboardView(updated);
  }

  /**
   * Read thin offboard status for a staff member.
   *
   * @throws NotFoundError if staff not found for tenant
   */
  async getOffboardStatus(tenantId: string, id: string): Promise<StaffOffboardStatusView> {
    const staff = await this.repository.findById(id, tenantId);
    if (!staff) {
      throw new NotFoundError(`Staff with id '${id}' not found`);
    }
    return this.toOffboardView(staff);
  }

  private toOffboardView(staff: StaffEntity): StaffOffboardStatusView {
    const meta = readOffboardMeta(staff.customData);
    if (!meta) {
      return {
        staffId: staff.id,
        employmentStatus: staff.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        offboardStatus: 'active',
        effectiveDate: null,
        reason: null,
        decidedBy: null,
        decidedAt: null,
      };
    }
    return {
      staffId: staff.id,
      employmentStatus: staff.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      offboardStatus: 'offboarded',
      effectiveDate: meta.effectiveDate,
      reason: meta.reason,
      decidedBy: meta.decidedBy,
      decidedAt: meta.decidedAt,
    };
  }
}
