import { Type, type Static } from '@sinclair/typebox';

export const UpsertGradeEntrySchema = Type.Object({
  sectionId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  studentId: Type.String({ minLength: 1 }),
  assessmentCode: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
  numericScore: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])),
  letterGrade: Type.Optional(Type.Union([Type.String({ maxLength: 10 }), Type.Null()])),
  creditRuleCode: Type.Optional(Type.Union([Type.String({ maxLength: 50 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type UpsertGradeEntryInput = Static<typeof UpsertGradeEntrySchema>;

export const ComputeGpaSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  academicPeriodId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  boardId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  gradingScaleId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  passingPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  weightMode: Type.Optional(Type.Union([Type.Literal('CREDITS'), Type.Literal('EXPLICIT')])),
});
export type ComputeGpaInput = Static<typeof ComputeGpaSchema>;

export const CreateReportCardJobSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  boardId: Type.String({ minLength: 1 }),
  institutionId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  academicPeriodId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateReportCardJobInput = Static<typeof CreateReportCardJobSchema>;

export const IssueTranscriptSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  gpaSnapshotId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type IssueTranscriptInput = Static<typeof IssueTranscriptSchema>;

export const CreateCreditRuleSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  credits: Type.Number({ minimum: 0 }),
  boardId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateCreditRuleInput = Static<typeof CreateCreditRuleSchema>;

export const CreateBoardExportJobSchema = Type.Object({
  boardId: Type.Optional(Type.String({ minLength: 1 })),
  boardCode: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  institutionId: Type.String({ minLength: 1 }),
  studentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 500 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  /** When true, leave job QUEUED for deferred processBoardExportJob. */
  async: Type.Optional(Type.Boolean()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateBoardExportJobInput = Static<typeof CreateBoardExportJobSchema>;

export const TransitionGradeEntrySchema = Type.Object({
  action: Type.Union([
    Type.Literal('submit'),
    Type.Literal('approve'),
    Type.Literal('reject'),
    Type.Literal('lock'),
    Type.Literal('reopen'),
  ]),
});
export type TransitionGradeEntryInput = Static<typeof TransitionGradeEntrySchema>;
