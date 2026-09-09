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

export const MarkTaughtSchema = Type.Object({
  timetableMeetingId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  lmsSkillId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
});
export type MarkTaughtInput = Static<typeof MarkTaughtSchema>;
