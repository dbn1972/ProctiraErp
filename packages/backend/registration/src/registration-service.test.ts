/**
 * Unit tests for RegistrationService
 *
 * Tests cover:
 * - Registration submission with tracking number assignment
 * - Document upload validation (file type and size)
 * - Custom field validation against form configuration
 * - Status check by tracking number
 * - Institution location queries
 * - Error handling for invalid institutions
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';

import { RegistrationService, generateTrackingNumber, validateDocuments, validateCustomFields } from './registration-service.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import type { FormConfiguration } from './schemas.js';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, TRACKING_NUMBER_PREFIX } from './schemas.js';

describe('RegistrationService', () => {
  let service: RegistrationService;
  let repository: InMemoryRegistrationRepository;

  const testTenantId = 'tenant-001';
  const testInstitutionId = '12345678-1234-4123-8123-123456789abc';
  const testInstitutionTypeId = 'type-primary-001';

  beforeEach(() => {
    repository = new InMemoryRegistrationRepository();
    service = new RegistrationService(repository);

    // Seed test institutions
    repository.seedInstitutions([
      {
        id: testInstitutionId,
        name: 'Springfield Elementary',
        code: 'SPR-001',
        typeId: testInstitutionTypeId,
        typeName: 'Primary School',
        areaId: 'area-001',
        areaName: 'Springfield District',
        tenantId: testTenantId,
        status: 'ACTIVE',
        latitude: 39.7817,
        longitude: -89.6501,
        address: '123 School St',
        availableGrades: ['grade-1', 'grade-2', 'grade-3'],
      },
      {
        id: '22345678-1234-4123-8123-123456789abc',
        name: 'Shelbyville High',
        code: 'SHB-001',
        typeId: 'type-secondary-001',
        typeName: 'Secondary School',
        areaId: 'area-002',
        areaName: 'Shelbyville District',
        tenantId: testTenantId,
        status: 'INACTIVE',
        latitude: 39.5,
        longitude: -89.4,
        address: '456 High St',
        availableGrades: ['grade-9', 'grade-10'],
      },
    ]);
  });

  describe('submitRegistration', () => {
    const validInput = {
      institutionId: testInstitutionId,
      firstName: 'Bart',
      lastName: 'Simpson',
      dateOfBirth: '2010-04-01',
      gender: 'male' as const,
      guardianName: 'Homer Simpson',
      guardianPhone: '+1-555-0100',
      guardianEmail: 'homer@springfield.com',
    };

    it('should submit a registration and return a tracking number', async () => {
      const result = await service.submitRegistration(testTenantId, validInput);

      expect(result.id).toBeDefined();
      expect(result.trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
      expect(result.status).toBe('pending');
      expect(result.institutionId).toBe(testInstitutionId);
      expect(result.submittedAt).toBeDefined();
      expect(result.message).toContain(result.trackingNumber);
    });

    it('should store the registration in the repository', async () => {
      await service.submitRegistration(testTenantId, validInput);

      const all = repository.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.firstName).toBe('Bart');
      expect(all[0]!.lastName).toBe('Simpson');
      expect(all[0]!.institutionName).toBe('Springfield Elementary');
    });

    it('should throw NotFoundError for non-existent institution', async () => {
      const input = { ...validInput, institutionId: '99999999-9999-4999-9999-999999999999' };

      await expect(service.submitRegistration(testTenantId, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError for inactive institution', async () => {
      const input = { ...validInput, institutionId: '22345678-1234-4123-8123-123456789abc' };

      await expect(service.submitRegistration(testTenantId, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should validate documents and reject invalid file types', async () => {
      const input = {
        ...validInput,
        documents: [
          {
            fileName: 'malware.exe',
            fileType: 'application/x-executable',
            fileSize: 1024,
            documentType: 'identity_document',
          },
        ],
      };

      await expect(service.submitRegistration(testTenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should validate documents and reject oversized files', async () => {
      const input = {
        ...validInput,
        documents: [
          {
            fileName: 'large-photo.jpg',
            fileType: 'image/jpeg',
            fileSize: MAX_FILE_SIZE_BYTES + 1,
            documentType: 'photo',
          },
        ],
      };

      await expect(service.submitRegistration(testTenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should accept valid documents', async () => {
      const input = {
        ...validInput,
        documents: [
          {
            fileName: 'photo.jpg',
            fileType: 'image/jpeg',
            fileSize: 1024 * 100,
            documentType: 'photo',
          },
          {
            fileName: 'certificate.pdf',
            fileType: 'application/pdf',
            fileSize: 1024 * 500,
            documentType: 'birth_certificate',
          },
        ],
      };

      const result = await service.submitRegistration(testTenantId, input);
      expect(result.trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
    });

    it('should validate custom fields against form configuration', async () => {
      // Seed form configuration with a required field
      repository.seedFormConfigurations([
        {
          institutionTypeId: testInstitutionTypeId,
          fields: [
            {
              id: 'previous_school',
              label: 'Previous School',
              type: 'text',
              required: true,
            },
          ],
        },
      ]);

      const input = {
        ...validInput,
        customFields: [
          { fieldId: 'previous_school', value: null },
        ],
      };

      await expect(service.submitRegistration(testTenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should accept valid custom fields', async () => {
      repository.seedFormConfigurations([
        {
          institutionTypeId: testInstitutionTypeId,
          fields: [
            {
              id: 'previous_school',
              label: 'Previous School',
              type: 'text',
              required: true,
            },
          ],
        },
      ]);

      const input = {
        ...validInput,
        customFields: [
          { fieldId: 'previous_school', value: 'Old School Elementary' },
        ],
      };

      const result = await service.submitRegistration(testTenantId, input);
      expect(result.status).toBe('pending');
    });
  });

  describe('checkStatus', () => {
    it('should return status for a valid tracking number', async () => {
      // Submit a registration first
      const submission = await service.submitRegistration(testTenantId, {
        institutionId: testInstitutionId,
        firstName: 'Lisa',
        lastName: 'Simpson',
        dateOfBirth: '2012-05-09',
        gender: 'female',
        guardianName: 'Marge Simpson',
        guardianPhone: '+1-555-0101',
      });

      const status = await service.checkStatus(submission.trackingNumber);

      expect(status.trackingNumber).toBe(submission.trackingNumber);
      expect(status.status).toBe('pending');
      expect(status.institutionName).toBe('Springfield Elementary');
      expect(status.applicantName).toBe('Lisa Simpson');
      expect(status.submittedAt).toBeDefined();
      expect(status.updatedAt).toBeDefined();
    });

    it('should throw NotFoundError for invalid tracking number', async () => {
      await expect(service.checkStatus('REG-ZZZZZZZZ')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getInstitutionLocations', () => {
    it('should return active institutions for the tenant', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        {},
        { page: 1, pageSize: 50 },
      );

      // Only active institutions should be returned
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('Springfield Elementary');
      expect(result.data[0]!.latitude).toBe(39.7817);
      expect(result.data[0]!.longitude).toBe(-89.6501);
    });

    it('should filter by area', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        { areaId: 'area-001' },
        { page: 1, pageSize: 50 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.areaId).toBe('area-001');
    });

    it('should filter by type', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        { typeId: testInstitutionTypeId },
        { page: 1, pageSize: 50 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.typeId).toBe(testInstitutionTypeId);
    });

    it('should filter by grade', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        { gradeId: 'grade-1' },
        { page: 1, pageSize: 50 },
      );

      expect(result.data).toHaveLength(1);
    });

    it('should return empty for non-matching grade filter', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        { gradeId: 'grade-99' },
        { page: 1, pageSize: 50 },
      );

      expect(result.data).toHaveLength(0);
    });

    it('should filter by search term', async () => {
      const result = await service.getInstitutionLocations(
        testTenantId,
        { search: 'spring' },
        { page: 1, pageSize: 50 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('Springfield Elementary');
    });
  });

  describe('getFormConfiguration', () => {
    it('should return form configuration for an institution', async () => {
      repository.seedFormConfigurations([
        {
          institutionTypeId: testInstitutionTypeId,
          fields: [
            { id: 'field1', label: 'Field 1', type: 'text', required: true },
            { id: 'field2', label: 'Field 2', type: 'select', required: false, options: [{ value: 'a', label: 'A' }] },
          ],
        },
      ]);

      const config = await service.getFormConfiguration(testInstitutionId);

      expect(config).not.toBeNull();
      expect(config!.fields).toHaveLength(2);
      expect(config!.fields[0]!.id).toBe('field1');
    });

    it('should return null for institution with no form config', async () => {
      const config = await service.getFormConfiguration(testInstitutionId);
      expect(config).toBeNull();
    });
  });
});

describe('generateTrackingNumber', () => {
  it('should generate a tracking number with correct format', () => {
    const trackingNumber = generateTrackingNumber();
    expect(trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
  });

  it('should generate unique tracking numbers', () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 100; i++) {
      numbers.add(generateTrackingNumber());
    }
    // With 36^8 possible combinations, 100 should all be unique
    expect(numbers.size).toBe(100);
  });
});

describe('validateDocuments', () => {
  it('should return no errors for valid documents', () => {
    const errors = validateDocuments([
      { fileName: 'photo.jpg', fileType: 'image/jpeg', fileSize: 1024, documentType: 'photo' },
      { fileName: 'cert.pdf', fileType: 'application/pdf', fileSize: 2048, documentType: 'certificate' },
    ]);
    expect(errors).toHaveLength(0);
  });

  it('should return error for invalid file type', () => {
    const errors = validateDocuments([
      { fileName: 'script.sh', fileType: 'application/x-sh', fileSize: 100, documentType: 'other' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe('fileType');
  });

  it('should return error for oversized file', () => {
    const errors = validateDocuments([
      { fileName: 'big.jpg', fileType: 'image/jpeg', fileSize: MAX_FILE_SIZE_BYTES + 1, documentType: 'photo' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe('maxFileSize');
  });

  it('should return multiple errors for multiple invalid documents', () => {
    const errors = validateDocuments([
      { fileName: 'bad.exe', fileType: 'application/x-executable', fileSize: MAX_FILE_SIZE_BYTES + 1, documentType: 'other' },
    ]);
    expect(errors).toHaveLength(2); // Both type and size errors
  });
});

describe('validateCustomFields', () => {
  const formConfig: FormConfiguration = {
    institutionTypeId: 'type-001',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true, validation: { minLength: 2, maxLength: 50 } },
      { id: 'grade', label: 'Grade', type: 'select', required: true, options: [{ value: '1', label: 'Grade 1' }, { value: '2', label: 'Grade 2' }] },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false },
    ],
  };

  it('should return no errors for valid fields', () => {
    const errors = validateCustomFields(
      [
        { fieldId: 'name', value: 'John' },
        { fieldId: 'grade', value: '1' },
      ],
      formConfig,
    );
    expect(errors).toHaveLength(0);
  });

  it('should return error for missing required field', () => {
    const errors = validateCustomFields(
      [{ fieldId: 'name', value: 'John' }],
      formConfig,
    );
    expect(errors.some((e) => e.field === 'customFields.grade' && e.rule === 'required')).toBe(true);
  });

  it('should return error for invalid select option', () => {
    const errors = validateCustomFields(
      [
        { fieldId: 'name', value: 'John' },
        { fieldId: 'grade', value: '99' },
      ],
      formConfig,
    );
    expect(errors.some((e) => e.rule === 'invalidOption')).toBe(true);
  });

  it('should return error for unknown field', () => {
    const errors = validateCustomFields(
      [
        { fieldId: 'name', value: 'John' },
        { fieldId: 'grade', value: '1' },
        { fieldId: 'unknown_field', value: 'test' },
      ],
      formConfig,
    );
    expect(errors.some((e) => e.rule === 'unknownField')).toBe(true);
  });

  it('should return error for value below minLength', () => {
    const errors = validateCustomFields(
      [
        { fieldId: 'name', value: 'J' },
        { fieldId: 'grade', value: '1' },
      ],
      formConfig,
    );
    expect(errors.some((e) => e.rule === 'minLength')).toBe(true);
  });
});
