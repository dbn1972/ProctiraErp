/**
 * G-923 — curriculum TypeBox schemas.
 */
import { Type, type Static } from '@sinclair/typebox';

export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const CreateSyllabusUnitSchema = Type.Object({
  institutionId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  gradeId: Type.String({ pattern: UUID_PATTERN }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  sequence: Type.Optional(Type.Integer({ minimum: 1 })),
  planned: Type.Optional(Type.Boolean()),
  notes: Type.Optional(Type.String({ maxLength: 4000 })),
});
export type CreateSyllabusUnitInput = Static<typeof CreateSyllabusUnitSchema>;

export const CreateLessonPlanSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 255 }),
  objectives: Type.Optional(Type.String({ maxLength: 4000 })),
  plannedDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});
export type CreateLessonPlanInput = Static<typeof CreateLessonPlanSchema>;

export const CreateLearningOutcomeSchema = Type.Object({
  unitId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  gradeId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  statement: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type CreateLearningOutcomeInput = Static<typeof CreateLearningOutcomeSchema>;

// ─── PRC-L288: PATCH bodies, :id params and list/coverage filters ───────────
// PATCH strings keep no max length (TEXT columns; today's edits stay accepted)
// but NOT NULL fields must be non-empty, ids/dates must be well-formed, and
// `null` clears a nullable column while an omitted key leaves it unchanged.

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const NullableUuid = Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()]);

export const UpdateLessonPlanSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1 })),
  objectives: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plannedDate: Type.Optional(Type.Union([Type.String({ pattern: DATE_PATTERN }), Type.Null()])),
});
export type UpdateLessonPlanInput = Static<typeof UpdateLessonPlanSchema>;

export const UpdateLearningOutcomeSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1 })),
  statement: Type.Optional(Type.String({ minLength: 1 })),
  unitId: Type.Optional(NullableUuid),
  gradeId: Type.Optional(NullableUuid),
});
export type UpdateLearningOutcomeInput = Static<typeof UpdateLearningOutcomeSchema>;

export const IdParamsSchema = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) });

const OptionalUuid = Type.Optional(Type.String({ pattern: UUID_PATTERN }));

export const ListUnitsQuerySchema = Type.Object({
  institutionId: OptionalUuid,
  subjectId: OptionalUuid,
  gradeId: OptionalUuid,
  academicPeriodId: OptionalUuid,
});
export type ListUnitsQuery = Static<typeof ListUnitsQuerySchema>;

export const ListOutcomesQuerySchema = Type.Object({
  subjectId: OptionalUuid,
  unitId: OptionalUuid,
  gradeId: OptionalUuid,
});
export type ListOutcomesQuery = Static<typeof ListOutcomesQuerySchema>;

export const CoverageQuerySchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN }),
  gradeId: Type.String({ pattern: UUID_PATTERN }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN }),
  institutionId: OptionalUuid,
});
export type CoverageQuery = Static<typeof CoverageQuerySchema>;

/**
 * Upper bound for `GET /lesson-plans?unitIds=`: at ~39 encoded chars per id the
 * request line already nears Node's 16 KiB header limit, so no request that
 * works today is rejected.
 */
export const MAX_LESSON_PLAN_UNIT_IDS = 400;

export const MarkTaughtSchema = Type.Object({
  timetableMeetingId: Type.Optional(
    Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()]),
  ),
  lmsSkillId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
});
export type MarkTaughtInput = Static<typeof MarkTaughtSchema>;
