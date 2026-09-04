/**
 * Infrastructure Hierarchy Module
 *
 * Exports for the infrastructure hierarchy tracking feature.
 * Manages land, buildings, floors, and rooms in parent-child hierarchy.
 *
 * @module infrastructure
 * @requirements 5.6
 */

// Service
export { InfrastructureService } from './service.js';
export type {
  InfrastructureStore,
  InfrastructureRecord,
  InfrastructureRepairLogRecord,
  ConditionOptionStore,
  ConditionOptionRecord,
  InfrastructureServiceOptions,
} from './service.js';

// Routes
export { registerInfrastructureRoutes } from './routes.js';
export type { InfrastructureRoutesOptions } from './routes.js';

// In-memory stores (for testing)
export { InMemoryInfrastructureStore, InMemoryConditionOptionStore } from './in-memory-store.js';

// Prisma stores + factory
export { PrismaInfrastructureStore, PrismaConditionOptionStore } from './prisma-store.js';
export { createInfrastructureStores } from './store-factory.js';
export type { InfrastructureStoreConfig, InfrastructureStores } from './store-factory.js';

// Schemas
export {
  InfrastructureType,
  CreateLandSchema,
  CreateBuildingSchema,
  CreateFloorSchema,
  CreateRoomSchema,
  UpdateInfrastructureSchema,
  InfrastructureParamsSchema,
  InstitutionScopeParamsSchema,
  ParentScopeParamsSchema,
  InfrastructureListQuerySchema,
  InfrastructureResponseSchema,
  InfrastructureListResponseSchema,
  ConditionOptionSchema,
  CreateConditionOptionSchema,
  InfrastructureRepairParamsSchema,
  CreateInfrastructureRepairSchema,
  InfrastructureRepairLogResponseSchema,
  InfrastructureHierarchyResponseSchema,
} from './schemas.js';
export type {
  InfrastructureTypeValue,
  CreateLandInput,
  CreateBuildingInput,
  CreateFloorInput,
  CreateRoomInput,
  UpdateInfrastructureInput,
  InfrastructureParams,
  InstitutionScopeParams,
  ParentScopeParams,
  InfrastructureListQuery,
  InfrastructureResponse,
  InfrastructureListResponse,
  ConditionOption,
  CreateConditionOptionInput,
  InfrastructureRepairParams,
  CreateInfrastructureRepairInput,
  InfrastructureRepairLogResponse,
  InfrastructureHierarchyResponse,
} from './schemas.js';
