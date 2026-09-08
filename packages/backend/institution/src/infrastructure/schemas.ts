/**
 * Typebox schemas for Infrastructure Hierarchy tracking.
 *
 * Defines schemas for:
 * - Land, Building, Floor, Room (parent-child hierarchy)
 * - Capacity (1–99,999) and condition status from configurable options
 *
 * Hierarchy: Land → Building → Floor → Room
 * Each infrastructure item belongs to an institution.
 *
 * @module infrastructure/schemas
 * @requirements 5.6
 */
import { Type, type Static } from '@sinclair/typebox';

/** Valid infrastructure types in the hierarchy */
export const InfrastructureType = {
  LAND: 'LAND',
  BUILDING: 'BUILDING',
  FLOOR: 'FLOOR',
  ROOM: 'ROOM',
} as const;

export type InfrastructureTypeValue = (typeof InfrastructureType)[keyof typeof InfrastructureType];

/** UUID pattern for validation */
const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * Schema for creating a Land record (top-level infrastructure).
 */
export const CreateLandSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Land name/identifier' }),
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 99999,
    description: 'Numeric capacity (1–99,999)',
  }),
  condition: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Condition status from configurable options',
  }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type CreateLandInput = Static<typeof CreateLandSchema>;

/**
 * Schema for creating a Building record (child of Land).
 */
export const CreateBuildingSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Building name/identifier' }),
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
  landId: Type.String({ pattern: UuidPattern, description: 'Parent land UUID' }),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 99999,
    description: 'Numeric capacity (1–99,999)',
  }),
  condition: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Condition status from configurable options',
  }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type CreateBuildingInput = Static<typeof CreateBuildingSchema>;

/**
 * Schema for creating a Floor record (child of Building).
 */
export const CreateFloorSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Floor name/identifier' }),
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
  buildingId: Type.String({ pattern: UuidPattern, description: 'Parent building UUID' }),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 99999,
    description: 'Numeric capacity (1–99,999)',
  }),
  condition: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Condition status from configurable options',
  }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type CreateFloorInput = Static<typeof CreateFloorSchema>;

/**
 * Schema for creating a Room record (child of Floor).
 */
export const CreateRoomSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Room name/identifier' }),
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
  floorId: Type.String({ pattern: UuidPattern, description: 'Parent floor UUID' }),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 99999,
    description: 'Numeric capacity (1–99,999)',
  }),
  condition: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Condition status from configurable options',
  }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type CreateRoomInput = Static<typeof CreateRoomSchema>;

/**
 * Schema for updating any infrastructure item.
 * All fields are optional — only provided fields are updated.
 */
export const UpdateInfrastructureSchema = Type.Object({
  name: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Name/identifier' }),
  ),
  capacity: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 99999, description: 'Numeric capacity (1–99,999)' }),
  ),
  condition: Type.Optional(
    Type.String({ minLength: 1, maxLength: 100, description: 'Condition status' }),
  ),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type UpdateInfrastructureInput = Static<typeof UpdateInfrastructureSchema>;

/**
 * Schema for infrastructure ID path parameter.
 */
export const InfrastructureParamsSchema = Type.Object({
  id: Type.String({ pattern: UuidPattern, description: 'Infrastructure item UUID' }),
});

export type InfrastructureParams = Static<typeof InfrastructureParamsSchema>;

/**
 * Schema for institution-scoped path parameter.
 */
export const InstitutionScopeParamsSchema = Type.Object({
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
});

export type InstitutionScopeParams = Static<typeof InstitutionScopeParamsSchema>;

/**
 * Schema for parent-scoped path parameters (e.g., buildings under a land).
 */
export const ParentScopeParamsSchema = Type.Object({
  institutionId: Type.String({ pattern: UuidPattern, description: 'Institution UUID' }),
  parentId: Type.String({ pattern: UuidPattern, description: 'Parent item UUID' }),
});

export type ParentScopeParams = Static<typeof ParentScopeParamsSchema>;

/**
 * Schema for infrastructure list query parameters.
 */
export const InfrastructureListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  sortBy: Type.Optional(
    Type.String({
      enum: ['name', 'capacity', 'createdAt'],
      default: 'name',
      description: 'Sort field',
    }),
  ),
  sortOrder: Type.Optional(
    Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' }),
  ),
});

export type InfrastructureListQuery = Static<typeof InfrastructureListQuerySchema>;

/**
 * Schema for infrastructure response object.
 */
export const InfrastructureResponseSchema = Type.Object({
  id: Type.String({ description: 'Infrastructure item UUID' }),
  name: Type.String({ description: 'Name/identifier' }),
  type: Type.String({
    enum: ['LAND', 'BUILDING', 'FLOOR', 'ROOM'],
    description: 'Infrastructure type',
  }),
  institutionId: Type.String({ description: 'Institution UUID' }),
  parentId: Type.Union([Type.String(), Type.Null()], {
    description: 'Parent item UUID (null for land)',
  }),
  capacity: Type.Integer({ description: 'Numeric capacity' }),
  condition: Type.String({ description: 'Condition status' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Optional description' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type InfrastructureResponse = Static<typeof InfrastructureResponseSchema>;

/**
 * Schema for paginated infrastructure list response.
 */
export const InfrastructureListResponseSchema = Type.Object({
  data: Type.Array(InfrastructureResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type InfrastructureListResponse = Static<typeof InfrastructureListResponseSchema>;

/**
 * Schema for configurable condition options.
 */
export const ConditionOptionSchema = Type.Object({
  id: Type.String({ description: 'Condition option UUID' }),
  name: Type.String({ description: 'Condition name (e.g., Good, Fair, Poor)' }),
  description: Type.Optional(Type.String({ description: 'Optional description' })),
});

export type ConditionOption = Static<typeof ConditionOptionSchema>;

/**
 * Schema for creating a condition option.
 */
export const CreateConditionOptionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100, description: 'Condition name' }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional description' })),
});

export type CreateConditionOptionInput = Static<typeof CreateConditionOptionSchema>;

/**
 * Schema for the full infrastructure hierarchy response (tree view).
 */
export const InfrastructureHierarchyResponseSchema = Type.Object({
  lands: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      capacity: Type.Integer(),
      condition: Type.String(),
      description: Type.Union([Type.String(), Type.Null()]),
      buildings: Type.Array(
        Type.Object({
          id: Type.String(),
          name: Type.String(),
          capacity: Type.Integer(),
          condition: Type.String(),
          description: Type.Union([Type.String(), Type.Null()]),
          floors: Type.Array(
            Type.Object({
              id: Type.String(),
              name: Type.String(),
              capacity: Type.Integer(),
              condition: Type.String(),
              description: Type.Union([Type.String(), Type.Null()]),
              rooms: Type.Array(
                Type.Object({
                  id: Type.String(),
                  name: Type.String(),
                  capacity: Type.Integer(),
                  condition: Type.String(),
                  description: Type.Union([Type.String(), Type.Null()]),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type InfrastructureHierarchyResponse = Static<typeof InfrastructureHierarchyResponseSchema>;
