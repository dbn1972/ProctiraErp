import { Type, type Static } from '@sinclair/typebox';

const StatusUnion = Type.Union([
  Type.Literal('PRESENT'),
  Type.Literal('ABSENT'),
  Type.Literal('LATE'),
  Type.Literal('EXCUSED'),
  Type.Literal('EARLY_DEPARTURE'),
]);

export const CreateRegularisationSchema = Type.Object({
  attendanceId: Type.String({ minLength: 1 }),
  studentId: Type.String({ minLength: 1 }),
  institutionId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
  attendanceDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  fromStatus: Type.String({ minLength: 1 }),
  toStatus: StatusUnion,
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateRegularisationInput = Static<typeof CreateRegularisationSchema>;

export const DecideRequestSchema = Type.Object({
  decisionNote: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type DecideRequestInput = Static<typeof DecideRequestSchema>;

export const CreateLeaveRequestSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  institutionId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
  academicPeriodId: Type.String({ minLength: 1 }),
  fromDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  toDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
  attachmentUrl: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateLeaveRequestInput = Static<typeof CreateLeaveRequestSchema>;

export const RegisterDeviceSchema = Type.Object({
  institutionId: Type.String({ minLength: 1 }),
  deviceId: Type.String({ minLength: 1, maxLength: 120 }),
  label: Type.Optional(Type.String({ maxLength: 255 })),
});
export type RegisterDeviceInput = Static<typeof RegisterDeviceSchema>;

export const IngestPunchEventSchema = Type.Object({
  eventId: Type.String({ minLength: 1, maxLength: 120 }),
  studentId: Type.String({ minLength: 1 }),
  punchedAt: Type.String({ minLength: 1 }),
  type: Type.Union([Type.Literal('IN'), Type.Literal('OUT')]),
  classId: Type.Optional(Type.String({ minLength: 1 })),
  academicPeriodId: Type.Optional(Type.String({ minLength: 1 })),
});
export type IngestPunchEventInput = Static<typeof IngestPunchEventSchema>;

export const IngestBatchSchema = Type.Object({
  deviceId: Type.String({ minLength: 1, maxLength: 120 }),
  institutionId: Type.String({ minLength: 1 }),
  events: Type.Array(IngestPunchEventSchema, { minItems: 1, maxItems: 500 }),
});
export type IngestBatchInput = Static<typeof IngestBatchSchema>;
