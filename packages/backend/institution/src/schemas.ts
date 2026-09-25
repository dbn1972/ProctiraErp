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
 * `areaId` is the only genuine reference an institution carries: `db/sql/001`
 * declares `area_id UUID NOT NULL REFERENCES geographic_areas(id)`.
 */
export const AREA_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * `typeId` / `sectorId` / `ownershipId` are NOT references, despite the names.
 * They persist to `institutions.type|sector|ownership VARCHAR(50)` — plain
 * vocabulary columns with no lookup table in the Prisma schema, in `db/sql`,
 * or in the live database. The registration read model already treats the
 * column itself as the identifier (`SELECT i.type AS type_id` in
 * `packages/backend/registration/src/pg-registration-repository.ts`).
 *
 * These fields previously demanded a UUID-v4 shape, which no real value could
 * satisfy: the vocabulary actually stored is `K12` / `GOVERNMENT` / `CENTRAL`
 * (live rows) and `school` / `government` (`db/seeds/002`). Requiring a UUID
 * meant the only accepted values were ones that corrupt the column, while the
 * legitimate value `K12` was rejected. Validate the column's real contract
 * instead: a bounded code token that fits VARCHAR(50).
 *
 * Deliberately permissive about *which* tokens. Jurisdictions use different
 * taxonomies and this repository has no controlled list to promote; choosing
 * one is a product decision, not a validation fix.
 */
export const VOCABULARY_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 ._/-]*$';

const vocabulary = (description: string) =>
  Type.String({ minLength: 1, maxLength: 50, pattern: VOCABULARY_PATTERN, description });

/**
 * Schema for creating a new institution.
 * All required fields per Requirement 5.3: name, code, area, type, sector, ownership.
 */
export const CreateInstitutionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Institution name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Unique institution code' }),
  areaId: Type.String({
    pattern: AREA_ID_PATTERN,
    description: 'Area hierarchy node UUID',
  }),
  typeId: vocabulary('Institution type code (e.g. K12)'),
  sectorId: vocabulary('Sector code (e.g. GOVERNMENT)'),
  ownershipId: vocabulary('Ownership code (e.g. CENTRAL)'),
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
      pattern: AREA_ID_PATTERN,
      description: 'Area hierarchy node UUID',
    }),
  ),
  typeId: Type.Optional(vocabulary('Institution type code (e.g. K12)')),
  sectorId: Type.Optional(vocabulary('Sector code (e.g. GOVERNMENT)')),
  ownershipId: Type.Optional(vocabulary('Ownership code (e.g. CENTRAL)')),
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
  typeId: Type.String({ description: 'Institution type code (e.g. K12)' }),
  sectorId: Type.String({ description: 'Sector code (e.g. GOVERNMENT)' }),
  ownershipId: Type.String({ description: 'Ownership code (e.g. CENTRAL)' }),
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
