/**
 * @proctira/backend-gradebook — WS3 gradebook, GPA, report cards, transcripts.
 *
 * Schema: db/sql/003_sis_timetable_schedule_schema.sql (+ 004 indexes)
 * Persistence: raw `pg` when DATABASE_URL is set; else in-memory.
 */

export {
  applyCreditRule,
  computeGpaSnapshot,
  resolveBandFromLetter,
  resolveBandFromPercent,
  resolveGradePoints,
  type CourseGradeInput,
  type CourseGpaResult,
  type GradeBand,
  type GpaPolicy,
  type GpaSnapshotResult,
} from './gpa-engine.js';

export {
  GradeLockedError,
  GradebookSchemaMissingError,
  TranscriptImmutableError,
  isGradeLockedError,
  isGradebookSchemaMissingError,
  isTranscriptImmutableError,
} from './gradebook-errors.js';

export { GradebookService } from './gradebook-service.js';
export { gradebookPlugin } from './gradebook-plugin.js';
export type { GradebookPluginOptions } from './gradebook-plugin.js';
export { registerGradebookRoutes } from './routes.js';
export type { GradebookRoutesOptions } from './routes.js';
export { createGradebookRepository } from './repository-factory.js';
export { InMemoryGradebookRepository } from './in-memory-repository.js';
export {
  PgGradebookRepository,
  createPgGradebookRepository,
  ensureGradebookSchema,
  isPgGradebookEnabled,
} from './pg-gradebook-repository.js';

export type {
  GradebookRepository,
  GradeEntryEntity,
  CreditRuleEntity,
  GradingScaleEntity,
  GpaSnapshotEntity,
  TranscriptIssuanceEntity,
  ExportJobEntity,
  SectionSummary,
} from './gradebook-repository.js';

export {
  UpsertGradeEntrySchema,
  ComputeGpaSchema,
  CreateReportCardJobSchema,
  IssueTranscriptSchema,
  CreateCreditRuleSchema,
} from './schemas.js';
