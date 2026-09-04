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

// Persistence: Prisma repository + env-driven factory
export { PrismaInstitutionRepository } from './prisma-institution-repository.js';
export { createInstitutionRepository } from './repository-factory.js';
export type { InstitutionRepositoryConfig } from './repository-factory.js';

// Academic structure (boards, periods, grades, classes, subjects)
export {
  BoardService,
  registerBoardRoutes,
  CreateBoardSchema,
  UpdateBoardSchema,
} from './board/index.js';
export type { BoardServiceDeps, CreateBoardDto, UpdateBoardDto } from './board/index.js';
export {
  AcademicPeriodService,
  registerAcademicPeriodRoutes,
} from './academic-period/index.js';
export {
  ClassService,
  GradeService,
  SubjectService,
  registerClassRoutes,
  registerGradeRoutes,
  registerSubjectRoutes,
} from './education/index.js';
export type { SubjectServiceDeps, SubjectRoutesOptions } from './education/index.js';
