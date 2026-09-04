/**
 * @proctira/backend-transport - Transport domain service
 *
 * Provides school transport management with:
 * - Transport route CRUD with stops and schedules
 * - Vehicle record management (registration, capacity, status)
 * - Driver assignments (vehicle-driver-route linking)
 * - Student route assignments (student-route-stop linking)
 *
 * Requirements: 1.2 (Transport_Module)
 */

// Plugin
export { transportPlugin } from './transport-plugin.js';
export type { TransportPluginOptions } from './transport-plugin.js';

// Service
export { TransportService } from './transport-service.js';

// Repository
export type {
  TransportRouteEntity,
  RouteStopEntity,
  VehicleEntity,
  DriverAssignmentEntity,
  StudentRouteAssignmentEntity,
  RouteFilter,
  VehicleFilter,
  DriverAssignmentFilter,
  StudentAssignmentFilter,
  RouteStatus,
  VehicleStatus,
  TransportRepository,
} from './transport-repository.js';

// In-memory repository (for testing)
export { InMemoryTransportRepository } from './in-memory-repository.js';

// Prisma repository (Postgres + RLS) + factory
export { PrismaTransportRepository } from './prisma-transport-repository.js';
export { createTransportRepository } from './repository-factory.js';
export type { TransportRepositoryConfig } from './repository-factory.js';

// Schemas
export {
  CreateTransportRouteSchema,
  UpdateTransportRouteSchema,
  CreateRouteStopSchema,
  UpdateRouteStopSchema,
  CreateVehicleSchema,
  UpdateVehicleSchema,
  CreateDriverAssignmentSchema,
  UpdateDriverAssignmentSchema,
  CreateStudentAssignmentSchema,
  UpdateStudentAssignmentSchema,
  TransportParamsSchema,
  RouteParamsSchema,
  TransportListQuerySchema,
  TransportRouteResponseSchema,
  RouteStopResponseSchema,
  VehicleResponseSchema,
  DriverAssignmentResponseSchema,
  StudentAssignmentResponseSchema,
} from './schemas.js';
export type {
  CreateTransportRouteInput,
  UpdateTransportRouteInput,
  CreateRouteStopInput,
  UpdateRouteStopInput,
  CreateVehicleInput,
  UpdateVehicleInput,
  CreateDriverAssignmentInput,
  UpdateDriverAssignmentInput,
  CreateStudentAssignmentInput,
  UpdateStudentAssignmentInput,
  TransportParams,
  RouteParams,
  TransportListQuery,
  TransportRouteResponse,
  RouteStopResponse,
  VehicleResponse,
  DriverAssignmentResponse,
  StudentAssignmentResponse,
} from './schemas.js';

// Routes
export { registerTransportRoutes } from './routes.js';
export type { TransportRoutesOptions } from './routes.js';
