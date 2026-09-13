/**
 * Student Service
 *
 * Business logic for student CRUD operations.
 * Handles validation, uniqueness enforcement (national ID per tenant),
 * personal information management, and full-text search.
 *
 * Requirements:
 * - 6.1: Manage student records including personal information, identity documents,
 *         contacts, guardians, and nationality. Name and date of birth are mandatory.
 * - 6.5: Support Custom_Fields to extend student profiles via JSONB custom_data column
 */
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { StudentEntity, StudentFilter, StudentRepository } from './student-repository.js';
import type { CreateStudentInput, MergeStudentsInput, UpdateStudentInput } from './schemas.js';

export type ReassignEnrollments = (input: {
  tenantId: string;
  fromStudentId: string;
  toStudentId: string;
}) => Promise<number>;

/**
 * Service handling student business logic.
 */
export class StudentService {
  constructor(
    private readonly repository: StudentRepository,
    private readonly reassignEnrollments?: ReassignEnrollments,
  ) {}

  /**
   * Create a new student.
   *
   * Validates:
   * - National ID is unique within the tenant (if provided)
   *
   * @throws ConflictError if national ID already exists for this tenant
   */
  async create(tenantId: string, input: CreateStudentInput): Promise<StudentEntity> {
    // Check national ID uniqueness within tenant if provided
    if (input.nationalId) {
      const existingByNationalId = await this.repository.findByNationalId(
        input.nationalId,
        tenantId,
      );
      if (existingByNationalId) {
        throw new ConflictError(`Student with national ID '${input.nationalId}' already exists`);
      }
    }

    const student: Omit<StudentEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      nationalId: input.nationalId ?? null,
      nationality: input.nationality ?? null,
      contacts: input.contacts ?? [],
      guardians: (input.guardians ?? []).map((g) => ({
        id: g.id ?? uuidv4(),
        firstName: g.firstName,
        lastName: g.lastName,
        relationship: g.relationship,
        contactPhone: g.contactPhone,
        contactEmail: g.contactEmail,
      })),
      identityDocuments: input.identityDocuments ?? [],
      customData: input.customData ?? {},
    };

