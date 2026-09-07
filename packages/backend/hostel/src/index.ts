/**
 * @proctira/backend-hostel — hostel occupancy shell.
 */

export { hostelPlugin } from './hostel-plugin.js';
export type { HostelPluginOptions } from './hostel-plugin.js';

export { HostelService } from './hostel-service.js';

export type {
  HostelEntity,
  HostelAssignmentEntity,
  HostelLeaveEntity,
  HostelVisitorEntity,
  HostelBlockEntity,
  HostelRoomEntity,
  HostelBedEntity,
  HostelRepository,
} from './hostel-repository.js';

export { InMemoryHostelRepository } from './in-memory-repository.js';

export { createHostelRepository, isPgHostelEnabled } from './create-hostel-repository.js';
export {
  PgHostelRepository,
  createPgHostelRepository,
  getSharedHostelPool,
  ensureHostelSchema,
} from './pg-hostel-repository.js';

export {
  CreateHostelSchema,
  CreateAssignmentSchema,
  CreateLeaveSchema,
  CreateVisitorSchema,
  CreateBlockSchema,
  CreateRoomSchema,
  CreateBedSchema,
  HostelParamsSchema,
} from './schemas.js';
export type {
  CreateHostelInput,
  CreateAssignmentInput,
  CreateLeaveInput,
  CreateVisitorInput,
  CreateBlockInput,
  CreateRoomInput,
  CreateBedInput,
} from './schemas.js';

export { registerHostelRoutes } from './routes.js';
export type { HostelRoutesOptions } from './routes.js';
