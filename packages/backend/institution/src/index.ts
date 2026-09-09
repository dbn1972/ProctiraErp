/**
 * @proctira/backend-institution - Institution domain service
 *
 * Provides CRUD operations for educational institutions with:
 * - Typebox schema validation
 * - Unique code enforcement (global) and unique name within area
 * - Deactivation logic (set status inactive, prevent new enrollments/assignments)
 * - Area hierarchy placement
 */

// Plugin
export { institutionPlugin } from './institution-plugin.js';
export type { InstitutionPluginOptions } from './institution-plugin.js';

// Service
export { InstitutionService } from './institution-service.js';

// Repository
export type {
  InstitutionEntity,
  InstitutionFilter,
  InstitutionRepository,
} from './institution-repository.js';

// In-memory repository (for testing)
export { InMemoryInstitutionRepository } from './in-memory-repository.js';

// Cached repository decorator
export { CachedInstitutionRepository } from './cached-institution-repository.js';

// Schemas
export {
  CreateInstitutionSchema,
  UpdateInstitutionSchema,
  DeactivateInstitutionSchema,
  InstitutionListQuerySchema,
  InstitutionParamsSchema,
  InstitutionResponseSchema,
  InstitutionListResponseSchema,
} from './schemas.js';
export type {
  CreateInstitutionInput,
  UpdateInstitutionInput,
  DeactivateInstitutionInput,
  InstitutionListQuery,
  InstitutionParams,
  InstitutionResponse,
  InstitutionListResponse,
} from './schemas.js';

// Routes
export { registerInstitutionRoutes } from './routes.js';
export type { InstitutionRoutesOptions } from './routes.js';

// Area Hierarchy
export {
  AreaHierarchyService,
  MAX_AREA_DEPTH,
  registerAreaHierarchyRoutes,
} from './area-hierarchy/index.js';
export type {
  CreateAreaInput,
  UpdateAreaInput,
  MoveAreaInput,
  AreaTreeNode,
  AreaHierarchyDbClient,
  AreaHierarchyRoutesOptions,
} from './area-hierarchy/index.js';

// Infrastructure Hierarchy
export {
  InfrastructureService,
  InMemoryInfrastructureStore,
  InMemoryConditionOptionStore,
  registerInfrastructureRoutes,
  InfrastructureType,
  CreateLandSchema,
  CreateBuildingSchema,
  CreateFloorSchema,
  CreateRoomSchema,
  UpdateInfrastructureSchema,
  InfrastructureResponseSchema,
  InfrastructureListResponseSchema,
  InfrastructureHierarchyResponseSchema,
  CreateConditionOptionSchema,
} from './infrastructure/index.js';
export type {
  InfrastructureStore,
  InfrastructureRecord,
  ConditionOptionStore,
  ConditionOptionRecord,
  InfrastructureServiceOptions,
  InfrastructureRoutesOptions,
  InfrastructureTypeValue,
  CreateLandInput,
  CreateBuildingInput,
  CreateFloorInput,
  CreateRoomInput,
  UpdateInfrastructureInput,
  InfrastructureResponse,
  InfrastructureHierarchyResponse,
} from './infrastructure/index.js';

// G-901: academics composition (academic periods / grades / classes / subjects /
// infrastructure) + request-scoped tenant context + pg infrastructure stores
export {
  createAcademicsDeps,
  isPgAcademicsEnabled,
  TenantPartitionedInfrastructureStore,
  TenantPartitionedConditionOptionStore,
} from './academics-factory.js';
export type { AcademicsDeps, AcademicsDepsConfig } from './academics-factory.js';
export { createInMemoryAcademicsPrisma } from './education/in-memory-prisma-lite.js';
export {
  PgInfrastructureStore,
  PgConditionOptionStore,
  ensureInfrastructureSchema,
} from './infrastructure/pg-store.js';
export { tenantContext, currentTenantId, requireTenantId } from './tenant-context.js';
export { AcademicPeriodService } from './academic-period/academic-period-service.js';
export { registerAcademicPeriodRoutes } from './academic-period/academic-period-routes.js';
// G-905 academic calendar: year→term hierarchy events + end-of-year rollover
export { AcademicCalendarService } from './academic-calendar/calendar-service.js';
export type { AcademicCalendarServiceDeps } from './academic-calendar/calendar-service.js';
export { registerAcademicCalendarRoutes } from './academic-calendar/routes.js';
export {
  InMemoryCalendarStore,
  PgCalendarStore,
} from './academic-calendar/calendar-store.js';
export type { CalendarStore, CalendarEventRecord } from './academic-calendar/calendar-store.js';
export {
  CALENDAR_EVENT_KINDS,
  CreateCalendarEventSchema,
  CalendarEventResponseSchema,
  RolloverRequestSchema,
} from './academic-calendar/schemas.js';
export type {
  CalendarEventKind,
  CreateCalendarEventDto,
  CalendarEventResponse,
  RolloverRequestDto,
  RolloverSummary,
} from './academic-calendar/schemas.js';
export {
  GradeService,
  ClassService,
  SubjectService,
  registerGradeRoutes,
  registerClassRoutes,
  registerSubjectRoutes,
} from './education/index.js';

// Persistence: Prisma repository + env-driven factory
export { PrismaInstitutionRepository } from './prisma-institution-repository.js';
export { createInstitutionRepository, isPgInstitutionEnabled } from './repository-factory.js';
export type { InstitutionRepositoryConfig } from './repository-factory.js';
export { createTenantBoundPrisma } from './tenant-bound-prisma.js';
