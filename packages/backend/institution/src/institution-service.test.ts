/**
 * Unit tests for InstitutionService.
 *
 * Tests cover:
 * - Create institution with required field validation
 * - Unique code enforcement across all institutions
 * - Unique name within area enforcement
 * - Update institution with uniqueness checks
 * - Deactivation logic (set status inactive)
 * - Get by ID
 * - List with pagination and filtering
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { InstitutionService } from './institution-service.js';
import type { CreateInstitutionInput, UpdateInstitutionInput } from './schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validCreateInput(overrides: Partial<CreateInstitutionInput> = {}): CreateInstitutionInput {
  return {
    name: 'Test School',
    code: `SCH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    areaId: uuid(),
    typeId: uuid(),
    sectorId: uuid(),
    ownershipId: uuid(),
    ...overrides,
  };
}

describe('InstitutionService', () => {
  let repository: InMemoryInstitutionRepository;
  let service: InstitutionService;

  beforeEach(() => {
    repository = new InMemoryInstitutionRepository();
    service = new InstitutionService(repository);
  });

  describe('create', () => {
    it('should create an institution with all required fields', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.code).toBe(input.code);
      expect(result.areaId).toBe(input.areaId);
      expect(result.typeId).toBe(input.typeId);
      expect(result.sectorId).toBe(input.sectorId);
      expect(result.ownershipId).toBe(input.ownershipId);
      expect(result.status).toBe('ACTIVE');
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.boardId).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist an education board on create', async () => {
      const boardId = uuid();
      const result = await service.create(TENANT_ID, validCreateInput({ boardId }));
      expect(result.boardId).toBe(boardId);
    });

    it('should create an institution with optional fields', async () => {
      const input = validCreateInput({
        latitude: 40.7128,
        longitude: -74.006,
        address: '123 Main St',
        contactPhone: '+1234567890',
        contactEmail: 'school@example.com',
      });

      const result = await service.create(TENANT_ID, input);

      expect(result.latitude).toBe(40.7128);
      expect(result.longitude).toBe(-74.006);
      expect(result.address).toBe('123 Main St');
      expect(result.contactPhone).toBe('+1234567890');
      expect(result.contactEmail).toBe('school@example.com');
    });

    it('should set optional fields to null when not provided', async () => {
      const input = validCreateInput();
      const result = await service.create(TENANT_ID, input);

      expect(result.latitude).toBeNull();
      expect(result.longitude).toBeNull();
      expect(result.address).toBeNull();
      expect(result.contactPhone).toBeNull();
      expect(result.contactEmail).toBeNull();
      expect(result.deactivationReason).toBeNull();
    });

    it('should throw ConflictError when institution code already exists', async () => {
      const code = 'UNIQUE-CODE-001';
      const input1 = validCreateInput({ code });
      await service.create(TENANT_ID, input1);

      const input2 = validCreateInput({ code });
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(ConflictError);
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(
        `Institution with code '${code}' already exists`,
      );
    });

    it('should enforce unique code across different tenants', async () => {
      const code = 'GLOBAL-CODE-001';
      const input1 = validCreateInput({ code });
      await service.create(TENANT_ID, input1);

      // Same code in a different tenant should also fail (global uniqueness)
      const otherTenantId = uuid();
      const input2 = validCreateInput({ code });
      await expect(service.create(otherTenantId, input2)).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError when name already exists in the same area', async () => {
      const areaId = uuid();
      const name = 'Springfield Elementary';
      const input1 = validCreateInput({ name, areaId });
      await service.create(TENANT_ID, input1);

      const input2 = validCreateInput({ name, areaId });
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(ConflictError);
      await expect(service.create(TENANT_ID, input2)).rejects.toThrow(
        `Institution with name '${name}' already exists in the specified area`,
      );
    });

    it('should allow same name in different areas', async () => {
      const name = 'Central School';
      const areaId1 = uuid();
      const areaId2 = uuid();

      const input1 = validCreateInput({ name, areaId: areaId1 });
      const input2 = validCreateInput({ name, areaId: areaId2 });

      const result1 = await service.create(TENANT_ID, input1);
      const result2 = await service.create(TENANT_ID, input2);

      expect(result1.name).toBe(name);
      expect(result2.name).toBe(name);
      expect(result1.areaId).toBe(areaId1);
      expect(result2.areaId).toBe(areaId2);
    });

    it('should allow same name in different tenants within the same area', async () => {
      const name = 'National School';
      const areaId = uuid();

      const input1 = validCreateInput({ name, areaId });
      const input2 = validCreateInput({ name, areaId });

      const tenant1 = uuid();
      const tenant2 = uuid();

      const result1 = await service.create(tenant1, input1);
      const result2 = await service.create(tenant2, input2);

      expect(result1.name).toBe(name);
      expect(result2.name).toBe(name);
    });
  });

  describe('update', () => {
    it('should update an institution with partial data', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateInstitutionInput = {
        name: 'Updated School Name',
        address: '456 New Address',
      };

      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.name).toBe('Updated School Name');
      expect(updated.address).toBe('456 New Address');
      // Unchanged fields should remain
      expect(updated.code).toBe(input.code);
      expect(updated.areaId).toBe(input.areaId);
    });

    it('should throw NotFoundError when institution does not exist', async () => {
      const fakeId = uuid();
      const updateInput: UpdateInstitutionInput = { name: 'New Name' };

      await expect(service.update(TENANT_ID, fakeId, updateInput)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when institution belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      const updateInput: UpdateInstitutionInput = { name: 'New Name' };

      await expect(service.update(otherTenantId, created.id, updateInput)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError when updating code to an existing code', async () => {
      const input1 = validCreateInput({ code: 'CODE-A' });
      const input2 = validCreateInput({ code: 'CODE-B' });
      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);

      const updateInput: UpdateInstitutionInput = { code: 'CODE-A' };
      await expect(service.update(TENANT_ID, created2.id, updateInput)).rejects.toThrow(
        ConflictError,
      );
    });

    it('should allow updating code to the same code (no change)', async () => {
      const input = validCreateInput({ code: 'SAME-CODE' });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateInstitutionInput = { code: 'SAME-CODE' };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.code).toBe('SAME-CODE');
    });

    it('should throw ConflictError when updating name to existing name in same area', async () => {
      const areaId = uuid();
      const input1 = validCreateInput({ name: 'School A', areaId });
      const input2 = validCreateInput({ name: 'School B', areaId });
      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);

      const updateInput: UpdateInstitutionInput = { name: 'School A' };
      await expect(service.update(TENANT_ID, created2.id, updateInput)).rejects.toThrow(
        ConflictError,
      );
    });

    it('should allow updating name to the same name (no change)', async () => {
      const areaId = uuid();
      const input = validCreateInput({ name: 'My School', areaId });
      const created = await service.create(TENANT_ID, input);

      const updateInput: UpdateInstitutionInput = { name: 'My School' };
      const updated = await service.update(TENANT_ID, created.id, updateInput);

      expect(updated.name).toBe('My School');
    });

    it('should allow updating name when moving to a different area', async () => {
      const areaId1 = uuid();
      const areaId2 = uuid();
      const input1 = validCreateInput({ name: 'School X', areaId: areaId1 });
      const input2 = validCreateInput({ name: 'School X', areaId: areaId2 });
      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);

      // Move created2 to areaId1 with a different name should work
      const updateInput: UpdateInstitutionInput = { name: 'School Y', areaId: areaId1 };
      const updated = await service.update(TENANT_ID, created2.id, updateInput);

      expect(updated.name).toBe('School Y');
      expect(updated.areaId).toBe(areaId1);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an active institution', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const deactivated = await service.deactivate(TENANT_ID, created.id, 'Closing permanently');

      expect(deactivated.status).toBe('INACTIVE');
      expect(deactivated.deactivationReason).toBe('Closing permanently');
    });

    it('should throw NotFoundError when institution does not exist', async () => {
      const fakeId = uuid();
      await expect(service.deactivate(TENANT_ID, fakeId, 'reason')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw BusinessRuleError when institution is already inactive', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      // Deactivate once
      await service.deactivate(TENANT_ID, created.id, 'First deactivation');

      // Try to deactivate again
      await expect(
        service.deactivate(TENANT_ID, created.id, 'Second deactivation'),
      ).rejects.toThrow(BusinessRuleError);
      await expect(
        service.deactivate(TENANT_ID, created.id, 'Second deactivation'),
      ).rejects.toThrow('Institution is already inactive');
    });

    it('should throw NotFoundError when institution belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.deactivate(otherTenantId, created.id, 'reason')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('getById', () => {
    it('should return an institution by ID', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const found = await service.getById(TENANT_ID, created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.name).toBe(input.name);
    });

    it('should throw NotFoundError when institution does not exist', async () => {
      const fakeId = uuid();
      await expect(service.getById(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when institution belongs to different tenant', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.getById(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      // Create 5 institutions
      for (let i = 0; i < 5; i++) {
        await service.create(TENANT_ID, validCreateInput({ name: `School ${i}` }));
      }

      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(3);
      expect(result.meta.totalItems).toBe(5);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by area', async () => {
      const areaId = uuid();
      const otherAreaId = uuid();

      await service.create(TENANT_ID, validCreateInput({ name: 'In Area', areaId }));
      await service.create(TENANT_ID, validCreateInput({ name: 'Other Area', areaId: otherAreaId }));

      const result = await service.list(TENANT_ID, { areaId }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].areaId).toBe(areaId);
    });

    it('should filter by status', async () => {
      const input1 = validCreateInput({ name: 'Active School' });
      const input2 = validCreateInput({ name: 'Inactive School' });

      await service.create(TENANT_ID, input1);
      const created2 = await service.create(TENANT_ID, input2);
      await service.deactivate(TENANT_ID, created2.id, 'Closing');

      const activeResult = await service.list(
        TENANT_ID,
        { status: 'ACTIVE' },
        { page: 1, pageSize: 20 },
      );
      const inactiveResult = await service.list(
        TENANT_ID,
        { status: 'INACTIVE' },
        { page: 1, pageSize: 20 },
      );

      expect(activeResult.data).toHaveLength(1);
      expect(activeResult.data[0].name).toBe('Active School');
      expect(inactiveResult.data).toHaveLength(1);
      expect(inactiveResult.data[0].name).toBe('Inactive School');
    });

    it('should filter by search term (name or code)', async () => {
      await service.create(TENANT_ID, validCreateInput({ name: 'Springfield Elementary', code: 'SPR-001' }));
      await service.create(TENANT_ID, validCreateInput({ name: 'Shelbyville High', code: 'SHV-001' }));

      const result = await service.list(
        TENANT_ID,
        { search: 'spring' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Springfield Elementary');
    });

    it('should search by code', async () => {
      await service.create(TENANT_ID, validCreateInput({ name: 'School A', code: 'ABC-123' }));
      await service.create(TENANT_ID, validCreateInput({ name: 'School B', code: 'XYZ-789' }));

      const result = await service.list(
        TENANT_ID,
        { search: 'ABC' },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('ABC-123');
    });

    it('should only return institutions for the specified tenant', async () => {
      const tenant1 = uuid();
      const tenant2 = uuid();

      await service.create(tenant1, validCreateInput({ name: 'Tenant 1 School' }));
      await service.create(tenant2, validCreateInput({ name: 'Tenant 2 School' }));

      const result = await service.list(tenant1, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Tenant 1 School');
    });

    it('should return empty results when no institutions match', async () => {
      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalItems).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('isActive', () => {
    it('should return true for an active institution', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);

      const active = await service.isActive(TENANT_ID, created.id);
      expect(active).toBe(true);
    });

    it('should return false for an inactive institution', async () => {
      const input = validCreateInput();
      const created = await service.create(TENANT_ID, input);
      await service.deactivate(TENANT_ID, created.id, 'Closing');

      const active = await service.isActive(TENANT_ID, created.id);
      expect(active).toBe(false);
    });

    it('should return false for a non-existent institution', async () => {
      const active = await service.isActive(TENANT_ID, uuid());
      expect(active).toBe(false);
    });
  });
});
