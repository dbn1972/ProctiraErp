/**
 * Unit tests for Institution Typebox schemas.
 *
 * Tests cover:
 * - CreateInstitutionSchema validation of required fields
 * - UpdateInstitutionSchema allows partial updates
 * - DeactivateInstitutionSchema requires reason
 * - InstitutionParamsSchema validates UUID format
 * - InstitutionListQuerySchema with defaults
 */
import { describe, it, expect } from 'vitest';
import { validate } from '@proctira/validation';

import {
  CreateInstitutionSchema,
  UpdateInstitutionSchema,
  DeactivateInstitutionSchema,
  InstitutionParamsSchema,
  InstitutionListQuerySchema,
} from './schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

describe('CreateInstitutionSchema', () => {
  const validInput = () => ({
    name: 'Test School',
    code: 'SCH-001',
    areaId: uuid(),
    typeId: uuid(),
    sectorId: uuid(),
    ownershipId: uuid(),
  });

  it('should validate a complete valid input', () => {
    const result = validate(CreateInstitutionSchema, validInput());
    expect(result.success).toBe(true);
  });

  it('should validate input with all optional fields', () => {
    const input = {
      ...validInput(),
      latitude: 40.7128,
      longitude: -74.006,
      address: '123 Main St, City',
      contactPhone: '+1-555-0100',
      contactEmail: 'school@example.com',
    };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(40.7128);
      expect(result.data.contactEmail).toBe('school@example.com');
    }
  });

  it('should fail when name is missing', () => {
    const { name, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('name'))).toBe(true);
    }
  });

  it('should fail when code is missing', () => {
    const { code, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('code'))).toBe(true);
    }
  });

  it('should fail when areaId is missing', () => {
    const { areaId, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('areaId'))).toBe(true);
    }
  });

  it('should fail when typeId is missing', () => {
    const { typeId, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('typeId'))).toBe(true);
    }
  });

  it('should fail when sectorId is missing', () => {
    const { sectorId, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('sectorId'))).toBe(true);
    }
  });

  it('should fail when ownershipId is missing', () => {
    const { ownershipId, ...input } = validInput();
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field.includes('ownershipId'))).toBe(true);
    }
  });

  it('should fail when name is empty string', () => {
    const input = { ...validInput(), name: '' };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when name exceeds 255 characters', () => {
    const input = { ...validInput(), name: 'x'.repeat(256) };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when code exceeds 50 characters', () => {
    const input = { ...validInput(), code: 'x'.repeat(51) };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when areaId is not a valid UUID', () => {
    const input = { ...validInput(), areaId: 'not-a-uuid' };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when latitude is below -90', () => {
    const input = { ...validInput(), latitude: -91 };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when latitude is above 90', () => {
    const input = { ...validInput(), latitude: 91 };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when longitude is below -180', () => {
    const input = { ...validInput(), longitude: -181 };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should fail when longitude is above 180', () => {
    const input = { ...validInput(), longitude: 181 };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });

  it('should accept boundary latitude values (-90 and 90)', () => {
    const input1 = { ...validInput(), latitude: -90 };
    const input2 = { ...validInput(), latitude: 90 };
    expect(validate(CreateInstitutionSchema, input1).success).toBe(true);
    expect(validate(CreateInstitutionSchema, input2).success).toBe(true);
  });

  it('should accept boundary longitude values (-180 and 180)', () => {
    const input1 = { ...validInput(), longitude: -180 };
    const input2 = { ...validInput(), longitude: 180 };
    expect(validate(CreateInstitutionSchema, input1).success).toBe(true);
    expect(validate(CreateInstitutionSchema, input2).success).toBe(true);
  });

  it('should fail when address exceeds 500 characters', () => {
    const input = { ...validInput(), address: 'x'.repeat(501) };
    const result = validate(CreateInstitutionSchema, input);
    expect(result.success).toBe(false);
  });
});

describe('UpdateInstitutionSchema', () => {
  it('should validate an empty object (no fields to update)', () => {
    const result = validate(UpdateInstitutionSchema, {});
    expect(result.success).toBe(true);
  });

  it('should validate partial updates', () => {
    const result = validate(UpdateInstitutionSchema, { name: 'New Name' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('New Name');
    }
  });

  it('should fail when name is empty string', () => {
    const result = validate(UpdateInstitutionSchema, { name: '' });
    expect(result.success).toBe(false);
  });

  it('should fail when provided areaId is not a valid UUID', () => {
    const result = validate(UpdateInstitutionSchema, { areaId: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should validate all optional fields together', () => {
    const input = {
      name: 'Updated School',
      code: 'UPD-001',
      areaId: uuid(),
      typeId: uuid(),
      sectorId: uuid(),
      ownershipId: uuid(),
      latitude: 51.5074,
      longitude: -0.1278,
      address: 'London, UK',
      contactPhone: '+44-20-1234-5678',
      contactEmail: 'updated@school.org',
    };
    const result = validate(UpdateInstitutionSchema, input);
    expect(result.success).toBe(true);
  });
});

describe('DeactivateInstitutionSchema', () => {
  it('should validate a valid reason', () => {
    const result = validate(DeactivateInstitutionSchema, { reason: 'School closing permanently' });
    expect(result.success).toBe(true);
  });

  it('should fail when reason is missing', () => {
    const result = validate(DeactivateInstitutionSchema, {});
    expect(result.success).toBe(false);
  });

  it('should fail when reason is empty string', () => {
    const result = validate(DeactivateInstitutionSchema, { reason: '' });
    expect(result.success).toBe(false);
  });

  it('should fail when reason exceeds 500 characters', () => {
    const result = validate(DeactivateInstitutionSchema, { reason: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe('InstitutionParamsSchema', () => {
  it('should validate a valid UUID', () => {
    const result = validate(InstitutionParamsSchema, { id: uuid() });
    expect(result.success).toBe(true);
  });

  it('should fail when id is not a valid UUID', () => {
    const result = validate(InstitutionParamsSchema, { id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('should fail when id is missing', () => {
    const result = validate(InstitutionParamsSchema, {});
    expect(result.success).toBe(false);
  });
});

describe('InstitutionListQuerySchema', () => {
  it('should validate an empty query (uses defaults)', () => {
    const result = validate(InstitutionListQuerySchema, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
      expect(result.data.sortBy).toBe('name');
      expect(result.data.sortOrder).toBe('asc');
    }
  });

  it('should validate custom pagination parameters', () => {
    const result = validate(InstitutionListQuerySchema, { page: 3, pageSize: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it('should validate filter parameters', () => {
    const result = validate(InstitutionListQuerySchema, {
      areaId: uuid(),
      status: 'ACTIVE',
      search: 'school',
    });
    expect(result.success).toBe(true);
  });

  it('should fail when page is less than 1', () => {
    const result = validate(InstitutionListQuerySchema, { page: 0 });
    expect(result.success).toBe(false);
  });

  it('should fail when pageSize exceeds 100', () => {
    const result = validate(InstitutionListQuerySchema, { pageSize: 101 });
    expect(result.success).toBe(false);
  });
});
