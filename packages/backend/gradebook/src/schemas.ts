import { Type, type Static } from '@sinclair/typebox';

/**
 * PRC-M515: ids bound to UUID columns are UUID-checked so a malformed id is a
 * 400 instead of a Postgres 22P02 -> 500. Fields stored only in jsonb metadata
 * (commentBankId, report-card studentId/academicPeriodId, transcript
 * institutionId) keep their existing free-string contract.
 */
export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const Uuid = Type.String({ pattern: UUID_PATTERN });
const NullableUuid = Type.Optional(Type.Union([Uuid, Type.Null()]));

export const UpsertGradeEntrySchema = Type.Object({
  sectionId: NullableUuid,
  studentId: Uuid,
  assessmentCode: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
  numericScore: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])),
  letterGrade: Type.Optional(Type.Union([Type.String({ maxLength: 10 }), Type.Null()])),
  creditRuleCode: Type.Optional(Type.Union([Type.String({ maxLength: 50 }), Type.Null()])),
  remark: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  commentBankId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type UpsertGradeEntryInput = Static<typeof UpsertGradeEntrySchema>;

export const ComputeGpaSchema = Type.Object({
  studentId: Uuid,
  academicPeriodId: NullableUuid,
  boardId: NullableUuid,
  gradingScaleId: NullableUuid,
  passingPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  weightMode: Type.Optional(Type.Union([Type.Literal('CREDITS'), Type.Literal('EXPLICIT')])),
});
export type ComputeGpaInput = Static<typeof ComputeGpaSchema>;

export const CreateReportCardJobSchema = Type.Object({
  studentId: Type.String({ minLength: 1 }),
  boardId: Uuid,
  institutionId: NullableUuid,
  academicPeriodId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateReportCardJobInput = Static<typeof CreateReportCardJobSchema>;

export const IssueTranscriptSchema = Type.Object({
  // PRC-H063: studentId becomes a filesystem path segment for transcript artifacts — UUID only.
  studentId: Type.String({
    pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  }),
  /** Institution scope for dedicated transcript signing keys (W1-DATA-08). */
  institutionId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  gpaSnapshotId: NullableUuid,
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type IssueTranscriptInput = Static<typeof IssueTranscriptSchema>;

export const CreateCreditRuleSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  credits: Type.Number({ minimum: 0 }),
  boardId: NullableUuid,
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CreateCreditRuleInput = Static<typeof CreateCreditRuleSchema>;

export const CreateBoardExportJobSchema = Type.Object({
  boardId: Type.Optional(Uuid),
  boardCode: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  institutionId: Uuid,
  studentIds: Type.Optional(Type.Array(Uuid, { maxItems: 500 })),
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
    Type.Literal('publish'),
    Type.Literal('reopen'),
  ]),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});
export type TransitionGradeEntryInput = Static<typeof TransitionGradeEntrySchema>;

export const BulkTransitionGradeEntriesSchema = Type.Object({
  ids: Type.Array(Uuid, { minItems: 1, maxItems: 200 }),
  action: TransitionGradeEntrySchema.properties.action,
});
export type BulkTransitionGradeEntriesInput = Static<typeof BulkTransitionGradeEntriesSchema>;

export const ComputeClassRankSchema = Type.Object({
  sectionId: Uuid,
  academicPeriodId: NullableUuid,
  boardId: NullableUuid,
  persist: Type.Optional(Type.Boolean()),
});
export type ComputeClassRankInput = Static<typeof ComputeClassRankSchema>;

export const UpsertCommentsBankSchema = Type.Object({
  institutionId: NullableUuid,
  subjectId: NullableUuid,
  gradeBand: Type.Optional(Type.Union([Type.String({ maxLength: 20 }), Type.Null()])),
  label: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
});
export type UpsertCommentsBankInput = Static<typeof UpsertCommentsBankSchema>;
