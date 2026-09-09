/**
 * Typebox schemas for examination ops (G-908):
 * sessions, invigilators, seating, double marks entry, re-evaluation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export const ExaminationIdParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Examination UUID' }),
});
export type ExaminationIdParams = Static<typeof ExaminationIdParamsSchema>;

export const SessionIdParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
  sessionId: Type.String({ pattern: UUID_PATTERN }),
});
export type SessionIdParams = Static<typeof SessionIdParamsSchema>;

export const AllocationParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
  sessionId: Type.String({ pattern: UUID_PATTERN }),
  allocationId: Type.String({ pattern: UUID_PATTERN }),
});
export type AllocationParams = Static<typeof AllocationParamsSchema>;

export const ReevaluationParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
  requestId: Type.String({ pattern: UUID_PATTERN }),
});
export type ReevaluationParams = Static<typeof ReevaluationParamsSchema>;

export const CreateExamSessionSchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  date: Type.String({ pattern: DATE_PATTERN }),
  startTime: Type.String({ pattern: TIME_PATTERN }),
  endTime: Type.String({ pattern: TIME_PATTERN }),
  roomId: Type.String({ minLength: 1, maxLength: 100 }),
  centerId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});
export type CreateExamSessionInput = Static<typeof CreateExamSessionSchema>;

export const AllocateInvigilatorSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN }),
});
export type AllocateInvigilatorInput = Static<typeof AllocateInvigilatorSchema>;

export const GenerateSeatingSchema = Type.Object({
  sessionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  seatsPerRoom: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
});
export type GenerateSeatingInput = Static<typeof GenerateSeatingSchema>;

export const RecordDoubleEntrySchema = Type.Object({
  candidateId: Type.String({ pattern: UUID_PATTERN }),
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  entryNo: Type.Union([Type.Literal(1), Type.Literal(2)]),
  marks: Type.Number({ minimum: 0 }),
  tolerance: Type.Optional(Type.Number({ minimum: 0 })),
});
export type RecordDoubleEntryInput = Static<typeof RecordDoubleEntrySchema>;

export const ResolveMarksSchema = Type.Object({
  candidateId: Type.String({ pattern: UUID_PATTERN }),
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  finalMarks: Type.Number({ minimum: 0 }),
});
export type ResolveMarksInput = Static<typeof ResolveMarksSchema>;

export const CreateReevaluationSchema = Type.Object({
  candidateId: Type.String({ pattern: UUID_PATTERN }),
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  originalMarks: Type.Optional(Type.Number({ minimum: 0 })),
  feeRequired: Type.Optional(Type.Boolean()),
  feeAmount: Type.Optional(Type.Number({ minimum: 0 })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
  requesterRole: Type.Optional(
    Type.Union([Type.Literal('student'), Type.Literal('parent'), Type.Literal('staff')]),
  ),
});
export type CreateReevaluationInput = Static<typeof CreateReevaluationSchema>;

export const AssignReevaluationSchema = Type.Object({
  evaluatorId: Type.String({ pattern: UUID_PATTERN }),
});
export type AssignReevaluationInput = Static<typeof AssignReevaluationSchema>;

export const CompleteReevaluationSchema = Type.Object({
  revisedMarks: Type.Number({ minimum: 0 }),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CompleteReevaluationInput = Static<typeof CompleteReevaluationSchema>;

export const RejectReevaluationSchema = Type.Object({
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type RejectReevaluationInput = Static<typeof RejectReevaluationSchema>;
