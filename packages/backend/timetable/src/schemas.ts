import { Type, type Static } from '@sinclair/typebox';

export const UuidParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
});
export type UuidParams = Static<typeof UuidParamsSchema>;

export const BellScheduleIdParamsSchema = Type.Object({
  bellScheduleId: Type.String({ minLength: 1 }),
});
export type BellScheduleIdParams = Static<typeof BellScheduleIdParamsSchema>;

export const CreateBellScheduleSchema = Type.Object({
  institutionId: Type.String({ minLength: 1 }),
  academicPeriodId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  dayPattern: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
});
export type CreateBellScheduleInput = Static<typeof CreateBellScheduleSchema>;

export const UpdateBellScheduleSchema = Type.Object({
  institutionId: Type.Optional(Type.String({ minLength: 1 })),
  academicPeriodId: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  dayPattern: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
});
export type UpdateBellScheduleInput = Static<typeof UpdateBellScheduleSchema>;

export const CreatePeriodSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  periodOrder: Type.Integer({ minimum: 1 }),
  startTime: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
  endTime: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
});
export type CreatePeriodInput = Static<typeof CreatePeriodSchema>;

export const UpdatePeriodSchema = Type.Partial(CreatePeriodSchema);
export type UpdatePeriodInput = Static<typeof UpdatePeriodSchema>;

export const CreateMeetingSchema = Type.Object({
  institutionId: Type.String({ minLength: 1 }),
  academicPeriodId: Type.String({ minLength: 1 }),
  sectionId: Type.String({ minLength: 1 }),
  subjectId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  staffId: Type.String({ minLength: 1 }),
  periodId: Type.String({ minLength: 1 }),
  roomId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  /** ISO weekday: 1=Monday … 7=Sunday */
  dayOfWeek: Type.Integer({ minimum: 1, maximum: 7 }),
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
});
export type CreateMeetingInput = Static<typeof CreateMeetingSchema>;

export const UpdateMeetingSchema = Type.Partial(CreateMeetingSchema);
export type UpdateMeetingInput = Static<typeof UpdateMeetingSchema>;

export const CreateSubstitutionSchema = Type.Object({
  sectionMeetingId: Type.String({ minLength: 1 }),
  substituteStaffId: Type.String({ minLength: 1 }),
  substitutionDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  originalStaffId: Type.Optional(Type.String({ minLength: 1 })),
  institutionId: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
});
export type CreateSubstitutionInput = Static<typeof CreateSubstitutionSchema>;
