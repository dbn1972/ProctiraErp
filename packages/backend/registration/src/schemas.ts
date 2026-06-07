/**
 * Typebox schemas for Registration Service request/response validation.
 *
 * Defines schemas for:
 * - SubmitRegistration (body)
 * - RegistrationStatusQuery (params)
 * - InstitutionMapQuery (querystring)
 * - LanguageSelection (body)
 * - DocumentUpload validation
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import { Type, type Static } from '@sinclair/typebox';

// --- Constants ---

/** Allowed file MIME types for document uploads */
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** Maximum file size in bytes (5MB) */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Tracking number prefix */
export const TRACKING_NUMBER_PREFIX = 'REG';

// --- Registration Submission ---

/**
 * Schema for a single document upload metadata.
 */
export const DocumentUploadSchema = Type.Object({
  fileName: Type.String({ minLength: 1, maxLength: 255, description: 'Original file name' }),
  fileType: Type.String({
    description: 'MIME type of the uploaded file',
  }),
  fileSize: Type.Number({ minimum: 1, description: 'File size in bytes' }),
  documentType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Type of document (e.g., photo, birth_certificate, identity_document)',
  }),
  /** Base64-encoded file content (for in-memory testing; real impl uses multipart) */
  content: Type.Optional(Type.String({ description: 'Base64-encoded file content' })),
});

export type DocumentUpload = Static<typeof DocumentUploadSchema>;

/**
 * Schema for a configurable registration field value.
 */
export const RegistrationFieldValueSchema = Type.Object({
  fieldId: Type.String({ minLength: 1, description: 'Configurable field identifier' }),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()], {
    description: 'Field value',
  }),
});

export type RegistrationFieldValue = Static<typeof RegistrationFieldValueSchema>;

/**
 * Schema for submitting a registration application.
 * Requirement 16.1: Public-facing forms with configurable fields per institution type.
 * Requirement 16.2: Document upload with file type and size validation.
 * Requirement 16.3: Assign tracking number and route to target institution.
 */
export const SubmitRegistrationSchema = Type.Object({
  /** Target institution ID */
  institutionId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Target institution UUID',
  }),
  /** Student/applicant first name */
  firstName: Type.String({ minLength: 1, maxLength: 100, description: 'Applicant first name' }),
  /** Student/applicant last name */
  lastName: Type.String({ minLength: 1, maxLength: 100, description: 'Applicant last name' }),
  /** Date of birth (ISO date string) */
  dateOfBirth: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Date of birth (YYYY-MM-DD)',
  }),
  /** Gender */
  gender: Type.String({
    enum: ['male', 'female', 'other'],
    description: 'Applicant gender',
  }),
  /** Guardian/parent name */
  guardianName: Type.String({ minLength: 1, maxLength: 200, description: 'Guardian/parent name' }),
  /** Guardian contact phone */
  guardianPhone: Type.String({ minLength: 1, maxLength: 50, description: 'Guardian phone number' }),
  /** Guardian contact email (optional) */
  guardianEmail: Type.Optional(
    Type.String({
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      maxLength: 254,
      description: 'Guardian email address',
    }),
  ),
  /** Configurable fields based on institution type */
  customFields: Type.Optional(
    Type.Array(RegistrationFieldValueSchema, { description: 'Configurable field values' }),
  ),
  /** Uploaded documents metadata */
  documents: Type.Optional(
    Type.Array(DocumentUploadSchema, {
      maxItems: 10,
      description: 'Uploaded document metadata',
    }),
  ),
  /** Preferred language for communication */
  preferredLanguage: Type.Optional(
    Type.String({ minLength: 2, maxLength: 10, description: 'Preferred language code (e.g., en, ar, fr)' }),
  ),
});

export type SubmitRegistrationInput = Static<typeof SubmitRegistrationSchema>;

// --- Registration Status Check ---

/**
 * Schema for tracking number path parameter.
 * Requirement 16.6: Check status by tracking number without authentication.
 */
export const TrackingNumberParamsSchema = Type.Object({
  trackingNumber: Type.String({
    pattern: '^REG-[A-Z0-9]{8}$',
    description: 'Registration tracking number (e.g., REG-A1B2C3D4)',
  }),
});

export type TrackingNumberParams = Static<typeof TrackingNumberParamsSchema>;

// --- Institution Map Query ---

/**
 * Schema for institution location query parameters.
 * Requirement 16.4: Display institutions on map with filtering by area, type, and grades.
 */
