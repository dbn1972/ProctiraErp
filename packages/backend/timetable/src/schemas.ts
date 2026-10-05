import { Type, type Static } from '@sinclair/typebox';

/** PRC-M399: canonical UUID (any version) so malformed ids are 400, never a PG 22P02 -> 500. */
export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
/** 24h wall-clock time 00:00–23:59. */
export const HHMM_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
/** Calendar date shape; real-date validity is checked by isValidIsoDate. */
export const ISO_DATE_PATTERN = '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$';

const Uuid = () => Type.String({ pattern: UUID_PATTERN });

/**
 * Review #554: a generation demand's subject is a solver grouping key (spread a section's
 * subject across days), never a DB reference — it is not persisted and never looked up, so it
 * carries no tenant scope. Accept a subject UUID or a short subject code (e.g. `math`), but
 * keep it a bounded identifier rather than free text.
 */
export const SUBJECT_REF_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$';
const SubjectRef = () => Type.String({ pattern: SUBJECT_REF_PATTERN, maxLength: 64 });

/** True when `value` is a real YYYY-MM-DD calendar date (rejects 2025-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!new RegExp(ISO_DATE_PATTERN).test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const MeetingStatusEnum = Type.Union([
  Type.Literal('active'),
  Type.Literal('inactive'),
  Type.Literal('cancelled'),
]);
export const BellScheduleStatusEnum = Type.Union([
  Type.Literal('active'),
  Type.Literal('inactive'),
  Type.Literal('archived'),
]);
export const RoomStatusEnum = Type.Union([Type.Literal('active'), Type.Literal('inactive')]);
export const SubstitutionStatusEnum = Type.Union([
  Type.Literal('scheduled'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
  Type.Literal('SCHEDULED'),
  Type.Literal('COMPLETED'),
  Type.Literal('CANCELLED'),
]);
export const SectionStatusEnum = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('PUBLISHED'),
  Type.Literal('ARCHIVED'),
]);
/** Room type code (e.g. CLASSROOM, LAB): upper-case identifier, not free text. */
const RoomType = () => Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,49}$' });

export const UuidParamsSchema = Type.Object({
  id: Uuid(),
});
export type UuidParams = Static<typeof UuidParamsSchema>;

export const BellScheduleIdParamsSchema = Type.Object({
  bellScheduleId: Uuid(),
});
export type BellScheduleIdParams = Static<typeof BellScheduleIdParamsSchema>;

export const CreateBellScheduleSchema = Type.Object({
  institutionId: Uuid(),
  academicPeriodId: Uuid(),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  dayPattern: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  status: Type.Optional(BellScheduleStatusEnum),
});
export type CreateBellScheduleInput = Static<typeof CreateBellScheduleSchema>;

/**
 * PRC-M405: only persisted columns are accepted; institution/academic period are immutable
 * (re-create the schedule instead), and unknown keys are rejected rather than silently dropped.
 */
export const UpdateBellScheduleSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
    dayPattern: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    status: Type.Optional(BellScheduleStatusEnum),
  },
  { additionalProperties: false },
);
export type UpdateBellScheduleInput = Static<typeof UpdateBellScheduleSchema>;

export const CreatePeriodSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  periodOrder: Type.Integer({ minimum: 1 }),
  startTime: Type.String({ pattern: HHMM_PATTERN }),
  endTime: Type.String({ pattern: HHMM_PATTERN }),
});
export type CreatePeriodInput = Static<typeof CreatePeriodSchema>;

export const UpdatePeriodSchema = Type.Partial(CreatePeriodSchema, { additionalProperties: false });
export type UpdatePeriodInput = Static<typeof UpdatePeriodSchema>;

