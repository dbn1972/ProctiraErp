/**
 * Area Hierarchy Module
 *
 * Exports the area hierarchy service, routes, and schemas for use
 * by the institution plugin and other consumers.
 */

export {
  TenantScopedAreaHierarchyResolver,
  toAreaNodes,
} from './area-hierarchy-resolver.js';
export type { RegisterableArea } from './area-hierarchy-resolver.js';
export {
  createAreaHierarchyResolver,
  demoGatewayAreaHierarchy,
  asTenantScopedResolver,
  GATEWAY_DEMO_TENANT_ID,
  isPgAreaHierarchyEnabled,
} from './create-area-hierarchy-resolver.js';
export type { AreaHierarchyResolverConfig } from './create-area-hierarchy-resolver.js';

export { AreaHierarchyService, MAX_AREA_DEPTH } from './area-hierarchy.service.js';
export type {
  CreateAreaInput,
  UpdateAreaInput,
  MoveAreaInput,
  AreaTreeNode,
  AreaHierarchyDbClient,
} from './area-hierarchy.service.js';

export { registerAreaHierarchyRoutes } from './area-hierarchy.routes.js';
export type { AreaHierarchyRoutesOptions } from './area-hierarchy.routes.js';

export {
  CreateAreaBodySchema,
  UpdateAreaBodySchema,
  MoveAreaBodySchema,
  AreaIdParamSchema,
  AreaTreeQuerySchema,
  AreaInstitutionsQuerySchema,
  AreaResponseSchema,
  AreaTreeNodeSchema,
  AreaTreeResponseSchema,
  PaginatedInstitutionsResponseSchema,
  ApiErrorResponseSchema,
} from './area-hierarchy.schemas.js';

export type {
  CreateAreaBody,
  UpdateAreaBody,
  MoveAreaBody,
  AreaIdParam,
  AreaTreeQuery,
  AreaInstitutionsQuery,
} from './area-hierarchy.schemas.js';