export const InstitutionMapQuerySchema = Type.Object({
  /** Filter by area ID */
  areaId: Type.Optional(Type.String({ description: 'Filter by area hierarchy node ID' })),
  /** Filter by institution type ID */
  typeId: Type.Optional(Type.String({ description: 'Filter by institution type ID' })),
  /** Filter by available grade ID */
  gradeId: Type.Optional(Type.String({ description: 'Filter by available education grade ID' })),
  /** Search by institution name */
  search: Type.Optional(Type.String({ maxLength: 200, description: 'Search by institution name' })),
  /** Page number */
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number' })),
  /** Page size */
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50, description: 'Items per page' })),
});

export type InstitutionMapQuery = Static<typeof InstitutionMapQuerySchema>;

// --- School Finder Query ---

/**
 * Schema for School Finder query parameters.
 *
 * Requirement 16.9: School Finder allows applicants to search by
 * geolocation (lat/lon + radius) plus filters by area, type, and grade.
 *
 * Both the geolocation block and each filter list are optional, but
 * the `latitude`/`longitude`/`radiusKm` triple is all-or-nothing —
 * see the runtime guard in the service for the cross-field validation
 * Typebox cannot express directly.
 *
 * Design §F (`SchoolFinderQuery`).
 */
export const SchoolFinderQuerySchema = Type.Object({
  /** Applicant latitude (degrees). When provided, longitude + radiusKm must also be set. */
  latitude: Type.Optional(
    Type.Number({ minimum: -90, maximum: 90, description: 'Applicant latitude (degrees)' }),
  ),
  /** Applicant longitude (degrees). When provided, latitude + radiusKm must also be set. */
  longitude: Type.Optional(
    Type.Number({ minimum: -180, maximum: 180, description: 'Applicant longitude (degrees)' }),
  ),
  /** Search radius in kilometres. Required when latitude/longitude are present. */
  radiusKm: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 1000,
      description: 'Search radius in kilometres (max 1000)',
    }),
  ),
  /** Filter by one or more area hierarchy node IDs. */
  areaIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 50,
      description: 'Filter by area hierarchy node IDs',
    }),
  ),
  /** Filter by one or more institution type IDs. */
  schoolTypes: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 50,
      description: 'Filter by institution type IDs',
    }),
  ),
  /** Filter by one or more education grade IDs that the institution must offer. */
  gradeLevels: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 100,
      description: 'Filter by available education grade IDs',
    }),
  ),
  /** Search by institution name (case-insensitive substring). */
  search: Type.Optional(
    Type.String({ maxLength: 200, description: 'Search by institution name' }),
  ),
  /** Page number (1-based). */
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number' }),
  ),
  /** Page size (capped to keep the network payload small). */
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
});

export type SchoolFinderQuery = Static<typeof SchoolFinderQuerySchema>;

/**
 * Single result row for the School Finder.
 *
 * `distanceKm` is only populated when the query carried a geolocation
 * block. Results are sorted by `distanceKm` ascending in that case;
 * otherwise the API falls back to alphabetical name order.
 *
 * Design §F (`SchoolFinderResult`).
 */
export const SchoolFinderResultSchema = Type.Object({
  id: Type.String({ description: 'Institution UUID' }),
  name: Type.String({ description: 'Institution name' }),
  code: Type.String({ description: 'Institution code' }),
  typeId: Type.String({ description: 'Institution type UUID' }),
  typeName: Type.Optional(Type.String({ description: 'Institution type name' })),
  areaId: Type.String({ description: 'Area UUID' }),
  areaName: Type.Optional(Type.String({ description: 'Area name' })),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  availableGrades: Type.Optional(Type.Array(Type.String())),
  /** Distance from query origin in kilometres, only when geolocation was provided. */
  distanceKm: Type.Optional(Type.Number({ minimum: 0 })),
});

export type SchoolFinderResult = Static<typeof SchoolFinderResultSchema>;

/**
 * Paginated response for `/registrations/schools/search`.
 */
export const SchoolFinderResponseSchema = Type.Object({
  data: Type.Array(SchoolFinderResultSchema),
  meta: Type.Object({
    page: Type.Number(),
    pageSize: Type.Number(),
    totalItems: Type.Number(),
    totalPages: Type.Number(),
    /** Echoed origin for display / sanity checks. */
    origin: Type.Optional(
      Type.Object({
        latitude: Type.Number(),
        longitude: Type.Number(),
        radiusKm: Type.Number(),
      }),
    ),
  }),
});

export type SchoolFinderResponse = Static<typeof SchoolFinderResponseSchema>;

