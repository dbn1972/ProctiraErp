/**
 * TypeBox schemas for the LMS API (assignments · homework · quizzes · Spiral PAL).
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const Uuid = Type.String({ pattern: UUID_PATTERN });
const IsoDateTime = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})$',
  description: 'ISO-8601 timestamp',
});

export const LmsScopeSchema = Type.Union([Type.Literal('board'), Type.Literal('school')]);
export const AssignmentKindSchema = Type.Union([
  Type.Literal('assignment'),
  Type.Literal('homework'),
  Type.Literal('quiz'),
]);
export const AssignmentStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('published'),
  Type.Literal('closed'),
  Type.Literal('archived'),
]);

/** Scope target: board-shared or school-owned. */
const ScopeFields = {
  scope: LmsScopeSchema,
  boardId: Type.Optional(Uuid),
  institutionId: Type.Optional(Uuid),
};

export const CreateSkillSchema = Type.Object({
  ...ScopeFields,
  code: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  subject: Type.String({ minLength: 1, maxLength: 120 }),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  prerequisiteSkillIds: Type.Optional(Type.Array(Uuid, { maxItems: 50 })),
});
export type CreateSkillInput = Static<typeof CreateSkillSchema>;

export const QuizQuestionInputSchema = Type.Object({
  prompt: Type.String({ minLength: 1, maxLength: 4000 }),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), {
      minItems: 2,
      maxItems: 10,
    }),
  ),
  correctOptionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })),
  points: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
  skillId: Type.Optional(Uuid),
  explanation: Type.Optional(Type.String({ maxLength: 2000 })),
  questionType: Type.Optional(
    Type.Union([
      Type.Literal('mcq'),
      Type.Literal('msq'),
      Type.Literal('numeric'),
      Type.Literal('match'),
      Type.Literal('essay'),
    ]),
  ),
  bankId: Type.Optional(Uuid),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type QuizQuestionInput = Static<typeof QuizQuestionInputSchema>;

export const CreateAssignmentSchema = Type.Object({
  ...ScopeFields,
  kind: AssignmentKindSchema,
  title: Type.String({ minLength: 1, maxLength: 255 }),
  description: Type.Optional(Type.String({ maxLength: 10000 })),
  subject: Type.String({ minLength: 1, maxLength: 120 }),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  sectionId: Type.Optional(Uuid),
  skillIds: Type.Optional(Type.Array(Uuid, { maxItems: 50 })),
  maxScore: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100000 })),
  dueAt: Type.Optional(IsoDateTime),
  timeLimitMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
  allowLate: Type.Optional(Type.Boolean()),
  publish: Type.Optional(Type.Boolean()),
  questions: Type.Optional(Type.Array(QuizQuestionInputSchema, { maxItems: 200 })),
  bankQuestionIds: Type.Optional(Type.Array(Uuid, { maxItems: 200 })),
  rubricId: Type.Optional(Uuid),
});
export type CreateAssignmentInput = Static<typeof CreateAssignmentSchema>;

export const UpdateAssignmentSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  description: Type.Optional(Type.String({ maxLength: 10000 })),
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  sectionId: Type.Optional(Uuid),
  skillIds: Type.Optional(Type.Array(Uuid, { maxItems: 50 })),
  maxScore: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100000 })),
  dueAt: Type.Optional(Type.Union([IsoDateTime, Type.Null()])),
  timeLimitMinutes: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1, maximum: 600 }), Type.Null()]),
  ),
  allowLate: Type.Optional(Type.Boolean()),
  status: Type.Optional(AssignmentStatusSchema),
  questions: Type.Optional(Type.Array(QuizQuestionInputSchema, { maxItems: 200 })),
});
export type UpdateAssignmentInput = Static<typeof UpdateAssignmentSchema>;

export const AssignmentListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  kind: Type.Optional(AssignmentKindSchema),
  status: Type.Optional(AssignmentStatusSchema),
  scope: Type.Optional(LmsScopeSchema),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  sectionId: Type.Optional(Uuid),
  search: Type.Optional(Type.String({ maxLength: 200 })),
  dueBefore: Type.Optional(IsoDateTime),
  dueAfter: Type.Optional(IsoDateTime),
});
export type AssignmentListQuery = Static<typeof AssignmentListQuerySchema>;

export const SkillListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  scope: Type.Optional(LmsScopeSchema),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  search: Type.Optional(Type.String({ maxLength: 200 })),
});
export type SkillListQuery = Static<typeof SkillListQuerySchema>;