    return this.repository.create(student);
  }

  /**
   * Update an existing student.
   *
   * Validates:
   * - Student exists and belongs to the tenant
   * - If national ID is changed, new national ID is unique within the tenant
   *
   * @throws NotFoundError if student not found
   * @throws ConflictError if national ID uniqueness violated
   */
  async update(tenantId: string, id: string, input: UpdateStudentInput): Promise<StudentEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Student with id '${id}' not found`);
    }

    // Check national ID uniqueness if it's being changed
    if (
      input.nationalId !== undefined &&
      input.nationalId !== null &&
      input.nationalId !== existing.nationalId
    ) {
      const existingByNationalId = await this.repository.findByNationalId(
        input.nationalId,
        tenantId,
      );
      if (existingByNationalId && existingByNationalId.id !== id) {
        throw new ConflictError(`Student with national ID '${input.nationalId}' already exists`);
      }
    }

    const updateData: Partial<StudentEntity> = {};
    if (input.firstName !== undefined) updateData.firstName = input.firstName;
    if (input.lastName !== undefined) updateData.lastName = input.lastName;
    if (input.dateOfBirth !== undefined) updateData.dateOfBirth = input.dateOfBirth;
    if (input.gender !== undefined) updateData.gender = input.gender;
    if (input.nationalId !== undefined) updateData.nationalId = input.nationalId;
    if (input.nationality !== undefined) updateData.nationality = input.nationality;
    if (input.contacts !== undefined) updateData.contacts = input.contacts;
    if (input.guardians !== undefined) {
      updateData.guardians = input.guardians.map((g) => ({
        id: g.id ?? uuidv4(),
        firstName: g.firstName,
        lastName: g.lastName,
        relationship: g.relationship,
        contactPhone: g.contactPhone,
        contactEmail: g.contactEmail,
      }));
    }
    if (input.identityDocuments !== undefined)
      updateData.identityDocuments = input.identityDocuments;
    if (input.customData !== undefined) updateData.customData = input.customData;

    const updated = await this.repository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Student with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a single student by ID.
   *
   * @throws NotFoundError if student not found
   */
  async getById(tenantId: string, id: string): Promise<StudentEntity> {
    const student = await this.repository.findById(id, tenantId);
    if (!student) {
      throw new NotFoundError(`Student with id '${id}' not found`);
    }
    return student;
  }

  /**
   * List students with pagination and filtering.
   */
  async list(
    tenantId: string,
    filter: StudentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  /**
   * Full-text search on student name and national ID.
   * Uses PostgreSQL tsvector in production; simulated in-memory for tests.
   */
  async search(
    tenantId: string,
    query: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return this.repository.search(tenantId, query, pagination);
  }

  /**
   * Delete a student (soft delete).
   *
   * @throws NotFoundError if student not found
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Student with id '${id}' not found`);
    }
  }

  /**
   * W2-SIS-02: merge a duplicate student into a survivor.
   * Copies missing profile fields, reassigns enrollments when wired, soft-deletes
   * the duplicate, and stamps merge metadata on both records.
   */
  async mergeDuplicates(
    tenantId: string,
    input: MergeStudentsInput,
  ): Promise<{
    survivor: StudentEntity;
    duplicateId: string;
    enrollmentsReassigned: number;
    mergeId: string;
  }> {
    if (input.survivorId === input.duplicateId) {
      throw new BusinessRuleError('survivorId and duplicateId must differ');
    }

    const survivor = await this.repository.findById(input.survivorId, tenantId);
    if (!survivor) {
      throw new NotFoundError(`Survivor student '${input.survivorId}' not found`);
    }
    const duplicate = await this.repository.findById(input.duplicateId, tenantId);
    if (!duplicate) {
      throw new NotFoundError(`Duplicate student '${input.duplicateId}' not found`);
    }
    if (duplicate.customData?.['mergedInto']) {
      throw new ConflictError(`Student '${input.duplicateId}' was already merged`);
    }

    const mergeId = uuidv4();
    const mergedCustom: Record<string, unknown> = {
      ...duplicate.customData,
      ...survivor.customData,
      lastMergeId: mergeId,
    };

    const patch: Partial<StudentEntity> = {
      customData: mergedCustom,
    };
    if (!survivor.nationalId && duplicate.nationalId) patch.nationalId = duplicate.nationalId;
    if (!survivor.nationality && duplicate.nationality) patch.nationality = duplicate.nationality;
    if (survivor.contacts.length === 0 && duplicate.contacts.length > 0) {
      patch.contacts = duplicate.contacts;
    }
    if (survivor.guardians.length === 0 && duplicate.guardians.length > 0) {
      patch.guardians = duplicate.guardians;
    }
    if (survivor.identityDocuments.length === 0 && duplicate.identityDocuments.length > 0) {
      patch.identityDocuments = duplicate.identityDocuments;
    }

    const updatedSurvivor = await this.repository.update(survivor.id, tenantId, patch);
    if (!updatedSurvivor) {
      throw new NotFoundError(`Survivor student '${input.survivorId}' not found`);
    }

    let enrollmentsReassigned = 0;
    if (this.reassignEnrollments) {
      enrollmentsReassigned = await this.reassignEnrollments({
        tenantId,
        fromStudentId: duplicate.id,
        toStudentId: survivor.id,
      });
    }

    await this.repository.update(duplicate.id, tenantId, {
      customData: {
        ...duplicate.customData,
        mergedInto: survivor.id,
        mergeId,
        mergeReason: input.reason,
        mergedAt: new Date().toISOString(),
      },
    });
    await this.repository.delete(duplicate.id, tenantId);

    return {
      survivor: updatedSurvivor,
      duplicateId: duplicate.id,
      enrollmentsReassigned,
      mergeId,
    };
  }
}