export const CreateMeetingSchema = Type.Object({
  institutionId: Uuid(),
  academicPeriodId: Uuid(),
  sectionId: Uuid(),
  subjectId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  staffId: Uuid(),
  periodId: Uuid(),
  roomId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  /** ISO weekday: 1=Monday … 7=Sunday */
  dayOfWeek: Type.Integer({ minimum: 1, maximum: 7 }),
  status: Type.Optional(MeetingStatusEnum),
});
export type CreateMeetingInput = Static<typeof CreateMeetingSchema>;

/** PRC-M405: institution / academic period / subject are not updatable on a meeting row. */
export const UpdateMeetingSchema = Type.Partial(
  Type.Omit(CreateMeetingSchema, ['institutionId', 'academicPeriodId', 'subjectId']),
  { additionalProperties: false },
);
export type UpdateMeetingInput = Static<typeof UpdateMeetingSchema>;

export const CreateSubstitutionSchema = Type.Object({
  sectionMeetingId: Uuid(),
  substituteStaffId: Uuid(),
  substitutionDate: Type.String({ pattern: ISO_DATE_PATTERN }),
  originalStaffId: Type.Optional(Uuid()),
  institutionId: Type.Optional(Uuid()),
  reason: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  status: Type.Optional(SubstitutionStatusEnum),
});
export type CreateSubstitutionInput = Static<typeof CreateSubstitutionSchema>;

export const CreateSectionSchema = Type.Object({
  institutionId: Uuid(),
  academicPeriodId: Uuid(),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  gradeId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  primaryTeacherId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  defaultRoomId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  capacity: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
export type CreateSectionInput = Static<typeof CreateSectionSchema>;

export const UpdateSectionSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  gradeId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  primaryTeacherId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  defaultRoomId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  capacity: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
export type UpdateSectionInput = Static<typeof UpdateSectionSchema>;

export const EnrollStudentSchema = Type.Object({
  studentId: Uuid(),
});
export type EnrollStudentInput = Static<typeof EnrollStudentSchema>;

/** Bulk roster assign (G-304). Dedupes studentIds; partial success returned per row. */
export const BulkEnrollStudentsSchema = Type.Object({
  studentIds: Type.Array(Uuid(), { minItems: 1, maxItems: 200 }),
});
export type BulkEnrollStudentsInput = Static<typeof BulkEnrollStudentsSchema>;

export const CreateRoomSchema = Type.Object({
  institutionId: Uuid(),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  capacity: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
  roomType: Type.Optional(RoomType()),
  status: Type.Optional(RoomStatusEnum),
});
export type CreateRoomInput = Static<typeof CreateRoomSchema>;

const DemandSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  sectionId: Uuid(),
  subjectId: SubjectRef(),
  staffId: Uuid(),
  periodsPerWeek: Type.Integer({ minimum: 1, maximum: 20 }),
  preferredRoomId: Type.Optional(Type.Union([Uuid(), Type.Null()])),
  enrollmentCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
});

export const CreateGenerationJobSchema = Type.Object({
  institutionId: Uuid(),
  academicPeriodId: Uuid(),
  bellScheduleId: Type.Optional(Uuid()),
  persistMeetings: Type.Optional(Type.Boolean()),
  teacherMaxPeriodsPerDay: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
  daysOfWeek: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), { maxItems: 7 })),
  demands: Type.Array(DemandSchema, { minItems: 1, maxItems: 400 }),
  unavailable: Type.Optional(
    Type.Array(
      Type.Object({
        staffId: Uuid(),
        dayOfWeek: Type.Integer({ minimum: 1, maximum: 7 }),
        periodId: Uuid(),
      }),
      { maxItems: 400 },
    ),
  ),
});
export type CreateGenerationJobInput = Static<typeof CreateGenerationJobSchema>;

export const CreateTeacherAbsenceSchema = Type.Object({
  institutionId: Uuid(),
  staffId: Uuid(),
  absenceDate: Type.String({ pattern: ISO_DATE_PATTERN }),
  reason: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
});
export type CreateTeacherAbsenceInput = Static<typeof CreateTeacherAbsenceSchema>;
