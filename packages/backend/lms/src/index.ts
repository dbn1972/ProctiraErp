/**
 * @proctira/backend-lms — assignments, homework, quizzes and Spiral PAL
 * (Personalised Adaptive Learning) for ProctiraERP (Wave 8 / G-801, G-802).
 */
export { lmsPlugin, type LmsPluginOptions } from './lms-plugin.js';
export {
  LmsService,
  ForbiddenError as LmsForbiddenError,
  ANONYMOUS_ACTOR,
  canAuthor,
  isLearner,
  isTenantAdmin,
  type LmsActor,
  type AssignmentWithQuestions,
  type StudentProgress,
} from './lms-service.js';
export type {
  LmsRepository,
  LmsScope,
  AssignmentKind,
  AssignmentStatus,
  SubmissionStatus,
  AttemptSource,
  ScopeTarget,
  ScopeFilter,
  SkillEntity,
  SkillFilter,
  AssignmentEntity,
  AssignmentFilter,
  QuizQuestionEntity,
  SubmissionEntity,
  SubmissionAnswer,
  SubmissionFilter,
  SkillMasteryEntity,
  MasteryFilter,
  PracticeAttemptEntity,
  BankQuestionEntity,
  RubricEntity,
  AssignmentFileEntity,
  DiscussionEntity,
  LessonEntity,
} from './lms-repository.js';
export { InMemoryLmsRepository, matchesScope } from './in-memory-repository.js';
export { createLmsRepository, isPgLmsEnabled } from './create-lms-repository.js';
export { PgLmsRepository, getSharedLmsPool, ensureLmsSchema } from './pg-lms-repository.js';
export { gradeQuiz } from './spiral-pal.js';
export {
  applyAttempt,
  buildSpiralPlan,
  intervalForStreak,
  INITIAL_MASTERY,
  MASTERY_THRESHOLD,
  SPIRAL_INTERVALS_DAYS,
  STRUGGLING_THRESHOLD,
  type MasteryState,
  type SpiralPlan,
  type PlanItem,
} from './spiral-pal.js';
export {
  gradeMcq,
  gradeMsq,
  gradeNumeric,
  gradeMatch,
  gradeEssay,
  rubricTotal,
  itemDifficulty,
  gradeObjectiveQuiz,
} from './grading-engine.js';
export * from './schemas.js';
export { registerLmsRoutes, getLmsActor, type LmsRoutesOptions } from './routes.js';
