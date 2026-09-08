/**
 * Typebox schemas for Area Hierarchy API routes.
 */
import { Type, type Static } from '@sinclair/typebox';

// UUID pattern that accepts any valid UUID (v1-v5)
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

// ============================================================================
// Request Schemas
// ============================================================================

export const CreateAreaBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Area name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Unique area code within tenant' }),
  parentId: Type.Optional(
    Type.Union([
      Type.String({ pattern: UUID_PATTERN, description: 'Parent area ID (UUID)' }),
      Type.Null(),
    ]),
  ),
});
export type CreateAreaBody = Static<typeof CreateAreaBodySchema>;

export const UpdateAreaBodySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Area name' })),
  code: Type.Optional(
    Type.String({ minLength: 1, maxLength: 50, description: 'Unique area code within tenant' }),
  ),
});
export type UpdateAreaBody = Static<typeof UpdateAreaBodySchema>;

export const MoveAreaBodySchema = Type.Object({
  newParentId: Type.Union([
    Type.String({ pattern: UUID_PATTERN, description: 'New parent area ID (UUID)' }),
    Type.Null(),
  ]),
});
export type MoveAreaBody = Static<typeof MoveAreaBodySchema>;

export const AreaIdParamSchema = Type.Object({
  areaId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    description: 'Area ID (UUID)',
  }),
});
export type AreaIdParam = Static<typeof AreaIdParamSchema>;

export const AreaTreeQuerySchema = Type.Object({
  rootId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Root area ID to start tree from' }),
  ),
});
export type AreaTreeQuery = Static<typeof AreaTreeQuerySchema>;

export const AreaInstitutionsQuerySchema = Type.Object({
  page: Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  pageSize: Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
});
export type AreaInstitutionsQuery = Static<typeof AreaInstitutionsQuerySchema>;

// ============================================================================
// Response Schemas
// ============================================================================

export const AreaResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  level: Type.Number(),
  parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  path: Type.String(),
  lft: Type.Number(),
  rgt: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type AreaResponse = Static<typeof AreaResponseSchema>;

export const AreaTreeNodeSchema: ReturnType<typeof Type.Object> = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  level: Type.Number(),
  parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  path: Type.String(),
  lft: Type.Number(),
  rgt: Type.Number(),
  children: Type.Array(Type.Any()),
});

export const AreaTreeResponseSchema = Type.Array(AreaTreeNodeSchema);

export const InstitutionResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  areaId: Type.String({ format: 'uuid' }),
  type: Type.String(),
  sector: Type.String(),
  ownership: Type.String(),
  status: Type.String(),
});

export const PaginatedInstitutionsResponseSchema = Type.Object({
  data: Type.Array(InstitutionResponseSchema),
  meta: Type.Object({
    page: Type.Number(),
    pageSize: Type.Number(),
    totalItems: Type.Number(),
    totalPages: Type.Number(),
  }),
});

export const ApiErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  statusCode: Type.Number(),
  errors: Type.Optional(
    Type.Array(
      Type.Object({
        field: Type.String(),
        rule: Type.String(),
        message: Type.String(),
      }),
    ),
  ),
});