// --- Language Selection ---

/**
 * Schema for language selection.
 * Requirement 16.5: Multi-language interface with session-persisted language selection.
 */
export const LanguageSelectionSchema = Type.Object({
  language: Type.String({
    minLength: 2,
    maxLength: 10,
    description: 'Language code (e.g., en, ar, fr, es)',
  }),
});

export type LanguageSelection = Static<typeof LanguageSelectionSchema>;

// --- Form Configuration ---

/**
 * Schema for a configurable registration form field definition.
 */
export const FormFieldDefinitionSchema = Type.Object({
  id: Type.String({ description: 'Field identifier' }),
  label: Type.String({ description: 'Display label' }),
  type: Type.String({
    enum: ['text', 'number', 'date', 'select', 'checkbox', 'textarea', 'file'],
    description: 'Field input type',
  }),
  required: Type.Boolean({ description: 'Whether the field is required' }),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        value: Type.String(),
        label: Type.String(),
      }),
    ),
  ),
  validation: Type.Optional(
    Type.Object({
      minLength: Type.Optional(Type.Number()),
      maxLength: Type.Optional(Type.Number()),
      min: Type.Optional(Type.Number()),
      max: Type.Optional(Type.Number()),
      pattern: Type.Optional(Type.String()),
    }),
  ),
});

export type FormFieldDefinition = Static<typeof FormFieldDefinitionSchema>;

/**
 * Schema for form configuration per institution type.
 */
export const FormConfigurationSchema = Type.Object({
  institutionTypeId: Type.String({ description: 'Institution type this config applies to' }),
  fields: Type.Array(FormFieldDefinitionSchema, { description: 'Configurable form fields' }),
});

export type FormConfiguration = Static<typeof FormConfigurationSchema>;

// --- Response Schemas ---

/**
 * Registration submission response with tracking number.
 */
export const RegistrationSubmissionResponseSchema = Type.Object({
  id: Type.String({ description: 'Registration application UUID' }),
  trackingNumber: Type.String({ description: 'Tracking number for status checks' }),
  status: Type.String({ description: 'Application status' }),
  institutionId: Type.String({ description: 'Target institution UUID' }),
  submittedAt: Type.String({ description: 'Submission timestamp (ISO 8601)' }),
  message: Type.String({ description: 'Confirmation message' }),
});

export type RegistrationSubmissionResponse = Static<typeof RegistrationSubmissionResponseSchema>;

/**
 * Registration status response.
 */
export const RegistrationStatusResponseSchema = Type.Object({
  trackingNumber: Type.String({ description: 'Tracking number' }),
  status: Type.String({
    enum: ['pending', 'under_review', 'approved', 'rejected', 'waitlisted'],
    description: 'Current application status',
  }),
  institutionName: Type.String({ description: 'Target institution name' }),
  applicantName: Type.String({ description: 'Applicant full name' }),
  submittedAt: Type.String({ description: 'Submission timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
  remarks: Type.Optional(Type.String({ description: 'Reviewer remarks' })),
});

export type RegistrationStatusResponse = Static<typeof RegistrationStatusResponseSchema>;

/**
 * Institution map location entry.
 */
export const InstitutionLocationSchema = Type.Object({
  id: Type.String({ description: 'Institution UUID' }),
  name: Type.String({ description: 'Institution name' }),
  code: Type.String({ description: 'Institution code' }),
  typeId: Type.String({ description: 'Institution type UUID' }),
  typeName: Type.Optional(Type.String({ description: 'Institution type name' })),
  areaId: Type.String({ description: 'Area UUID' }),
  areaName: Type.Optional(Type.String({ description: 'Area name' })),
  latitude: Type.Union([Type.Number(), Type.Null()], { description: 'Latitude' }),
  longitude: Type.Union([Type.Number(), Type.Null()], { description: 'Longitude' }),
  address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  availableGrades: Type.Optional(Type.Array(Type.String(), { description: 'Available grade IDs' })),
});

export type InstitutionLocation = Static<typeof InstitutionLocationSchema>;

/**
 * Paginated institution locations response.
 */
export const InstitutionMapResponseSchema = Type.Object({
  data: Type.Array(InstitutionLocationSchema),
  meta: Type.Object({
    page: Type.Number(),
    pageSize: Type.Number(),
    totalItems: Type.Number(),
    totalPages: Type.Number(),
  }),
});

export type InstitutionMapResponse = Static<typeof InstitutionMapResponseSchema>;
