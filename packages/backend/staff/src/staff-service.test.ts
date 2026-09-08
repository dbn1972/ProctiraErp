/**
 * Unit tests for StaffService.
 *
 * Tests cover:
 * - Create staff with required field validation
 * - Unique identity number enforcement across all staff
 * - Update staff with uniqueness checks
 * - Get by ID
 * - List with pagination, filtering, and full-text search
 * - Delete staff
 * - Custom fields via JSONB custom_data
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '@proctira/common';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';
import type { CreateStaffInput, UpdateStaffInput } from './schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validCreateInput(overrides: Partial<CreateStaffInput> = {}): CreateStaffInput {
  return {
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1985-06-15',
    identityNumber: `ID-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contactPhone: '+1234567890',
    position: 'Teacher',
    ...overrides,
  };
}

describe('StaffService', () => {
  let repository: InMemoryStaffRepository;
  let service: StaffService;

  beforeEach(() => {
    repository = new InMemoryStaffRepository();
    service = new StaffService(repository);
  });

  describe('create', () => {
    it('should create a staff record with all required fields', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.firstName).toBe(input.firstName);
      expect(result.lastName).toBe(input.lastName);
      expect(result.dateOfBirth).toBe(input.dateOfBirth);
      expect(result.identityNumber).toBe(input.identityNumber);
      expect(result.contactPhone).toBe(input.contactPhone);
      expect(result.position).toBe(input.position);
      expect(result.status).toBe('ACTIVE');
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a staff record with optional email', async () => {
      const input = validCreateInput({ contactEmail: 'john@example.com' });
      const result = await service.create(TENANT_ID, input);

      expect(result.contactEmail).toBe('john@example.com');
    });

    it('should set contactEmail to null when not provided', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result.contactEmail).toBeNull();
    });

    it('should support custom fields via customData', async () => {
      const customData = { department: 'Science', yearsExperience: 10, certifications: ['PhD'] };
      const input = validCreateInput({ customData });
      const result = await service.create(TENANT_ID, input);

      expect(result.customData).toEqual(customData);
    });

    it('should set customData to null when not provided', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result.customData).toBeNull();
    });

    it('should throw ConflictError when identity number already exists', async () => {
      const identityNumber = 'UNIQUE-ID-001';
      const input1 = validCreateInput({ identityNumber });
      await service.create(TENANT_ID, input1);

      const input2 = validCreateInput({ identityNumber });
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(ConflictError);
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(
        `Staff with identity number '${identityNumber}' already exists`,
      );
    });

    it('should enforce unique identity number across different tenants', async () => {
      const identityNumber = 'GLOBAL-ID-001';
      const input1 = validCreateInput({ identityNumber });
      await service.create(TENANT_ID, input1);

      // Same identity number in a different tenant should also fail (global uniqueness)
      const otherTenantId = uuid();
      const input2 = validCreateInput({ identityNumber });
      await expect(service.create(otherTenantId, input2)).rejects.toThrow(ConflictError);
    });

    it('should allow different identity numbers for different staff', async () => {
      const input1 = validCreateInput({ identityNumber: 'ID-001' });
      const input2 = validCreateInput({ identityNumber: 'ID-002' });

      const result1 = await service.create(TENANT_ID, input1);
      const result2 = await service.create(TENANT_ID, input2);

      expect(result1.identityNumber).toBe('ID-001');
      expect(result2.identityNumber).toBe('ID-002');
    });
  });

  describe('update', () => {
    it('should update a staff record with partial data', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStaffInput = {
        firstName: 'Jane',
        position: 'Principal',
      };

      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.firstName).toBe('Jane');
      expect(updated.position).toBe('Principal');
      // Unchanged fields should remain
      expect(updated.lastName).toBe(input.lastName);
      expect(updated.identityNumber).toBe(input.identityNumber);
    });

    it('should update custom data', async () => {
      const input = validCreateInput({ customData: { department: 'Math' } });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStaffInput = {
        customData: { department: 'Science', level: 'Senior' },
      };

      const updated = await service.update(TENANT_ID, created.id, updateInput);
      expect(updated.customData).toEqual({ department: 'Science', level: 'Senior' });
    });

    it('should throw NotFoundError when staff does not exist', async () => {
      const fakeId = uuid();
      const updateInput: UpdateStaffInput = { firstName: 'New Name' };

      await expect(service.update(TENANT_ID, fakeId, updateInput)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when staff belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      const updateInput: UpdateStaffInput = { firstName: 'New Name' };

      await expect(service.update(otherTenantId, created.id, updateInput)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError when updating identity number to an existing one', async () => {
      const input1 = validCreateInput({ identityNumber: 'ID-AAA' });
      const input2 = validCreateInput({ identityNumber: 'ID-BBB' });
      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);

      const updateInput: UpdateStaffInput = { identityNumber: 'ID-AAA' };
      await expect(service.update(TENANT_ID, created2.id, updateInput)).rejects.toThrow(
        ConflictError,
      );
    });

    it('should allow updating identity number to the same value (no change)', async () => {
      const input = validCreateInput({ identityNumber: 'SAME-ID' });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateStaffInput = { identityNumber: 'SAME-ID' };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.identityNumber).toBe('SAME-ID');
    });
  });

  describe('getById', () => {
    it('should return a staff record by ID', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const found = await service.getById(TENANT_ID, created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.firstName).toBe(input.firstName);
    });

    it('should throw NotFoundError when staff does not exist', async () => {
      const fakeId = uuid();
      await expect(service.getById(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when staff belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.getById(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      // Create 5 staff records
      for (let i = 0; i < 5; i++) {
        await service.create(
          TENANT_ID,
          validCreateInput({ firstName: `Staff${i}`, identityNumber: `ID-${i}` }),
        );
      }

      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(3);
      expect(result.meta.totalItems).toBe(5);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by status', async () => {
      const input1 = validCreateInput({ firstName: 'Active', identityNumber: 'ID-ACTIVE' });
      await service.create(TENANT_ID, input1);

      const result = await service.list(TENANT_ID, { status: 'ACTIVE' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.status).toBe('ACTIVE');
    });

    it('should filter by position', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ position: 'Teacher', identityNumber: 'ID-T1' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ position: 'Principal', identityNumber: 'ID-P1' }),
      );

      const result = await service.list(
        TENANT_ID,
        { position: 'Teacher' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.position).toBe('Teacher');
    });

    it('should search by first name', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Alice', identityNumber: 'ID-A1' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Bob', identityNumber: 'ID-B1' }),
      );

      const result = await service.list(TENANT_ID, { search: 'alice' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.firstName).toBe('Alice');
    });

    it('should search by last name', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ lastName: 'Smith', identityNumber: 'ID-S1' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ lastName: 'Johnson', identityNumber: 'ID-J1' }),
      );

      const result = await service.list(TENANT_ID, { search: 'smith' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.lastName).toBe('Smith');
    });

    it('should search by full name', async () => {
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'John', lastName: 'Smith', identityNumber: 'ID-JS1' }),
      );
      await service.create(
        TENANT_ID,
        validCreateInput({ firstName: 'Jane', lastName: 'Doe', identityNumber: 'ID-JD1' }),
      );

      const result = await service.list(
        TENANT_ID,
        { search: 'john smith' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.firstName).toBe('John');
      expect(result.data[0]!.lastName).toBe('Smith');
    });

    it('should search by identity number', async () => {
      await service.create(TENANT_ID, validCreateInput({ identityNumber: 'NAT-12345' }));
      await service.create(TENANT_ID, validCreateInput({ identityNumber: 'NAT-67890' }));

      const result = await service.list(TENANT_ID, { search: '12345' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.identityNumber).toBe('NAT-12345');
    });

    it('should only return staff for the specified tenant', async () => {
      const tenant1 = uuid();
      const tenant2 = uuid();

      await service.create(
        tenant1,
        validCreateInput({ firstName: 'Tenant1Staff', identityNumber: 'ID-T1S' }),
      );
      await service.create(
        tenant2,
        validCreateInput({ firstName: 'Tenant2Staff', identityNumber: 'ID-T2S' }),
      );

      const result = await service.list(tenant1, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.firstName).toBe('Tenant1Staff');
    });

    it('should return empty results when no staff match', async () => {
      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalItems).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('delete', () => {
    it('should delete a staff record', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      await service.delete(TENANT_ID, created.id);

      await expect(service.getById(TENANT_ID, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when staff does not exist', async () => {
      const fakeId = uuid();
      await expect(service.delete(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when staff belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.delete(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });
});
