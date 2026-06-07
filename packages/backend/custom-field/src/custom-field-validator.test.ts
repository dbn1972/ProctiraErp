/**
 * Unit tests for Custom Field Value Validator
 */
import { describe, it, expect } from 'vitest';

import { validateCustomFieldValue } from './custom-field-validator.js';
import type { CustomFieldDefinition } from './custom-field-repository.js';

function makeDefinition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    entityType: 'student',
    fieldKey: 'test_field',
    label: 'Test Field',
    description: null,
    fieldType: 'text',
    validationRules: {},
    displayOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('validateCustomFieldValue', () => {
  describe('required rule', () => {
    it('should fail when required field is null', () => {
      const def = makeDefinition({ validationRules: { required: true } });
      const result = validateCustomFieldValue(def, null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('required');
      }
    });

    it('should fail when required field is empty string', () => {
      const def = makeDefinition({ validationRules: { required: true } });
      const result = validateCustomFieldValue(def, '');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('required');
      }
    });

    it('should pass when optional field is null', () => {
      const def = makeDefinition({ validationRules: { required: false } });
      const result = validateCustomFieldValue(def, null);
      expect(result.valid).toBe(true);
    });
  });

  describe('text field type', () => {
    it('should pass for valid text', () => {
      const def = makeDefinition({ fieldType: 'text' });
      const result = validateCustomFieldValue(def, 'hello');
      expect(result.valid).toBe(true);
    });

    it('should fail when value is not a string', () => {
      const def = makeDefinition({ fieldType: 'text' });
      const result = validateCustomFieldValue(def, 123);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });

    it('should enforce minLength', () => {
      const def = makeDefinition({ fieldType: 'text', validationRules: { minLength: 5 } });
      const result = validateCustomFieldValue(def, 'hi');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('minLength');
      }
    });

    it('should enforce maxLength', () => {
      const def = makeDefinition({ fieldType: 'text', validationRules: { maxLength: 3 } });
      const result = validateCustomFieldValue(def, 'toolong');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('maxLength');
      }
    });

    it('should enforce pattern', () => {
      const def = makeDefinition({ fieldType: 'text', validationRules: { pattern: '^[A-Z]+$' } });
      const result = validateCustomFieldValue(def, 'lowercase');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('pattern');
      }
    });

    it('should pass when pattern matches', () => {
      const def = makeDefinition({ fieldType: 'text', validationRules: { pattern: '^[A-Z]+$' } });
      const result = validateCustomFieldValue(def, 'HELLO');
      expect(result.valid).toBe(true);
    });
  });

  describe('number field type', () => {
    it('should pass for valid number', () => {
      const def = makeDefinition({ fieldType: 'number' });
      const result = validateCustomFieldValue(def, 42);
      expect(result.valid).toBe(true);
    });

    it('should fail when value is not a number', () => {
      const def = makeDefinition({ fieldType: 'number' });
      const result = validateCustomFieldValue(def, 'not a number');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });

    it('should fail for NaN', () => {
      const def = makeDefinition({ fieldType: 'number' });
      const result = validateCustomFieldValue(def, NaN);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });

    it('should enforce min', () => {
      const def = makeDefinition({ fieldType: 'number', validationRules: { min: 10 } });
      const result = validateCustomFieldValue(def, 5);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('minimum');
      }
    });

    it('should enforce max', () => {
      const def = makeDefinition({ fieldType: 'number', validationRules: { max: 100 } });
      const result = validateCustomFieldValue(def, 150);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('maximum');
      }
    });
  });

  describe('date field type', () => {
    it('should pass for valid date string', () => {
      const def = makeDefinition({ fieldType: 'date' });
      const result = validateCustomFieldValue(def, '2024-01-15');
      expect(result.valid).toBe(true);
    });

    it('should fail for non-string', () => {
      const def = makeDefinition({ fieldType: 'date' });
      const result = validateCustomFieldValue(def, 12345);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });

    it('should fail for invalid date format', () => {
      const def = makeDefinition({ fieldType: 'date' });
      const result = validateCustomFieldValue(def, '15/01/2024');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('pattern');
      }
    });
  });

  describe('dropdown field type', () => {
    it('should pass for valid option', () => {
      const def = makeDefinition({
        fieldType: 'dropdown',
        validationRules: { options: ['red', 'green', 'blue'] },
      });
      const result = validateCustomFieldValue(def, 'red');
      expect(result.valid).toBe(true);
    });

    it('should fail for invalid option', () => {
      const def = makeDefinition({
        fieldType: 'dropdown',
        validationRules: { options: ['red', 'green', 'blue'] },
      });
      const result = validateCustomFieldValue(def, 'yellow');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('enum');
      }
    });

    it('should fail for non-string value', () => {
      const def = makeDefinition({
        fieldType: 'dropdown',
        validationRules: { options: ['red', 'green', 'blue'] },
      });
      const result = validateCustomFieldValue(def, 123);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });
  });

  describe('checkbox field type', () => {
    it('should pass for boolean true', () => {
      const def = makeDefinition({ fieldType: 'checkbox' });
      const result = validateCustomFieldValue(def, true);
      expect(result.valid).toBe(true);
    });

    it('should pass for boolean false', () => {
      const def = makeDefinition({ fieldType: 'checkbox' });
      const result = validateCustomFieldValue(def, false);
      expect(result.valid).toBe(true);
    });

    it('should fail for non-boolean', () => {
      const def = makeDefinition({ fieldType: 'checkbox' });
      const result = validateCustomFieldValue(def, 'yes');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });
  });

  describe('textarea field type', () => {
    it('should pass for valid text', () => {
      const def = makeDefinition({ fieldType: 'textarea' });
      const result = validateCustomFieldValue(def, 'A long paragraph of text...');
      expect(result.valid).toBe(true);
    });

    it('should enforce maxLength', () => {
      const def = makeDefinition({ fieldType: 'textarea', validationRules: { maxLength: 10 } });
      const result = validateCustomFieldValue(def, 'This is way too long for the limit');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('maxLength');
      }
    });
  });

  describe('file field type', () => {
    it('should pass for valid file object', () => {
      const def = makeDefinition({ fieldType: 'file' });
      const result = validateCustomFieldValue(def, {
        filename: 'document.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      });
      expect(result.valid).toBe(true);
    });

    it('should fail for non-object', () => {
      const def = makeDefinition({ fieldType: 'file' });
      const result = validateCustomFieldValue(def, 'not a file');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('type');
      }
    });

    it('should fail for missing filename', () => {
      const def = makeDefinition({ fieldType: 'file' });
      const result = validateCustomFieldValue(def, { size: 1024 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('required');
      }
    });

    it('should enforce allowed extensions', () => {
      const def = makeDefinition({
        fieldType: 'file',
        validationRules: { allowedExtensions: ['.pdf', '.doc'] },
      });
      const result = validateCustomFieldValue(def, {
        filename: 'image.exe',
        size: 1024,
        mimeType: 'application/octet-stream',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('fileExtension');
      }
    });

    it('should enforce max file size', () => {
      const def = makeDefinition({
        fieldType: 'file',
        validationRules: { maxFileSize: 1000 },
      });
      const result = validateCustomFieldValue(def, {
        filename: 'large.pdf',
        size: 5000,
        mimeType: 'application/pdf',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.rule).toBe('maxFileSize');
      }
    });
  });
});
