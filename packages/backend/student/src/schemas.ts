/**
 * Typebox schemas for Student Service request/response validation.
 *
 * Defines schemas for:
 * - CreateStudent (body) - validates required fields: name, date of birth
 * - UpdateStudent (body)
 * - StudentResponse (response)
 * - StudentListQuery (querystring)
 * - StudentSearchQuery (querystring)
 *
 * Requirements:
 * - 6.1: Manage student records including personal information, identity documents,
 *         contacts, guardians, and nationality. Name and date of birth are mandatory.
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Schema for a contact entry.
 */
export const ContactSchema = Type.Object({
  type: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Contact type (e.g., phone, email, address)',
  }),
  value: Type.String({ minLength: 1, maxLength: 255, description: 'Contact value' }),
  isPrimary: Type.Boolean({ default: false, description: 'Whether this is the primary contact' }),
});

/**
 * Schema for a guardian entry.
 */
export const GuardianSchema = Type.Object({
  id: Type.Optional(Type.String({ description: 'Guardian ID (auto-generated if not provided)' })),
  firstName: Type.String({ minLength: 1, maxLength: 100, description: 'Guardian first name' }),
  lastName: Type.String({ minLength: 1, maxLength: 100, description: 'Guardian last name' }),
  relationship: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Relationship to student (e.g., father, mother, uncle)',
  }),
  contactPhone: Type.Optional(Type.String({ maxLength: 50, description: 'Guardian phone number' })),
  contactEmail: Type.Optional(
    Type.String({
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      maxLength: 254,
      description: 'Guardian email address',
    }),
  ),
});

/**
 * Schema for an identity document entry.
 */
export const IdentityDocumentSchema = Type.Object({
  type: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Document type (e.g., passport, birth_certificate)',
  }),
  number: Type.String({ minLength: 1, maxLength: 100, description: 'Document number' }),
  issuingCountry: Type.Optional(
    Type.String({ maxLength: 100, description: 'Country that issued the document' }),
  ),
  expiryDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Document expiry date (YYYY-MM-DD)',
    }),
  ),
});

/**
 * Schema for creating a new student.
 * Required fields per Requirement 6.1: name (firstName + lastName) and date of birth.
 */
export const CreateStudentSchema = Type.Object({
  firstName: Type.String({ minLength: 1, maxLength: 100, description: 'Student first name' }),
  lastName: Type.String({ minLength: 1, maxLength: 100, description: 'Student last name' }),
  dateOfBirth: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Date of birth (YYYY-MM-DD)',
  }),
  gender: Type.String({ minLength: 1, maxLength: 20, description: 'Gender' }),
  nationalId: Type.Optional(
    Type.String({ maxLength: 50, description: 'National identification number' }),
  ),
  nationality: Type.Optional(Type.String({ maxLength: 100, description: 'Nationality' })),
  contacts: Type.Optional(Type.Array(ContactSchema, { description: 'Contact information' })),
  guardians: Type.Optional(Type.Array(GuardianSchema, { description: 'Guardian information' })),
  identityDocuments: Type.Optional(
    Type.Array(IdentityDocumentSchema, { description: 'Identity documents' }),
  ),
  customData: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Custom fields (JSONB)' }),
  ),
});

export type CreateStudentInput = Static<typeof CreateStudentSchema>;

/**
 * Schema for updating an existing student.
 * All fields are optional — only provided fields are updated.
 */
export const UpdateStudentSchema = Type.Object({
  firstName: Type.Optional(
    Type.String({ minLength: 1, maxLength: 100, description: 'Student first name' }),
  ),
  lastName: Type.Optional(
    Type.String({ minLength: 1, maxLength: 100, description: 'Student last name' }),
  ),
  dateOfBirth: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Date of birth (YYYY-MM-DD)',
    }),
  ),
  gender: Type.Optional(Type.String({ minLength: 1, maxLength: 20, description: 'Gender' })),
  nationalId: Type.Optional(
    Type.Union([Type.String({ maxLength: 50 }), Type.Null()], {
      description: 'National identification number',
    }),
  ),
  nationality: Type.Optional(
    Type.Union([Type.String({ maxLength: 100 }), Type.Null()], { description: 'Nationality' }),
  ),
  contacts: Type.Optional(Type.Array(ContactSchema, { description: 'Contact information' })),
  guardians: Type.Optional(Type.Array(GuardianSchema, { description: 'Guardian information' })),
  identityDocuments: Type.Optional(
    Type.Array(IdentityDocumentSchema, { description: 'Identity documents' }),
  ),
  customData: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Custom fields (JSONB)' }),
  ),
});

export type UpdateStudentInput = Static<typeof UpdateStudentSchema>;

/**
 * Schema for student list query parameters.
 */
export const StudentListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  gender: Type.Optional(Type.String({ description: 'Filter by gender' })),
  search: Type.Optional(Type.String({ description: 'Search by name or national ID' })),
  sortBy: Type.Optional(
    Type.String({
      enum: ['firstName', 'lastName', 'dateOfBirth', 'createdAt'],
      default: 'lastName',
      description: 'Sort field',
    }),
  ),
  sortOrder: Type.Optional(
    Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' }),
  ),
  institutionId: Type.Optional(
    Type.String({ description: 'Scope to one institution (school) within the tenant' }),
  ),
});

export type StudentListQuery = Static<typeof StudentListQuerySchema>;

/**
 * Schema for full-text search query parameters.
 */
export const StudentSearchQuerySchema = Type.Object({
  q: Type.String({
    minLength: 1,
    description: 'Search query (matches student name and national ID)',
  }),
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
});

export type StudentSearchQuery = Static<typeof StudentSearchQuerySchema>;

/**
 * Schema for student ID path parameter.
 */
export const StudentParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Student UUID',
  }),
});

export type StudentParams = Static<typeof StudentParamsSchema>;

const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * W2-SIS-02: merge duplicate student into survivor.
 */
export const MergeStudentsSchema = Type.Object({
  survivorId: Type.String({ pattern: UuidPattern, description: 'Canonical student UUID' }),
  duplicateId: Type.String({ pattern: UuidPattern, description: 'Duplicate student UUID to retire' }),
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Why these records are duplicates' }),
});
export type MergeStudentsInput = Static<typeof MergeStudentsSchema>;

/**
 * Schema for student response object.
 */
export const StudentResponseSchema = Type.Object({
  id: Type.String({ description: 'Student UUID' }),
  firstName: Type.String({ description: 'Student first name' }),
  lastName: Type.String({ description: 'Student last name' }),
  dateOfBirth: Type.String({ description: 'Date of birth (YYYY-MM-DD)' }),
  gender: Type.String({ description: 'Gender' }),
  nationalId: Type.Union([Type.String(), Type.Null()], {
    description: 'National identification number',
  }),
  nationality: Type.Union([Type.String(), Type.Null()], { description: 'Nationality' }),
  contacts: Type.Array(ContactSchema, { description: 'Contact information' }),
  guardians: Type.Array(GuardianSchema, { description: 'Guardian information' }),
  identityDocuments: Type.Array(IdentityDocumentSchema, { description: 'Identity documents' }),
  customData: Type.Record(Type.String(), Type.Unknown(), { description: 'Custom fields' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type StudentResponse = Static<typeof StudentResponseSchema>;

/**
 * Schema for paginated student list response.
 */
export const StudentListResponseSchema = Type.Object({
  data: Type.Array(StudentResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type StudentListResponse = Static<typeof StudentListResponseSchema>;
