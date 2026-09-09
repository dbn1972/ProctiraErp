/**
 * @proctira/backend-gradebook — WS3 gradebook + WS4 board export packs.
 *
 * Schema: db/sql/003_sis_timetable_schedule_schema.sql (+ 004 indexes)
 * Persistence: raw `pg` when DATABASE_URL is set; else in-memory.
 */

export {
  applyCreditRule,
  computeCgpa,
  computeClassRanks,
  computeGpaSnapshot,
  resolveBandFromLetter,
  resolveBandFromPercent,
  resolveGradePoints,
  type CourseGradeInput,
  type CourseGpaResult,
  type GradeBand,
  type GpaPolicy,
  type ClassRankInput,
  type ClassRankRow,
  type GpaSnapshotResult,
} from './gpa-engine.js';

export {
  BOARD_PACKS,
  getBoardPack,
  isBoardPackCode,
  listBoardPacks,
  type BoardPackCode,
  type BoardPackDefinition,
  type BoardPackField,
} from './board-pack-registry.js';

export {
  assertBoardExportCompleteness,
  validateBoardExportCompleteness,
  type IncompleteGradeDetail,
} from './board-export-validation.js';

export {
  buildExamResultsJson,
  buildMarksheetCsv,
  buildPdfLiteHtml,
  writeBoardExportArtifacts,
  type BoardExportArtifacts,
  type BoardExportContext,
} from './board-export-generator.js';

export {
  GradeLockedError,
  GradebookSchemaMissingError,
  TranscriptImmutableError,
  isGradeLockedError,
  isGradebookSchemaMissingError,
  isTranscriptImmutableError,
} from './gradebook-errors.js';

export { GradebookService } from './gradebook-service.js';
export type { GradebookAuditEntry } from './gradebook-service.js';
export {
  assertGradebookAccess,
  hasGradebookAccess,
  normalizeRoles,
  type GradebookAction,
} from './gradebook-access.js';
export {
  GRADE_WORKFLOW_ACTIONS,
  GRADE_WORKFLOW_STATUSES,
  isGradePublished,
  isGradeWorkflowAction,
  readGradeWorkflowStatus,
  transitionGradeWorkflow,
  type GradeWorkflowAction,
  type GradeWorkflowStatus,
} from './grade-workflow.js';
export {
  createBoardExportDownloadToken,
  signTranscriptChecksum,
  verifyBoardExportDownloadToken,
  verifyTranscriptSignature,
  type BoardExportSignedDownload,
} from './signed-download.js';
export {
  buildTranscriptPdf,
  buildTranscriptPdfLiteHtml,
  writeTranscriptPdfLite,
  transcriptArtifactRoot,
} from './transcript-artifact.js';
export type { TranscriptArtifactInput } from './transcript-artifact.js';
export { gradebookPlugin } from './gradebook-plugin.js';
export type { GradebookPluginOptions } from './gradebook-plugin.js';
export { registerGradebookRoutes } from './routes.js';
export type { GradebookRoutesOptions } from './routes.js';
export { createGradebookRepository } from './repository-factory.js';
export { createGradebookExtrasStore } from './extras-factory.js';
export { InMemoryGradebookExtrasStore, PgGradebookExtrasStore } from './extras-store.js';
export type {
  CommentsBankRecord,
  ClassRankSnapshotRecord,
  GradeChangeAuditRecord,
  GradebookExtrasStore,
} from './extras-store.js';
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
  BoardSummary,
  InstitutionSummary,
  BoardCodeEntity,
  BoardExportCandidate,
} from './gradebook-repository.js';

export {
  UpsertGradeEntrySchema,
  ComputeGpaSchema,
  CreateReportCardJobSchema,
  IssueTranscriptSchema,
  CreateCreditRuleSchema,
  CreateBoardExportJobSchema,
  TransitionGradeEntrySchema,
  BulkTransitionGradeEntriesSchema,
  ComputeClassRankSchema,
  UpsertCommentsBankSchema,
} from './schemas.js';