export const SubmissionAnswerSchema = Type.Object({
  questionId: Uuid,
  selectedOptionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })),
  selectedOptionIndexes: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 20 }))),
  numericValue: Type.Optional(Type.Number()),
  matches: Type.Optional(
    Type.Array(
      Type.Object({
        leftIndex: Type.Integer({ minimum: 0 }),
        rightIndex: Type.Integer({ minimum: 0 }),
      }),
    ),
  ),
  essayText: Type.Optional(Type.String({ maxLength: 20000 })),
});

export const CreateSubmissionSchema = Type.Object({
  studentId: Uuid,
  institutionId: Type.Optional(Uuid),
  content: Type.Optional(Type.String({ maxLength: 20000 })),
  attachments: Type.Optional(Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 20 })),
  answers: Type.Optional(Type.Array(SubmissionAnswerSchema, { maxItems: 200 })),
});
export type CreateSubmissionInput = Static<typeof CreateSubmissionSchema>;

export const GradeSubmissionSchema = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 100000 }),
  feedback: Type.Optional(Type.String({ maxLength: 5000 })),
  returnToStudent: Type.Optional(Type.Boolean()),
});
export type GradeSubmissionInput = Static<typeof GradeSubmissionSchema>;

export const SubmissionListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  assignmentId: Type.Optional(Uuid),
  studentId: Type.Optional(Uuid),
  status: Type.Optional(
    Type.Union([
      Type.Literal('submitted'),
      Type.Literal('late'),
      Type.Literal('graded'),
      Type.Literal('returned'),
    ]),
  ),
});
export type SubmissionListQuery = Static<typeof SubmissionListQuerySchema>;

export const RecordAttemptSchema = Type.Object({
  skillId: Uuid,
  correct: Type.Boolean(),
  responseTimeMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600_000 })),
  institutionId: Type.Optional(Uuid),
});
export type RecordAttemptInput = Static<typeof RecordAttemptSchema>;

export const PlanQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
});
export type PlanQuery = Static<typeof PlanQuerySchema>;

export const IdParamsSchema = Type.Object({ id: Uuid });
export type IdParams = Static<typeof IdParamsSchema>;

export const StudentParamsSchema = Type.Object({ studentId: Uuid });
export type StudentParams = Static<typeof StudentParamsSchema>;

export const QuestionTypeSchema = Type.Union([
  Type.Literal('mcq'),
  Type.Literal('msq'),
  Type.Literal('numeric'),
  Type.Literal('match'),
  Type.Literal('essay'),
]);

export const BankQuestionPayloadSchema = Type.Record(Type.String(), Type.Unknown());

export const CreateBankQuestionSchema = Type.Object({
  ...ScopeFields,
  subject: Type.String({ minLength: 1, maxLength: 120 }),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 30 })),
  questionType: QuestionTypeSchema,
  prompt: Type.String({ minLength: 1, maxLength: 8000 }),
  payload: Type.Optional(BankQuestionPayloadSchema),
  points: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
  skillId: Type.Optional(Uuid),
  rubricId: Type.Optional(Uuid),
  difficulty: Type.Optional(
    Type.Union([Type.Literal('easy'), Type.Literal('medium'), Type.Literal('hard')]),
  ),
});
export type CreateBankQuestionInput = Static<typeof CreateBankQuestionSchema>;

export const BankListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  scope: Type.Optional(LmsScopeSchema),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  questionType: Type.Optional(QuestionTypeSchema),
  tags: Type.Optional(Type.String({ maxLength: 400 })),
  search: Type.Optional(Type.String({ maxLength: 200 })),
});
export type BankListQuery = Static<typeof BankListQuerySchema>;

export const AssembleFromBankSchema = Type.Object({
  questionIds: Type.Array(Uuid, { minItems: 1, maxItems: 200 }),
});
export type AssembleFromBankInput = Static<typeof AssembleFromBankSchema>;

export const RubricLevelSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 80 }),
  points: Type.Number({ minimum: 0, maximum: 1000 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
});

export const RubricCriterionInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  maxPoints: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
  levels: Type.Array(RubricLevelSchema, { minItems: 1, maxItems: 8 }),
});

export const CreateRubricSchema = Type.Object({
  ...ScopeFields,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  criteria: Type.Array(RubricCriterionInputSchema, { minItems: 1, maxItems: 20 }),
});
export type CreateRubricInput = Static<typeof CreateRubricSchema>;

