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
  HostelRepository,
} from './hostel-repository.js';

export { InMemoryHostelRepository } from './in-memory-repository.js';

export {
  CreateHostelSchema,
  CreateAssignmentSchema,
  CreateLeaveSchema,
  CreateVisitorSchema,
  HostelParamsSchema,
} from './schemas.js';
export type {
  CreateHostelInput,
  CreateAssignmentInput,
  CreateLeaveInput,
  CreateVisitorInput,
} from './schemas.js';

export { registerHostelRoutes } from './routes.js';
export type { HostelRoutesOptions } from './routes.js';
