/**
 * @proctira/backend-timetable — WS1 bell/substitutions + WS2 master schedule.
 *
 * Schema: db/sql/003_sis_timetable_schedule_schema.sql
 * Persistence: raw `pg` when DATABASE_URL is set; else in-memory.
 */

export {
  detectClashes,
  detectRoomAndTeacherClashes,
  hasClashes,
  intervalsOverlap,
  timeToMinutes,
  type Clash,
  type ClashKind,
  type MeetingSlot,
} from './clash-detection.js';

export { detectMeetingClashes, detectSubstituteClashes } from './clash-helper.js';
export type {
  ClashConflict,
  ClashReason,
  MeetingSlotLike,
  SubstitutionSlotLike,
} from './clash-helper.js';

export {
  TimetableClashError,
  TimetableSchemaMissingError,
  isTimetableClashError,
  isTimetableSchemaMissingError,
} from './timetable-errors.js';

export { TimetableService } from './timetable-service.js';
export type { TimetableAuditEntry } from './timetable-service.js';
export {
  assertTimetableAccess,
  hasTimetableAccess,
  normalizeTimetableRoles,
  type TimetableAction,
} from './timetable-access.js';
export { timetablePlugin } from './timetable-plugin.js';
export type { TimetablePluginOptions } from './timetable-plugin.js';
export { registerTimetableRoutes } from './routes.js';
export type { TimetableRoutesOptions } from './routes.js';
export { createTimetableRepository } from './repository-factory.js';
export { InMemoryTimetableRepository } from './in-memory-repository.js';
export {
  PgTimetableRepository,
  createPgTimetableRepository,
  ensureTimetableSchema,
  isPgTimetableEnabled,
} from './pg-timetable-repository.js';

export type {
  TimetableRepository,
  BellScheduleEntity,
  PeriodEntity,
  RoomEntity,
  SectionEntity,
  SectionEnrollmentEntity,
  SectionMeetingEntity,
  SectionPublishStatus,
  SubstitutionEntity,
  AttendancePeriodSlot,
} from './timetable-repository.js';

export {
  CreateBellScheduleSchema,
  UpdateBellScheduleSchema,
  CreatePeriodSchema,
  UpdatePeriodSchema,
  CreateMeetingSchema,
  UpdateMeetingSchema,
  CreateSubstitutionSchema,
  CreateSectionSchema,
  UpdateSectionSchema,
  EnrollStudentSchema,
  BulkEnrollStudentsSchema,
  CreateRoomSchema,
} from './schemas.js';
