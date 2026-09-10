/**
 * Typebox schemas for Institution Service request/response validation.
 *
 * Defines schemas for:
 * - CreateInstitution (body)
 * - UpdateInstitution (body)
 * - DeactivateInstitution (body)
 * - InstitutionResponse (response)
 * - InstitutionListQuery (querystring)
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Schema for creating a new institution.
 * All required fields per Requirement 5.3: name, code, area, type, sector, ownership.
 */
export const CreateInstitutionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Institution name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Unique institution code' }),
  areaId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Area hierarchy node UUID',
  }),
  typeId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Institution type UUID',
  }),
  sectorId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Sector UUID',
  }),
  ownershipId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Ownership UUID',
  }),
  latitude: Type.Optional(
    Type.Number({ minimum: -90, maximum: 90, description: 'Latitude coordinate' }),
  ),
  longitude: Type.Optional(
    Type.Number({ minimum: -180, maximum: 180, description: 'Longitude coordinate' }),
  ),
  address: Type.Optional(Type.String({ maxLength: 500, description: 'Physical address' })),
  contactPhone: Type.Optional(Type.String({ maxLength: 50, description: 'Contact phone number' })),
  contactEmail: Type.Optional(
    Type.String({
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      maxLength: 254,
      description: 'Contact email address',
    }),
  ),
});

export type CreateInstitutionInput = Static<typeof CreateInstitutionSchema>;

/**
 * Schema for updating an existing institution.
 * All fields are optional — only provided fields are updated.
 */
export const UpdateInstitutionSchema = Type.Object({
  name: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Institution name' }),
  ),
  code: Type.Optional(
    Type.String({ minLength: 1, maxLength: 50, description: 'Unique institution code' }),
  ),
  areaId: Type.Optional(
    Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Area hierarchy node UUID',
    }),
  ),
  typeId: Type.Optional(
    Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Institution type UUID',
    }),
  ),
  sectorId: Type.Optional(
    Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Sector UUID',
    }),
  ),
  ownershipId: Type.Optional(
    Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Ownership UUID',
    }),
  ),
  latitude: Type.Optional(
    Type.Number({ minimum: -90, maximum: 90, description: 'Latitude coordinate' }),
  ),
  longitude: Type.Optional(
    Type.Number({ minimum: -180, maximum: 180, description: 'Longitude coordinate' }),
  ),
  address: Type.Optional(Type.String({ maxLength: 500, description: 'Physical address' })),
  contactPhone: Type.Optional(Type.String({ maxLength: 50, description: 'Contact phone number' })),
  contactEmail: Type.Optional(
    Type.String({
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      maxLength: 254,
      description: 'Contact email address',
    }),
  ),
});

export type UpdateInstitutionInput = Static<typeof UpdateInstitutionSchema>;

/**
 * Schema for deactivating an institution.
 */
export const DeactivateInstitutionSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Reason for deactivation' }),
});

export type DeactivateInstitutionInput = Static<typeof DeactivateInstitutionSchema>;

/**
 * Schema for institution list query parameters.
 */
export const InstitutionListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  areaId: Type.Optional(Type.String({ description: 'Filter by area ID' })),
  status: Type.Optional(
    Type.String({ enum: ['ACTIVE', 'INACTIVE'], description: 'Filter by status' }),
  ),
  search: Type.Optional(Type.String({ description: 'Search by name or code' })),
  sortBy: Type.Optional(
    Type.String({
      enum: ['name', 'code', 'createdAt'],
      default: 'name',
      description: 'Sort field',
    }),
  ),
  sortOrder: Type.Optional(
    Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' }),
  ),
});

export type InstitutionListQuery = Static<typeof InstitutionListQuerySchema>;

/**
 * Schema for institution ID path parameter.
 */
export const InstitutionParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Institution UUID',
  }),
});

export type InstitutionParams = Static<typeof InstitutionParamsSchema>;

/**
 * Schema for institution response object.
 */
export const InstitutionResponseSchema = Type.Object({
  id: Type.String({ description: 'Institution UUID' }),
  name: Type.String({ description: 'Institution name' }),
  code: Type.String({ description: 'Unique institution code' }),
  areaId: Type.String({ description: 'Area hierarchy node UUID' }),
  typeId: Type.String({ description: 'Institution type UUID' }),
  sectorId: Type.String({ description: 'Sector UUID' }),
  ownershipId: Type.String({ description: 'Ownership UUID' }),
  status: Type.String({ description: 'Institution status (ACTIVE or INACTIVE)' }),
  latitude: Type.Union([Type.Number(), Type.Null()], { description: 'Latitude coordinate' }),
  longitude: Type.Union([Type.Number(), Type.Null()], { description: 'Longitude coordinate' }),
  address: Type.Union([Type.String(), Type.Null()], { description: 'Physical address' }),
  contactPhone: Type.Union([Type.String(), Type.Null()], { description: 'Contact phone number' }),
  contactEmail: Type.Union([Type.String(), Type.Null()], { description: 'Contact email address' }),
  deactivationReason: Type.Union([Type.String(), Type.Null()], {
    description: 'Reason for deactivation',
  }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type InstitutionResponse = Static<typeof InstitutionResponseSchema>;

/**
 * Schema for paginated institution list response.
 */
export const InstitutionListResponseSchema = Type.Object({
  data: Type.Array(InstitutionResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type InstitutionListResponse = Static<typeof InstitutionListResponseSchema>;