export const RubricScoreInputSchema = Type.Object({
  criterionId: Uuid,
  questionId: Type.Optional(Uuid),
  levelIndex: Type.Integer({ minimum: 0, maximum: 20 }),
  points: Type.Number({ minimum: 0, maximum: 1000 }),
  comment: Type.Optional(Type.String({ maxLength: 2000 })),
});

export const GradeRubricSchema = Type.Object({
  questionId: Type.Optional(Uuid),
  scores: Type.Array(RubricScoreInputSchema, { minItems: 1, maxItems: 40 }),
  feedback: Type.Optional(Type.String({ maxLength: 5000 })),
  returnToStudent: Type.Optional(Type.Boolean()),
});
export type GradeRubricInput = Static<typeof GradeRubricSchema>;

export const UploadFileSchema = Type.Object({
  filename: Type.String({ minLength: 1, maxLength: 200 }),
  mimeType: Type.String({ minLength: 1, maxLength: 200 }),
  contentBase64: Type.String({ minLength: 1 }),
  submissionId: Type.Optional(Uuid),
});
export type UploadFileInput = Static<typeof UploadFileSchema>;

export const CreateDiscussionSchema = Type.Object({
  institutionId: Type.Optional(Uuid),
  classKey: Type.String({ minLength: 1, maxLength: 120 }),
  title: Type.String({ minLength: 1, maxLength: 255 }),
});
export type CreateDiscussionInput = Static<typeof CreateDiscussionSchema>;

export const DiscussionListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  institutionId: Type.Optional(Uuid),
  classKey: Type.Optional(Type.String({ maxLength: 120 })),
});

export const CreatePostSchema = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 8000 }),
  parentId: Type.Optional(Uuid),
});
export type CreatePostInput = Static<typeof CreatePostSchema>;

export const PinPostSchema = Type.Object({
  pinned: Type.Boolean(),
});

export const LockDiscussionSchema = Type.Object({
  locked: Type.Boolean(),
});

export const HidePostSchema = Type.Object({
  hidden: Type.Boolean(),
});

export const CreateLessonSchema = Type.Object({
  ...ScopeFields,
  title: Type.String({ minLength: 1, maxLength: 255 }),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  gradeLevel: Type.Optional(Type.String({ maxLength: 40 })),
  description: Type.Optional(Type.String({ maxLength: 10000 })),
  published: Type.Optional(Type.Boolean()),
});
export type CreateLessonInput = Static<typeof CreateLessonSchema>;

export const LessonListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  scope: Type.Optional(LmsScopeSchema),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  published: Type.Optional(Type.Boolean()),
});

export const CreateLessonResourceSchema = Type.Object({
  kind: Type.Union([Type.Literal('link'), Type.Literal('file'), Type.Literal('video')]),
  title: Type.String({ minLength: 1, maxLength: 255 }),
  url: Type.Optional(Type.String({ maxLength: 2048 })),
  mimeType: Type.Optional(Type.String({ maxLength: 200 })),
  contentBase64: Type.Optional(Type.String({ minLength: 1 })),
});
export type CreateLessonResourceInput = Static<typeof CreateLessonResourceSchema>;

export const CreateContentItemSchema = Type.Object({
  ...ScopeFields,
  title: Type.String({ minLength: 1, maxLength: 255 }),
  kind: Type.Union([Type.Literal('link'), Type.Literal('file'), Type.Literal('text')]),
  body: Type.Optional(Type.String({ maxLength: 20000 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 30 })),
  classKey: Type.Optional(Type.String({ maxLength: 120 })),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  published: Type.Optional(Type.Boolean()),
  mimeType: Type.Optional(Type.String({ maxLength: 200 })),
  contentBase64: Type.Optional(Type.String({ minLength: 1 })),
});
export type CreateContentItemInput = Static<typeof CreateContentItemSchema>;

export const ContentListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  scope: Type.Optional(LmsScopeSchema),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
  subject: Type.Optional(Type.String({ maxLength: 120 })),
  classKey: Type.Optional(Type.String({ maxLength: 120 })),
  published: Type.Optional(Type.Boolean()),
});

export const ClassAnalyticsQuerySchema = Type.Object({
  classKey: Type.String({ minLength: 1, maxLength: 120 }),
  institutionId: Type.Optional(Uuid),
  boardId: Type.Optional(Uuid),
});
export type ClassAnalyticsQuery = Static<typeof ClassAnalyticsQuerySchema>;

export const FileIdParamsSchema = Type.Object({ id: Uuid });
export const PostIdParamsSchema = Type.Object({ id: Uuid, postId: Uuid });
