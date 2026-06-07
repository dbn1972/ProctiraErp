/**
 * Registration Service
 *
 * Business logic for public registration portal operations.
 *
 * Requirements:
 * - 16.1: Public-facing forms with configurable fields per institution type
 * - 16.2: Document upload with file type and size validation
 * - 16.3: Assign tracking number and route to target institution
 * - 16.4: Display institution locations on map with filtering
 * - 16.5: Multi-language interface with session-persisted language selection
 * - 16.6: Check application status by tracking number without authentication
 */
import {
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  RegistrationEntity,
  RegistrationRepository,
  InstitutionLocationFilter,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';
import type {
  SubmitRegistrationInput,
  InstitutionLocation,
  FormConfiguration,
  DocumentUpload,
  RegistrationStatusResponse,
  RegistrationSubmissionResponse,
  SchoolFinderQuery,
} from './schemas.js';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, TRACKING_NUMBER_PREFIX } from './schemas.js';

/**
 * Generates a unique tracking number in the format REG-XXXXXXXX
 * where X is an uppercase alphanumeric character.
 */
export function generateTrackingNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${TRACKING_NUMBER_PREFIX}-${code}`;
}

/**
 * Validates uploaded documents against file type and size constraints.
 * Requirement 16.2: File type and size validation.
 */
export function validateDocuments(documents: DocumentUpload[]): FieldError[] {
  const errors: FieldError[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i]!;

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(doc.fileType as typeof ALLOWED_FILE_TYPES[number])) {
      errors.push({
        field: `documents[${i}].fileType`,
        rule: 'fileType',
        message: `File type '${doc.fileType}' is not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`,
      });
    }

    // Validate file size
    if (doc.fileSize > MAX_FILE_SIZE_BYTES) {
      errors.push({
        field: `documents[${i}].fileSize`,
        rule: 'maxFileSize',
        message: `File size ${doc.fileSize} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (5MB)`,
      });
    }

    // Validate file size is positive
    if (doc.fileSize <= 0) {
      errors.push({
        field: `documents[${i}].fileSize`,
        rule: 'minFileSize',
        message: 'File size must be greater than 0',
      });
    }
  }

  return errors;
}

/**
 * Validates custom field values against form configuration.
 * Requirement 16.1: Configurable fields per institution type.
 */
export function validateCustomFields(
  customFields: Array<{ fieldId: string; value: string | number | boolean | null }>,
  formConfig: FormConfiguration,
): FieldError[] {
  const errors: FieldError[] = [];

  // Check required fields are present
  for (const fieldDef of formConfig.fields) {
    if (fieldDef.required) {
      const provided = customFields.find((f) => f.fieldId === fieldDef.id);
      if (!provided || provided.value === null || provided.value === '') {
        errors.push({
          field: `customFields.${fieldDef.id}`,
          rule: 'required',
          message: `Field '${fieldDef.label}' is required`,
        });
      }
    }
  }

  // Validate provided field values
  for (const field of customFields) {
    const fieldDef = formConfig.fields.find((f) => f.id === field.fieldId);
    if (!fieldDef) {
      errors.push({
        field: `customFields.${field.fieldId}`,
        rule: 'unknownField',
        message: `Unknown field '${field.fieldId}'`,
      });
      continue;
    }

    if (field.value === null || field.value === '') continue;

    // Type-specific validation
    if (fieldDef.type === 'select' && fieldDef.options) {
      const validValues = fieldDef.options.map((o) => o.value);
      if (!validValues.includes(String(field.value))) {
        errors.push({
          field: `customFields.${field.fieldId}`,
          rule: 'invalidOption',
          message: `Invalid option '${field.value}' for field '${fieldDef.label}'`,
        });
      }
    }

    if (fieldDef.validation) {
      const val = field.value;
      if (typeof val === 'string') {
        if (fieldDef.validation.minLength && val.length < fieldDef.validation.minLength) {
          errors.push({
            field: `customFields.${field.fieldId}`,
            rule: 'minLength',
            message: `Field '${fieldDef.label}' must be at least ${fieldDef.validation.minLength} characters`,
          });
        }
        if (fieldDef.validation.maxLength && val.length > fieldDef.validation.maxLength) {
          errors.push({
            field: `customFields.${field.fieldId}`,
            rule: 'maxLength',
            message: `Field '${fieldDef.label}' must be at most ${fieldDef.validation.maxLength} characters`,
          });
        }
      }
      if (typeof val === 'number') {
        if (fieldDef.validation.min !== undefined && val < fieldDef.validation.min) {
          errors.push({
            field: `customFields.${field.fieldId}`,
            rule: 'min',
            message: `Field '${fieldDef.label}' must be at least ${fieldDef.validation.min}`,
          });
        }
        if (fieldDef.validation.max !== undefined && val > fieldDef.validation.max) {
          errors.push({
            field: `customFields.${field.fieldId}`,
            rule: 'max',
            message: `Field '${fieldDef.label}' must be at most ${fieldDef.validation.max}`,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Registration service handling public registration portal operations.
 */
export class RegistrationService {
  constructor(private readonly repository: RegistrationRepository) {}

  /**
   * Submit a new registration application.
   *
   * Validates:
   * - Target institution exists and is active
   * - Documents pass file type and size validation
   * - Custom fields match form configuration for institution type
   * - Assigns a unique tracking number
   *
   * Requirements: 16.1, 16.2, 16.3
   *
   * @throws NotFoundError if institution not found
   * @throws BusinessRuleError if institution is inactive
   * @throws ValidationError if documents or custom fields fail validation
   */
  async submitRegistration(
    tenantId: string,
    input: SubmitRegistrationInput,
  ): Promise<RegistrationSubmissionResponse> {
    // Validate institution exists and is active
    const isActive = await this.repository.isInstitutionActive(input.institutionId);
    if (!isActive) {
      const name = await this.repository.getInstitutionName(input.institutionId);
      if (!name) {
        throw new NotFoundError(`Institution with id '${input.institutionId}' not found`);
      }
      throw new BusinessRuleError('Cannot submit registration to an inactive institution');
    }

    // Validate documents if provided
    if (input.documents && input.documents.length > 0) {
      const docErrors = validateDocuments(input.documents);
      if (docErrors.length > 0) {
        throw new ValidationError('Document validation failed', docErrors);
      }
    }

    // Validate custom fields against form configuration if provided
    if (input.customFields && input.customFields.length > 0) {
      const institutionTypeId = await this.repository.getInstitutionTypeId(input.institutionId);
      if (institutionTypeId) {
        const formConfig = await this.repository.getFormConfiguration(institutionTypeId);
        if (formConfig) {
          const fieldErrors = validateCustomFields(input.customFields, formConfig);
          if (fieldErrors.length > 0) {
            throw new ValidationError('Custom field validation failed', fieldErrors);
          }
        }
      }
    }

    // Generate tracking number
    const trackingNumber = generateTrackingNumber();

    // Get institution name for the response
    const institutionName = (await this.repository.getInstitutionName(input.institutionId)) ?? 'Unknown';

    // Create registration entity
    const entity = await this.repository.create({
      id: uuidv4(),
      tenantId,
      trackingNumber,
      institutionId: input.institutionId,
      institutionName,
      status: 'pending',
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      guardianEmail: input.guardianEmail ?? null,
      customFields: input.customFields ?? [],
      documents: (input.documents ?? []).map((doc) => ({
        fileName: doc.fileName,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        documentType: doc.documentType,
      })),
      preferredLanguage: input.preferredLanguage ?? null,
      remarks: null,
    });

    return {
      id: entity.id,
      trackingNumber: entity.trackingNumber,
      status: entity.status,
      institutionId: entity.institutionId,
      submittedAt: entity.submittedAt.toISOString(),
      message: `Registration submitted successfully. Your tracking number is ${entity.trackingNumber}`,
    };
  }

  /**
   * Check registration status by tracking number.
   * Requirement 16.6: No authentication required.
   *
   * @throws NotFoundError if tracking number not found
   */
  async checkStatus(trackingNumber: string): Promise<RegistrationStatusResponse> {
    const registration = await this.repository.findByTrackingNumber(trackingNumber);
    if (!registration) {
      throw new NotFoundError(`Registration with tracking number '${trackingNumber}' not found`);
    }

    return {
      trackingNumber: registration.trackingNumber,
      status: registration.status,
      institutionName: registration.institutionName,
      applicantName: `${registration.firstName} ${registration.lastName}`,
      submittedAt: registration.submittedAt.toISOString(),
      updatedAt: registration.updatedAt.toISOString(),
      remarks: registration.remarks ?? undefined,
    };
  }

  /**
   * Get institution locations for map display with filtering.
   * Requirement 16.4: Interactive map with area/type/grade filtering.
   */
  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    return this.repository.getInstitutionLocations(tenantId, filter, pagination);
  }

  /**
   * Get form configuration for an institution type.
   * Requirement 16.1: Configurable fields per institution type.
   */
  async getFormConfiguration(institutionId: string): Promise<FormConfiguration | null> {
    const typeId = await this.repository.getInstitutionTypeId(institutionId);
    if (!typeId) return null;
    return this.repository.getFormConfiguration(typeId);
  }

  /**
   * Run a School Finder query.
   *
   * Requirement 16.9: search by geolocation (lat/lon + radius) plus
   * filters by area, type, and grade. Returns paginated results sorted
   * by distance when `near` is provided, alphabetical otherwise.
   *
   * Cross-field validation Typebox cannot express:
   *   • If any of `latitude`, `longitude`, `radiusKm` is set, all three
   *     must be set. The service converts the Typebox-validated query
   *     into the typed filter object the repository expects.
   *
   * @throws ValidationError if the geolocation triple is incomplete.
   */
  async searchSchools(
    tenantId: string,
    query: SchoolFinderQuery,
  ): Promise<{
    data: SchoolFinderResultRow[];
    meta: {
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      origin?: { latitude: number; longitude: number; radiusKm: number };
    };
  }> {
    const hasLat = query.latitude !== undefined;
    const hasLon = query.longitude !== undefined;
    const hasRadius = query.radiusKm !== undefined;

    const geoCount = [hasLat, hasLon, hasRadius].filter(Boolean).length;
    if (geoCount !== 0 && geoCount !== 3) {
      throw new ValidationError('Incomplete geolocation block', [
        {
          field: 'latitude/longitude/radiusKm',
          rule: 'allOrNothing',
          message:
            'When using geolocation, all of latitude, longitude, and radiusKm must be provided',
        },
      ]);
    }

    const filter: SchoolFinderFilter = {};
    if (geoCount === 3) {
      filter.origin = {
        latitude: query.latitude!,
        longitude: query.longitude!,
        radiusKm: query.radiusKm!,
      };
    }
    if (query.areaIds && query.areaIds.length > 0) filter.areaIds = query.areaIds;
    if (query.schoolTypes && query.schoolTypes.length > 0)
      filter.schoolTypes = query.schoolTypes;
    if (query.gradeLevels && query.gradeLevels.length > 0)
      filter.gradeLevels = query.gradeLevels;
    if (query.search && query.search.trim().length > 0)
      filter.search = query.search.trim();

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const result = await this.repository.searchSchools(tenantId, filter, {
      page,
      pageSize,
    });

    return {
      data: result.data,
      meta: {
        ...result.meta,
        ...(filter.origin ? { origin: filter.origin } : {}),
      },
    };
  }
}
