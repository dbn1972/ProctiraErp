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
  MessPlanEntity,
  GatePassEntity,
  HostelFeeStructureEntity,
  HostelAttendanceEntity,
  HostelRepository,
} from './hostel-repository.js';
export { BedAssignmentConflictError } from './hostel-repository.js';

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
  LeaveParamsSchema,
  DecideLeaveSchema,
  VisitorParamsSchema,
  UpdateVisitorStatusSchema,
  CreateMessPlanSchema,
  CreateGatePassSchema,
  CreateFeeStructureSchema,
  CreateAttendanceSchema,
} from './schemas.js';
export type {
  CreateHostelInput,
  CreateAssignmentInput,
  CreateLeaveInput,
  CreateVisitorInput,
  CreateBlockInput,
  CreateRoomInput,
  CreateBedInput,
  DecideLeaveInput,
  UpdateVisitorStatusInput,
  CreateMessPlanInput,
  CreateGatePassInput,
  CreateFeeStructureInput,
  CreateAttendanceInput,
} from './schemas.js';

export { canTransitionGatePass, isOverdueReturn } from './hostel-ops.js';

export { registerHostelRoutes } from './routes.js';
export type { HostelRoutesOptions } from './routes.js';

export type { HostelFeesPort } from './fees-ledger-port.js';
export { InMemoryHostelFeesPort } from './fees-ledger-port.js';
