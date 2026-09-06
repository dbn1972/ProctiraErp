/**
 * @proctira/backend-timetable — WS1 clash domain + foundation exports.
 *
 * Schema: db/sql/003_sis_timetable_schedule_schema.sql (UUID FKs, bell_periods).
 * Note: pg repository / Fastify routes that still target the TEXT/`periods`
 * stub shape are residual WS1 API work — see docs/audits/DEV_SIS_FOUNDATION.md.
 */

export {
  detectClashes,
  hasClashes,
  intervalsOverlap,
  timeToMinutes,
  type Clash,
  type ClashKind,
  type MeetingSlot,
} from './clash-detection.js';

export {
  detectMeetingClashes,
  detectSubstituteClashes,
  type ClashConflict,
  type ClashReason,
  type MeetingSlotLike,
  type SubstitutionSlotLike,
} from './clash-helper.js';

export {
  TimetableClashError,
  TimetableSchemaMissingError,
  isTimetableClashError,
  isTimetableSchemaMissingError,
} from './timetable-errors.js';

export type {
  TimetableRepository,
  BellScheduleEntity,
  PeriodEntity,
  SectionMeetingEntity,
  SubstitutionEntity,
} from './timetable-repository.js';
