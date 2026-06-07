/**
 * Unit tests for Custom Field Service
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import { CustomFieldService } from './custom-field-service.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';
import type { CreateCustomFieldDefinitionInput } from './schemas.js';

const TENANT_ID = 'tenant-1';

describe('CustomFieldService', () => {
  let service: CustomFieldService;
  let definitionRepo: InMemoryCustomFieldDefinitionRepository;
  let valueRepo: InMemoryCustomFieldValueRepository;

  beforeEach(() => {
    definitionRepo = new InMemoryCustomFieldDefinitionRepository();
    valueRepo = new InMemoryCustomFieldValueRepository();
    service = new CustomFieldService(definitionRepo, valueRepo);
  });

  describe('createDefinition', () => {
    it('should create a text field definition', async () => {
      const input: CreateCustomFieldDefinitionInput = {
        entityType: 'student',
        fieldKey: 'blood_type',
        label: 'Blood Type',
        fieldType: 'text',
        validationRules: { maxLength: 5 },
      };

      const result = await service.createDefinition(TENANT_ID, input);

      expect(result.id).toBeDefined();
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.entityType).toBe('student');
      expect(result.fieldKey).toBe('blood_type');
      expect(result.label).toBe('Blood Type');
      expect(result.fieldType).toBe('text');
      expect(result.validationRules).toEqual({ maxLength: 5 });
      expect(result.isActive).toBe(true);
    });

    it('should create a dropdown field definition with options', async () => {
      const input: CreateCustomFieldDefinitionInput = {
        entityType: 'staff',
        fieldKey: 'department',
        label: 'Department',
        fieldType: 'dropdown',
        validationRules: { options: ['HR', 'IT', 'Finance'] },
      };

      const result = await service.createDefinition(TENANT_ID, input);
      expect(result.fieldType).toBe('dropdown');
      expect(result.validationRules.options).toEqual(['HR', 'IT', 'Finance']);
    });

    it('should reject duplicate field key for same entity type', async () => {
      const input: CreateCustomFieldDefinitionInput = {
        entityType: 'student',
        fieldKey: 'blood_type',
        label: 'Blood Type',
        fieldType: 'text',
      };

      await service.createDefinition(TENANT_ID, input);

      await expect(
        service.createDefinition(TENANT_ID, input),
      ).rejects.toThrow(ConflictError);
    });

    it('should allow same field key for different entity types', async () => {
      const studentInput: CreateCustomFieldDefinitionInput = {
        entityType: 'student',
        fieldKey: 'emergency_contact',
        label: 'Emergency Contact',
        fieldType: 'text',
      };

      const staffInput: CreateCustomFieldDefinitionInput = {
        entityType: 'staff',
        fieldKey: 'emergency_contact',
        label: 'Emergency Contact',
        fieldType: 'text',
      };

      const student = await service.createDefinition(TENANT_ID, studentInput);
      const staff = await service.createDefinition(TENANT_ID, staffInput);

      expect(student.id).not.toBe(staff.id);
    });

    it('should reject dropdown without options', async () => {
      const input: CreateCustomFieldDefinitionInput = {
        entityType: 'student',
        fieldKey: 'category',
        label: 'Category',
        fieldType: 'dropdown',
        validationRules: {},
      };

      await expect(
        service.createDefinition(TENANT_ID, input),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateDefinition', () => {
    it('should update label and description', async () => {
      const created = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'nickname',
        label: 'Nickname',
        fieldType: 'text',
      });

      const updated = await service.updateDefinition(TENANT_ID, created.id, {
        label: 'Preferred Name',
        description: 'The name the student prefers to be called',
      });

      expect(updated.label).toBe('Preferred Name');
      expect(updated.description).toBe('The name the student prefers to be called');
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.updateDefinition(TENANT_ID, '00000000-0000-4000-8000-000000000099', {
          label: 'Updated',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getDefinitionById', () => {
    it('should return the definition', async () => {
      const created = await service.createDefinition(TENANT_ID, {
        entityType: 'institution',
        fieldKey: 'accreditation_number',
        label: 'Accreditation Number',
        fieldType: 'text',
      });

      const found = await service.getDefinitionById(TENANT_ID, created.id);
      expect(found.id).toBe(created.id);
      expect(found.fieldKey).toBe('accreditation_number');
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.getDefinitionById(TENANT_ID, '00000000-0000-4000-8000-000000000099'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listDefinitions', () => {
    it('should list definitions with pagination', async () => {
      await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'field_a',
        label: 'Field A',
        fieldType: 'text',
        displayOrder: 1,
      });
      await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'field_b',
        label: 'Field B',
        fieldType: 'number',
        displayOrder: 2,
      });
      await service.createDefinition(TENANT_ID, {
        entityType: 'staff',
        fieldKey: 'field_c',
        label: 'Field C',
        fieldType: 'text',
        displayOrder: 0,
      });

      const result = await service.listDefinitions(
        TENANT_ID,
        { entityType: 'student' },
        { page: 1, pageSize: 10 },
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('should filter by active status', async () => {
      const created = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'inactive_field',
        label: 'Inactive',
        fieldType: 'text',
      });
      await service.deleteDefinition(TENANT_ID, created.id);

      await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'active_field',
        label: 'Active',
        fieldType: 'text',
      });

      const activeResult = await service.listDefinitions(
        TENANT_ID,
        { isActive: true },
        { page: 1, pageSize: 10 },
      );
      expect(activeResult.data).toHaveLength(1);
      expect(activeResult.data[0]!.fieldKey).toBe('active_field');
    });
  });

  describe('deleteDefinition', () => {
    it('should soft-delete (deactivate) a definition', async () => {
      const created = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'to_delete',
        label: 'To Delete',
        fieldType: 'text',
      });

      await service.deleteDefinition(TENANT_ID, created.id);

      const found = await service.getDefinitionById(TENANT_ID, created.id);
      expect(found.isActive).toBe(false);
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      await expect(
        service.deleteDefinition(TENANT_ID, '00000000-0000-4000-8000-000000000099'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('setValue', () => {
    it('should set a valid text value', async () => {
      const def = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'blood_type',
        label: 'Blood Type',
        fieldType: 'text',
        validationRules: { maxLength: 5 },
      });

      const entityId = '00000000-0000-4000-8000-000000000010';
      const result = await service.setValue(TENANT_ID, 'student', entityId, def.id, 'A+');

      expect(result.value).toBe('A+');
      expect(result.entityId).toBe(entityId);
      expect(result.fieldDefinitionId).toBe(def.id);
    });

    it('should reject invalid value', async () => {
      const def = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'age',
        label: 'Age',
        fieldType: 'number',
        validationRules: { min: 0, max: 150 },
      });

      const entityId = '00000000-0000-4000-8000-000000000010';

      await expect(
        service.setValue(TENANT_ID, 'student', entityId, def.id, 'not a number'),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject value for wrong entity type', async () => {
      const def = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'student_only',
        label: 'Student Only',
        fieldType: 'text',
      });

      const entityId = '00000000-0000-4000-8000-000000000010';

      await expect(
        service.setValue(TENANT_ID, 'staff', entityId, def.id, 'value'),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError for non-existent definition', async () => {
      const entityId = '00000000-0000-4000-8000-000000000010';

      await expect(
        service.setValue(TENANT_ID, 'student', entityId, '00000000-0000-4000-8000-000000000099', 'value'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('bulkSetValues', () => {
    it('should set multiple values at once', async () => {
      const def1 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'blood_type',
        label: 'Blood Type',
        fieldType: 'text',
      });
      const def2 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'height_cm',
        label: 'Height (cm)',
        fieldType: 'number',
        validationRules: { min: 0, max: 300 },
      });

      const entityId = '00000000-0000-4000-8000-000000000010';
      const results = await service.bulkSetValues(TENANT_ID, 'student', entityId, {
        [def1.id]: 'O+',
        [def2.id]: 175,
      });

      expect(results).toHaveLength(2);
    });

    it('should reject all values if any are invalid', async () => {
      const def1 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'name_field',
        label: 'Name',
        fieldType: 'text',
      });
      const def2 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'age_field',
        label: 'Age',
        fieldType: 'number',
      });

      const entityId = '00000000-0000-4000-8000-000000000010';

      await expect(
        service.bulkSetValues(TENANT_ID, 'student', entityId, {
          [def1.id]: 'Valid Name',
          [def2.id]: 'not a number', // invalid
        }),
      ).rejects.toThrow(ValidationError);

      // Verify no values were stored
      const values = await service.getValuesForEntity(TENANT_ID, 'student', entityId);
      expect(values).toHaveLength(0);
    });
  });

  describe('getValuesForEntity', () => {
    it('should return all values for an entity', async () => {
      const def = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'blood_type',
        label: 'Blood Type',
        fieldType: 'text',
      });

      const entityId = '00000000-0000-4000-8000-000000000010';
      await service.setValue(TENANT_ID, 'student', entityId, def.id, 'AB-');

      const values = await service.getValuesForEntity(TENANT_ID, 'student', entityId);
      expect(values).toHaveLength(1);
      expect(values[0]!.value).toBe('AB-');
    });

    it('should return empty array for entity with no values', async () => {
      const entityId = '00000000-0000-4000-8000-000000000099';
      const values = await service.getValuesForEntity(TENANT_ID, 'student', entityId);
      expect(values).toHaveLength(0);
    });
  });

  describe('deleteValuesForEntity', () => {
    it('should delete all values for an entity', async () => {
      const def1 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'field_x',
        label: 'Field X',
        fieldType: 'text',
      });
      const def2 = await service.createDefinition(TENANT_ID, {
        entityType: 'student',
        fieldKey: 'field_y',
        label: 'Field Y',
        fieldType: 'number',
      });

      const entityId = '00000000-0000-4000-8000-000000000010';
      await service.setValue(TENANT_ID, 'student', entityId, def1.id, 'value1');
      await service.setValue(TENANT_ID, 'student', entityId, def2.id, 42);

      const count = await service.deleteValuesForEntity(TENANT_ID, 'student', entityId);
      expect(count).toBe(2);

      const values = await service.getValuesForEntity(TENANT_ID, 'student', entityId);
      expect(values).toHaveLength(0);
    });
  });
});
