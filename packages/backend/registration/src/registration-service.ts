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
import { createHash, randomInt } from 'node:crypto';

import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  InMemoryAdmissionsCrmStore,
  type AdmissionsCrmStore,
  type WaitlistEntry,
} from './admissions-crm-store.js';
import type {
  RegistrationRepository,
  InstitutionLocationFilter,
  NewRegistrationEntity,
  SchoolFinderFilter,
  SchoolFinderResultRow,
  RegistrationStatus,
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
 * Uses CSPRNG (node:crypto randomInt) for public identifier entropy.
 */
export function generateTrackingNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(randomInt(chars.length));
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
    if (!ALLOWED_FILE_TYPES.includes(doc.fileType as (typeof ALLOWED_FILE_TYPES)[number])) {
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
  const seenFieldIds = new Set<string>();
  for (const field of customFields) {
    if (seenFieldIds.has(field.fieldId)) {
      errors.push({
        field: `customFields.${field.fieldId}`,
        rule: 'duplicateField',
        message: `Field '${field.fieldId}' must be provided only once`,
      });
    }
    seenFieldIds.add(field.fieldId);
  }

  // Check required non-file fields are present. File requirements are matched
  // against documentType by validateConfiguredDocuments().
  for (const fieldDef of formConfig.fields) {
    if (fieldDef.type === 'file') continue;
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
    const fieldDef = formConfig.fields.find(
      (definition) => definition.id === field.fieldId && definition.type !== 'file',
    );
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

/** Match configured file fields to submitted documentType values. */
export function validateConfiguredDocuments(
  documents: DocumentUpload[],
  formConfig: FormConfiguration,
): FieldError[] {
  const errors: FieldError[] = [];
  const configuredFiles = formConfig.fields.filter((field) => field.type === 'file');
  const configuredIds = new Set(configuredFiles.map((field) => field.id));
  const seen = new Set<string>();

  for (const document of documents) {
    if (seen.has(document.documentType)) {
      errors.push({
        field: `documents.${document.documentType}`,
        rule: 'duplicateDocument',
        message: `Document '${document.documentType}' must be provided only once`,
      });
    }
    seen.add(document.documentType);
    if (!configuredIds.has(document.documentType)) {
      errors.push({
        field: `documents.${document.documentType}`,
        rule: 'unknownDocument',
        message: `Document '${document.documentType}' is not requested by this application form`,
      });
    }
  }

  for (const field of configuredFiles) {
    if (field.required && !seen.has(field.id)) {
      errors.push({
        field: `documents.${field.id}`,
        rule: 'required',
        message: `Document '${field.label}' is required`,
      });
    }
  }
  return errors;
}

/** Stable material-payload digest used by durable idempotency conflict checks. */
export function computeSubmissionPayloadHash(input: SubmitRegistrationInput): string {
  const customFields = [...(input.customFields ?? [])]
    .map((field) => ({ fieldId: field.fieldId, value: field.value }))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  const documents = [...(input.documents ?? [])]
    .map((document) => ({
      fileName: document.fileName,
      fileType: document.fileType,
      fileSize: document.fileSize,
      documentType: document.documentType,
      contentSha256:
        document.content === undefined
          ? null
          : createHash('sha256').update(document.content).digest('hex'),
    }))
    .sort((a, b) =>
      `${a.documentType}\u0000${a.fileName}`.localeCompare(`${b.documentType}\u0000${b.fileName}`),
    );

  const canonical = {
    institutionId: input.institutionId,
    formConfigurationId: input.formConfigurationId,
    formConfigurationVersion: input.formConfigurationVersion,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    guardianName: input.guardianName,
    guardianPhone: input.guardianPhone,
    guardianEmail: input.guardianEmail ?? null,
    customFields,
    documents,
    preferredLanguage: input.preferredLanguage ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Registration service handling public registration portal operations.
 */
export class RegistrationService {
  private readonly crm: AdmissionsCrmStore;

  constructor(
    private readonly repository: RegistrationRepository,
    crmStore?: AdmissionsCrmStore,
  ) {
    this.crm = crmStore ?? new InMemoryAdmissionsCrmStore();
  }

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
    submissionKey: string,
  ): Promise<RegistrationSubmissionResponse & { replayed: boolean }> {
    const institution = await this.repository.findInstitution(tenantId, input.institutionId);
    if (!institution) {
      throw new NotFoundError('Selected institution is unavailable');
    }
    if (institution.status !== 'ACTIVE') {
      throw new BusinessRuleError('Cannot submit registration to an inactive institution');
    }

    let formConfig: FormConfiguration | null;
    try {
      formConfig = await this.repository.getFormConfiguration(
        tenantId,
        input.institutionId,
        input.formConfigurationId,
      );
    } catch {
      throw new AppError(
        'Registration form configuration is temporarily unavailable',
        'FORM_CONFIGURATION_UNAVAILABLE',
        503,
      );
    }
    if (!formConfig) {
      throw new AppError(
        'The selected registration form is no longer available. Reload the application before submitting.',
        'FORM_CONFIGURATION_NOT_FOUND',
        409,
      );
    }
    if (formConfig.version !== input.formConfigurationVersion) {
      throw new AppError(
        'The registration form version changed. Reload the application before submitting.',
        'FORM_CONFIGURATION_VERSION_CONFLICT',
        409,
      );
    }

    const documents = input.documents ?? [];
    const fieldErrors = [
      ...validateDocuments(documents),
      ...validateConfiguredDocuments(documents, formConfig),
      ...validateCustomFields(input.customFields ?? [], formConfig),
    ];
    if (fieldErrors.length > 0) {
      throw new ValidationError('Registration form validation failed', fieldErrors);
    }

    const entity: NewRegistrationEntity = {
      id: uuidv4(),
      tenantId,
      trackingNumber: generateTrackingNumber(),
      institutionId: input.institutionId,
      status: 'pending',
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      guardianEmail: input.guardianEmail ?? null,
      customFields: input.customFields ?? [],
      documents: documents.map((document) => ({
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        documentType: document.documentType,
      })),
      preferredLanguage: input.preferredLanguage ?? null,
      remarks: null,
      formConfigurationId: formConfig.id,
      formConfigurationVersion: formConfig.version,
      submissionKey,
      submissionPayloadHash: computeSubmissionPayloadHash(input),
    };

    const created = await this.repository.createIdempotent(entity);
    if (created.outcome === 'payload_conflict') {
      throw new AppError(
        'This submission key was already used for a different application payload.',
        'IDEMPOTENCY_KEY_REUSED',
        409,
      );
    }
    if (created.outcome === 'context_unavailable') {
      throw new ConflictError(
        'The selected institution or registration form is no longer available. Reload before submitting.',
      );
    }

    const registration = created.registration;
    return {
      id: registration.id,
      trackingNumber: registration.trackingNumber,
      status: registration.status,
      institutionId: registration.institutionId,
      submittedAt: registration.submittedAt.toISOString(),
      message: `Registration submitted successfully. Your tracking number is ${registration.trackingNumber}`,
      replayed: created.outcome === 'replayed',
    };
  }

  /**
   * Check registration status by tracking number.
   * Requirement 16.6: No authentication required.
   *
   * @throws NotFoundError if tracking number not found
   */
  async checkStatus(
    trackingNumber: string,
    dateOfBirth?: string,
    tenantId?: string,
  ): Promise<RegistrationStatusResponse> {
    const registration = await this.repository.findByTrackingNumber(trackingNumber, tenantId);
    if (!registration) {
      throw new NotFoundError(`Registration with tracking number '${trackingNumber}' not found`);
    }

    // Require DOB match so tracking numbers alone cannot disclose applicant PII.
    // Missing or mismatched DOB returns the same NotFoundError (no oracle).
    if (!dateOfBirth || dateOfBirth !== registration.dateOfBirth) {
      throw new NotFoundError(`Registration with tracking number '${trackingNumber}' not found`);
    }

    const [waitlist, bookings] = await Promise.all([
      this.crm.listWaitlist(registration.tenantId, registration.institutionId),
      this.crm.listBookingsForApplication(registration.tenantId, registration.id),
    ]);

    return {
      trackingNumber: registration.trackingNumber,
      status: registration.status,
      institutionName: registration.institutionName,
      applicantName: `${registration.firstName} ${registration.lastName}`,
      submittedAt: registration.submittedAt.toISOString(),
      updatedAt: registration.updatedAt.toISOString(),
      remarks: registration.remarks ?? undefined,
      waitlistPosition:
        waitlist.find((row) => row.applicationId === registration.id)?.position ?? undefined,
      interviewBookings: bookings
        .filter((row) => row.status === 'booked')
        .map((row) => ({
          id: row.id,
          slotId: row.slotId,
          status: row.status,
        })),
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
   * Get the latest published form configuration for an institution UUID.
   * Repository/configuration outages fail closed instead of becoming an empty form.
   */
  async getFormConfiguration(
    tenantId: string,
    institutionId: string,
  ): Promise<FormConfiguration | null> {
    try {
      const institution = await this.repository.findInstitution(tenantId, institutionId);
      if (!institution || institution.status !== 'ACTIVE') return null;
      return await this.repository.getFormConfiguration(tenantId, institutionId);
    } catch {
      throw new AppError(
        'Registration form configuration is temporarily unavailable',
        'FORM_CONFIGURATION_UNAVAILABLE',
        503,
      );
    }
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
    if (query.schoolTypes && query.schoolTypes.length > 0) filter.schoolTypes = query.schoolTypes;
    if (query.gradeLevels && query.gradeLevels.length > 0) filter.gradeLevels = query.gradeLevels;
    if (query.search && query.search.trim().length > 0) filter.search = query.search.trim();

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

  /** Staff CRM: list applications for a tenant. */
  async listApplications(tenantId: string) {
    return this.repository.listByTenant(tenantId);
  }

  /**
   * Staff CRM: update application status. Setting `waitlisted` also enqueues
   * a waitlist entry for the application's institution.
   */
  async updateApplicationStatus(
    tenantId: string,
    applicationId: string,
    status: RegistrationStatus,
    remarks?: string,
  ) {
    const application = await this.repository.findById(applicationId, tenantId);
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundError(`Application with id '${applicationId}' not found`);
    }

    const updated = await this.repository.updateStatus(applicationId, status, remarks, tenantId);
    if (!updated) {
      throw new NotFoundError(`Application with id '${applicationId}' not found`);
    }

    let waitlistEntry: WaitlistEntry | null = null;
    if (status === 'waitlisted') {
      waitlistEntry = await this.crm.enqueueWaitlist({
        tenantId,
        applicationId,
        institutionId: application.institutionId,
        notes: remarks ?? null,
      });
    }

    return { application: updated, waitlistEntry };
  }

  async listWaitlist(tenantId: string, institutionId?: string) {
    return this.crm.listWaitlist(tenantId, institutionId);
  }

  async createInterviewSlot(
    tenantId: string,
    input: {
      institutionId: string;
      startsAt: string;
      endsAt: string;
      capacity?: number;
      location?: string | null;
    },
  ) {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new BusinessRuleError('Interview slot end must be after start');
    }
    return this.crm.createSlot({ tenantId, ...input });
  }

  async listInterviewSlots(tenantId: string, institutionId?: string) {
    return this.crm.listSlots(tenantId, institutionId);
  }

  async bookInterview(tenantId: string, input: { slotId: string; applicationId: string }) {
    const application = await this.repository.findById(input.applicationId, tenantId);
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundError(`Application with id '${input.applicationId}' not found`);
    }

    const slot = await this.crm.findSlot(input.slotId, tenantId);
    if (!slot || slot.status !== 'open') {
      throw new NotFoundError(`Interview slot with id '${input.slotId}' not found`);
    }

    const booked = await this.crm.listBookingsForSlot(tenantId, slot.id);
    if (booked.length >= slot.capacity) {
      throw new BusinessRuleError('Interview slot is at capacity');
    }

    const existing = (
      await this.crm.listBookingsForApplication(tenantId, input.applicationId)
    ).find((row) => row.slotId === slot.id && row.status === 'booked');
    if (existing) {
      return existing;
    }

    return this.crm.bookSlot({
      tenantId,
      slotId: slot.id,
      applicationId: input.applicationId,
    });
  }
}
