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
