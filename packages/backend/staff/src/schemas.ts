/**
 * Typebox schemas for Staff Service request/response validation.
 *
 * Defines schemas for:
 * - CreateStaff (body)
 * - UpdateStaff (body)
 * - StaffResponse (response)
 * - StaffListQuery (querystring)
 *
 * Requirements:
 * - 7.1: Staff records with personal information, qualifications, employment history, position
 * - 7.6: Custom fields via JSONB custom_data column
 * - 7.7: Required fields: name, DOB, identity number, contact, position; unique identity number
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * UUID pattern for validation.
 */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * ISO date pattern (YYYY-MM-DD).
 */
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/**
 * Schema for creating a new staff record.
 * Required fields per Requirement 7.7: name, DOB, identity number, contact, position.
 */
export const CreateStaffSchema = Type.Object({
  firstName: Type.String({ minLength: 1, maxLength: 100, description: 'Staff first name' }),
  lastName: Type.String({ minLength: 1, maxLength: 100, description: 'Staff last name' }),
  dateOfBirth: Type.String({
    pattern: DATE_PATTERN,
    description: 'Date of birth (YYYY-MM-DD)',
  }),
  identityNumber: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Unique identity number (e.g., national ID)',
  }),
  contactPhone: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Contact phone number',
  }),
  contactEmail: Type.Optional(Type.String({
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    maxLength: 254,
    description: 'Contact email address',
  })),
  position: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Staff position/role (e.g., Teacher, Principal)',
  }),
  customData: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Custom fields stored as JSONB',
  })),
});

export type CreateStaffInput = Static<typeof CreateStaffSchema>;

/**
 * Schema for updating an existing staff record.
 * All fields are optional — only provided fields are updated.
 */
export const UpdateStaffSchema = Type.Object({
  firstName: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Staff first name' })),
  lastName: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Staff last name' })),
  dateOfBirth: Type.Optional(Type.String({
    pattern: DATE_PATTERN,
    description: 'Date of birth (YYYY-MM-DD)',
  })),
  identityNumber: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Unique identity number',
  })),
  contactPhone: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Contact phone number',
  })),
  contactEmail: Type.Optional(Type.String({
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    maxLength: 254,
    description: 'Contact email address',
  })),
  position: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Staff position/role',
  })),
  customData: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Custom fields stored as JSONB',
  })),
});

export type UpdateStaffInput = Static<typeof UpdateStaffSchema>;

/**
 * Schema for staff list query parameters.
 */
export const StaffListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  status: Type.Optional(Type.String({ enum: ['ACTIVE', 'INACTIVE'], description: 'Filter by status' })),
  position: Type.Optional(Type.String({ description: 'Filter by position' })),
  search: Type.Optional(Type.String({ description: 'Full-text search on name and identity number' })),
  sortBy: Type.Optional(Type.String({ enum: ['firstName', 'lastName', 'position', 'createdAt'], default: 'lastName', description: 'Sort field' })),
  sortOrder: Type.Optional(Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' })),
});

export type StaffListQuery = Static<typeof StaffListQuerySchema>;

/**
 * Schema for staff ID path parameter.
 */
export const StaffParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Staff UUID',
  }),
});

export type StaffParams = Static<typeof StaffParamsSchema>;

/**
 * Schema for staff response object.
 */
export const StaffResponseSchema = Type.Object({
  id: Type.String({ description: 'Staff UUID' }),
  firstName: Type.String({ description: 'Staff first name' }),
  lastName: Type.String({ description: 'Staff last name' }),
  dateOfBirth: Type.String({ description: 'Date of birth (YYYY-MM-DD)' }),
  identityNumber: Type.String({ description: 'Unique identity number' }),
  contactPhone: Type.String({ description: 'Contact phone number' }),
  contactEmail: Type.Union([Type.String(), Type.Null()], { description: 'Contact email address' }),
  position: Type.String({ description: 'Staff position/role' }),
  status: Type.String({ description: 'Staff status (ACTIVE or INACTIVE)' }),
  customData: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], { description: 'Custom fields' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type StaffResponse = Static<typeof StaffResponseSchema>;

/**
 * Schema for paginated staff list response.
 */
export const StaffListResponseSchema = Type.Object({
  data: Type.Array(StaffResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type StaffListResponse = Static<typeof StaffListResponseSchema>;
