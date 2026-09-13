/**
 * Unit tests for StudentService.
 *
 * Tests cover:
 * - Create student with required field validation (name, date of birth)
 * - National ID uniqueness enforcement within tenant
 * - Update student with uniqueness checks
 * - Get by ID
 * - List with pagination and filtering
 * - Full-text search on name and national ID
 * - Delete (soft delete)
 * - Custom data (JSONB) support
 * - Contacts, guardians, identity documents management
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { StudentService } from './student-service.js';
import type { CreateStudentInput, UpdateStudentInput } from './schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validCreateInput(overrides: Partial<CreateStudentInput> = {}): CreateStudentInput {
  return {
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '2005-03-15',
    gender: 'male',
    ...overrides,
  };
}

describe('StudentService', () => {
  let repository: InMemoryStudentRepository;
  let service: StudentService;

  beforeEach(() => {
    repository = new InMemoryStudentRepository();
    service = new StudentService(repository);
  });

  describe('create', () => {
    it('should create a student with required fields', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
      expect(result.dateOfBirth).toBe('2005-03-15');
      expect(result.gender).toBe('male');
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a student with optional fields', async () => {
      const input = validCreateInput({
        nationalId: 'NID-12345',
        nationality: 'American',
        contacts: [
          { type: 'phone', value: '+1234567890', isPrimary: true },
          { type: 'email', value: 'john@example.com', isPrimary: false },
        ],
        guardians: [
          {
            firstName: 'Jane',
            lastName: 'Doe',
            relationship: 'mother',
            contactPhone: '+1987654321',
            contactEmail: 'jane@example.com',
          },
        ],
        identityDocuments: [
          { type: 'passport', number: 'P123456', issuingCountry: 'US', expiryDate: '2030-01-01' },
        ],
        customData: { allergies: ['peanuts'], bloodType: 'O+' },
      });

      const result = await service.create(TENANT_ID, input);

      expect(result.nationalId).toBe('NID-12345');
      expect(result.nationality).toBe('American');
      expect(result.contacts).toHaveLength(2);
      expect(result.contacts[0].type).toBe('phone');
      expect(result.contacts[0].isPrimary).toBe(true);
      expect(result.guardians).toHaveLength(1);
      expect(result.guardians[0].firstName).toBe('Jane');
      expect(result.guardians[0].relationship).toBe('mother');
      expect(result.guardians[0].id).toBeDefined();
      expect(result.identityDocuments).toHaveLength(1);
      expect(result.identityDocuments[0].type).toBe('passport');
      expect(result.customData).toEqual({ allergies: ['peanuts'], bloodType: 'O+' });
    });

    it('should set optional fields to defaults when not provided', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result.nationalId).toBeNull();
      expect(result.nationality).toBeNull();
      expect(result.contacts).toEqual([]);
      expect(result.guardians).toEqual([]);
      expect(result.identityDocuments).toEqual([]);
      expect(result.customData).toEqual({});
    });

    it('should throw ConflictError when national ID already exists in same tenant', async () => {
      const input1 = validCreateInput({ nationalId: 'NID-UNIQUE-001' });
      await service.create(TENANT_ID, input1);

      const input2 = validCreateInput({
        firstName: 'Jane',
        nationalId: 'NID-UNIQUE-001',
      });
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(ConflictError);
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(
        "Student with national ID 'NID-UNIQUE-001' already exists",
      );
    });

    it('should allow same national ID in different tenants', async () => {
      const tenant1 = uuid();
      const tenant2 = uuid();
      const nationalId = 'NID-CROSS-TENANT';

      const input1 = validCreateInput({ nationalId });
      const input2 = validCreateInput({ firstName: 'Jane', nationalId });

      const result1 = await service.create(tenant1, input1);
      const result2 = await service.create(tenant2, input2);

      expect(result1.nationalId).toBe(nationalId);
      expect(result2.nationalId).toBe(nationalId);
    });

    it('should allow creating students without national ID (no uniqueness check)', async () => {
      const input1 = validCreateInput({ firstName: 'Student1' });
      const input2 = validCreateInput({ firstName: 'Student2' });

      const result1 = await service.create(TENANT_ID, input1);
      const result2 = await service.create(TENANT_ID, input2);

      expect(result1.nationalId).toBeNull();
      expect(result2.nationalId).toBeNull();
    });

    it('should support custom data via JSONB column', async () => {
      const customData = {
        emergencyContact: 'Dr. Smith',
        medicalNotes: 'Asthma',
        preferredLanguage: 'Spanish',
        extracurricular: ['soccer', 'chess'],
      };

      const input = validCreateInput({ customData });
      const result = await service.create(TENANT_ID, input);

      expect(result.customData).toEqual(customData);
    });
  });

  describe('update', () => {
    it('should update a student with partial data', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStudentInput = {
        firstName: 'Jonathan',
        nationality: 'Canadian',
      };

      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.firstName).toBe('Jonathan');
      expect(updated.nationality).toBe('Canadian');
      // Unchanged fields should remain
      expect(updated.lastName).toBe('Doe');
      expect(updated.dateOfBirth).toBe('2005-03-15');
    });

    it('should throw NotFoundError when student does not exist', async () => {
      const fakeId = uuid();
      const updateInput: UpdateStudentInput = { firstName: 'New Name' };

      await expect(service.update(TENANT_ID, fakeId, updateInput)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when student belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      const updateInput: UpdateStudentInput = { firstName: 'New Name' };

      await expect(service.update(otherTenantId, created.id, updateInput)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError when updating national ID to an existing one', async () => {
      const input1 = validCreateInput({ nationalId: 'NID-AAA', firstName: 'Alice' });
      const input2 = validCreateInput({ nationalId: 'NID-BBB', firstName: 'Bob' });
      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);

      const updateInput: UpdateStudentInput = { nationalId: 'NID-AAA' };
      await expect(service.update(TENANT_ID, created2.id, updateInput)).rejects.toThrow(
        ConflictError,
      );
    });

    it('should allow updating national ID to the same value (no change)', async () => {
      const input = validCreateInput({ nationalId: 'NID-SAME' });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStudentInput = { nationalId: 'NID-SAME' };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.nationalId).toBe('NID-SAME');
    });

    it('should update contacts', async () => {
      const input = validCreateInput({
        contacts: [{ type: 'phone', value: '111', isPrimary: true }],
      });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStudentInput = {
        contacts: [
          { type: 'phone', value: '222', isPrimary: true },
          { type: 'email', value: 'new@example.com', isPrimary: false },
        ],
      };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.contacts).toHaveLength(2);
      expect(updated.contacts[0].value).toBe('222');
    });

    it('should update guardians', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStudentInput = {
        guardians: [{ firstName: 'Robert', lastName: 'Doe', relationship: 'father' }],
      };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.guardians).toHaveLength(1);
      expect(updated.guardians[0].firstName).toBe('Robert');
      expect(updated.guardians[0].id).toBeDefined();
    });

    it('should update custom data', async () => {
      const input = validCreateInput({ customData: { key1: 'value1' } });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStudentInput = {
        customData: { key1: 'updated', key2: 'new' },
      };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.customData).toEqual({ key1: 'updated', key2: 'new' });
    });
  });

  describe('getById', () => {
    it('should return a student by ID', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const found = await service.getById(TENANT_ID, created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.firstName).toBe('John');
    });

    it('should throw NotFoundError when student does not exist', async () => {
      const fakeId = uuid();
      await expect(service.getById(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when student belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.getById(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create(TENANT_ID, validCreateInput({ firstName: `Student${i}` }));
      }

      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(3);
      expect(result.meta.totalItems).toBe(5);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by gender', async () => {
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Alice', gender: 'female' }));
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Bob', gender: 'male' }));

      const result = await service.list(TENANT_ID, { gender: 'female' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].firstName).toBe('Alice');
    });

    it('should filter by search term (name)', async () => {
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Alice', lastName: 'Smith' }));
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Bob', lastName: 'Jones' }));

      const result = await service.list(TENANT_ID, { search: 'alice' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].firstName).toBe('Alice');
    });

    it('should filter by search term (national ID)', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Alice', nationalId: 'NID-ABC' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Bob', nationalId: 'NID-XYZ' }),
      );

      const result = await service.list(TENANT_ID, { search: 'ABC' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].nationalId).toBe('NID-ABC');
    });

    it('should only return students for the specified tenant', async () => {
      const tenant1 = uuid();
      const tenant2 = uuid();

      await service.create(tenant1, validCreateInput({ firstName: 'Tenant1Student' }));
      await service.create(tenant2, validCreateInput({ firstName: 'Tenant2Student' }));

      const result = await service.list(tenant1, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].firstName).toBe('Tenant1Student');
    });

    it('should return empty results when no students match', async () => {
      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalItems).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('search', () => {
    it('should find students by first name', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Alexander', lastName: 'Hamilton' }),
      );
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Bob', lastName: 'Smith' }));

      const result = await service.search(TENANT_ID, 'Alexander', { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].firstName).toBe('Alexander');
    });

    it('should find students by last name', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'John', lastName: 'Hamilton' }),
      );
      await service.create(TENANT_ID, validCreateInput({ firstName: 'Bob', lastName: 'Smith' }));

      const result = await service.search(TENANT_ID, 'Hamilton', { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].lastName).toBe('Hamilton');
    });

    it('should find students by national ID', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Alice', nationalId: 'NID-SEARCH-001' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Bob', nationalId: 'NID-OTHER-002' }),
      );

      const result = await service.search(TENANT_ID, 'SEARCH-001', { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].nationalId).toBe('NID-SEARCH-001');
    });

    it('should return paginated search results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create(
          TENANT_ID,
          validCreateInput({ firstName: `John${i}`, lastName: 'Doe' }),
        );
      }

      const result = await service.search(TENANT_ID, 'Doe', { page: 1, pageSize: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(5);
      expect(result.meta.totalPages).toBe(3);
    });

    it('should only search within the specified tenant', async () => {
      const tenant1 = uuid();
      const tenant2 = uuid();

      await service.create(tenant1, validCreateInput({ firstName: 'SharedName', lastName: 'T1' }));
      await service.create(tenant2, validCreateInput({ firstName: 'SharedName', lastName: 'T2' }));

      const result = await service.search(tenant1, 'SharedName', { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].lastName).toBe('T1');
    });
  });

  describe('delete', () => {
    it('should delete a student', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      await service.delete(TENANT_ID, created.id);

      await expect(service.getById(TENANT_ID, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when student does not exist', async () => {
      const fakeId = uuid();
      await expect(service.delete(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when student belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.delete(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });
});

  describe('mergeDuplicates (W2-SIS-02)', () => {
    it('merges duplicate profile data into the survivor and soft-deletes the duplicate', async () => {
      const survivor = await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Ada', nationalId: null }),
      );
      const duplicate = await service.create(
        TENANT_ID,
        validCreateInput({
          firstName: 'Ada',
          lastName: 'Lovelace',
          nationalId: 'NID-DUP-1',
          nationality: 'British',
          contacts: [{ type: 'email', value: 'ada@example.com', isPrimary: true }],
        }),
      );

      const result = await service.mergeDuplicates(TENANT_ID, {
        survivorId: survivor.id,
        duplicateId: duplicate.id,
        reason: 'Same person entered twice',
      });

      expect(result.survivor.nationalId).toBe('NID-DUP-1');
      expect(result.survivor.nationality).toBe('British');
      expect(result.survivor.contacts).toHaveLength(1);
      expect(result.mergeId).toBeDefined();
      await expect(service.getById(TENANT_ID, duplicate.id)).rejects.toThrow(NotFoundError);
    });

    it('rejects merging a student into itself', async () => {
      const student = await service.create(TENANT_ID, validCreateInput());
      await expect(
        service.mergeDuplicates(TENANT_ID, {
          survivorId: student.id,
          duplicateId: student.id,
          reason: 'noop',
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('reassigns enrollments when a reassign hook is provided', async () => {
      let moved = 0;
      const wired = new StudentService(repository, async () => {
        moved = 2;
        return 2;
      });
      const survivor = await wired.create(TENANT_ID, validCreateInput({ firstName: 'Surv' }));
      const duplicate = await wired.create(TENANT_ID, validCreateInput({ firstName: 'Dup' }));
      const result = await wired.mergeDuplicates(TENANT_ID, {
        survivorId: survivor.id,
        duplicateId: duplicate.id,
        reason: 'Duplicate import',
      });
      expect(result.enrollmentsReassigned).toBe(2);
      expect(moved).toBe(2);
    });
  });
