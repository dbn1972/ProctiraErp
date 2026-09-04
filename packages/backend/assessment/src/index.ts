/**
 * @proctira/backend-assessment - Assessment domain service
 *
 * Provides assessment operations including:
 * - Grading scheme CRUD (numeric, letter, competency)
 * - Assessment item definition with weight validation (sum must equal 100%)
 * - Up to 50 items per subject per academic period
 * - Outcome-based assessment mapping (items to curriculum outcomes)
 * - Result entry with score validation and grade calculation
 * - Bulk result entry (up to 5000 rows) with row-level validation errors
 * - Excel import for assessment results
 * - Report card PDF generation with configurable templates
 * - Teacher comments (up to 500 chars per subject)
 * - Background processing via RabbitMQ
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

// Plugin
export { assessmentPlugin } from './assessment-plugin.js';
export type { AssessmentPluginOptions } from './assessment-plugin.js';

// Service
export { AssessmentService, MAX_ITEMS_PER_SUBJECT_PERIOD, REQUIRED_WEIGHT_TOTAL } from './assessment-service.js';
export { ResultService } from './result-service.js';

// Repository interfaces
export type {
  GradingSchemeEntity,
  GradingSchemeFilter,
  GradingSchemeRepository,
  AssessmentItemEntity,
  AssessmentItemRepository,
  OutcomeEntity,
  OutcomeRepository,
} from './assessment-repository.js';
export type {
  AssessmentResultEntity,
  AssessmentResultRepository,
  StudentSubjectResult,
} from './result-repository.js';

// In-memory repositories (for testing)
export {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
export { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';

// Prisma repositories (production)
export {
  PrismaGradingSchemeRepository,
  PrismaAssessmentItemRepository,
  PrismaOutcomeRepository,
} from './prisma-repository.js';
export { PrismaAssessmentResultRepository } from './prisma-result-repository.js';
export {
  PrismaReportCardTemplateRepository,
  PrismaTeacherCommentRepository,
  PrismaInstitutionBrandingRepository,
  PrismaReportCardJobRepository,
} from './prisma-report-card-repository.js';

// Repository factories
export {
  createGradingSchemeRepository,
  createAssessmentItemRepository,
  createOutcomeRepository,
  createAssessmentResultRepository,
  createReportCardTemplateRepository,
  createTeacherCommentRepository,
  createInstitutionBrandingRepository,
  createReportCardJobRepository,
} from './repository-factory.js';
export type { AssessmentRepositoryConfig } from './repository-factory.js';

// Schemas
export {
  GradingSchemeTypeEnum,
  GradeThresholdSchema,
  CreateGradingSchemeSchema,
  UpdateGradingSchemeSchema,
  GradingSchemeParamsSchema,
  GradingSchemeResponseSchema,
  GradingSchemeListQuerySchema,
  AssessmentItemSchema,
  DefineAssessmentItemsSchema,
  AssessmentItemResponseSchema,
  AssessmentItemsListResponseSchema,
  AssessmentItemsQuerySchema,
  CreateOutcomeSchema,
  OutcomeResponseSchema,
  OutcomeParamsSchema,
} from './schemas.js';
export type {
  GradingSchemeType,
  GradeThreshold,
  CreateGradingSchemeInput,
  UpdateGradingSchemeInput,
  GradingSchemeParams,
  GradingSchemeResponse,
  GradingSchemeListQuery,
  AssessmentItemInput,
  DefineAssessmentItemsInput,
  AssessmentItemResponse,
  AssessmentItemsListResponse,
  AssessmentItemsQuery,
  CreateOutcomeInput,
  OutcomeResponse,
  OutcomeParams,
} from './schemas.js';

// Result schemas
export {
  ResultEntryItemSchema,
  EnterSingleResultSchema,
  BulkResultEntrySchema,
  RowValidationErrorSchema,
  ResultEntryResponseSchema,
  BulkResultEntryResponseSchema,
  ItemScoreDetailSchema,
  StudentSubjectResultResponseSchema,
  StudentResultsQuerySchema,
  MAX_BULK_RESULT_ROWS,
} from './result-schemas.js';
export type {
  ResultEntryItem,
  EnterSingleResultInput,
  BulkResultEntryInput,
  RowValidationError,
  ResultEntryResponse,
  BulkResultEntryResponse,
  ItemScoreDetail,
  StudentSubjectResultResponse,
  StudentResultsQuery,
} from './result-schemas.js';

// Routes
export { registerAssessmentRoutes } from './routes.js';
export type { AssessmentRoutesOptions } from './routes.js';
export { registerResultRoutes } from './result-routes.js';
export type { ResultRoutesOptions } from './result-routes.js';

// Report Card Service
export { ReportCardService } from './report-card-service.js';
export type { TaskQueuePublisher, PdfGenerator, ReportCardData } from './report-card-service.js';

// Report Card Repository interfaces
export type {
  ReportCardTemplateEntity,
  ReportCardTemplateRepository,
  TeacherCommentEntity,
  TeacherCommentRepository,
  InstitutionBrandingEntity,
  InstitutionBrandingRepository,
  ReportCardJobEntity,
  ReportCardJobRepository,
  ReportCardJobStatus,
} from './report-card-repository.js';

// Report Card In-memory repositories (for testing)
export {
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
} from './in-memory-report-card-repository.js';

// Report Card Schemas
export {
  CreateReportCardTemplateSchema,
  UpdateReportCardTemplateSchema,
  ReportCardTemplateParamsSchema,
  ReportCardTemplateResponseSchema,
  UpsertTeacherCommentSchema,
  TeacherCommentResponseSchema,
  TeacherCommentsQuerySchema,
  GenerateReportCardSchema,
  BulkGenerateReportCardSchema,
  ReportCardJobStatusEnum,
  ReportCardJobResponseSchema,
  BulkGenerateReportCardResponseSchema,
  ReportCardJobParamsSchema,
  MAX_COMMENT_LENGTH,
} from './report-card-schemas.js';
export type {
  CreateReportCardTemplateInput,
  UpdateReportCardTemplateInput,
  ReportCardTemplateParams,
  ReportCardTemplateResponse,
  UpsertTeacherCommentInput,
  TeacherCommentResponse,
  TeacherCommentsQuery,
  GenerateReportCardInput,
  BulkGenerateReportCardInput,
  ReportCardJobResponse,
  BulkGenerateReportCardResponse,
  ReportCardJobParams,
} from './report-card-schemas.js';

// Report Card Routes
export { registerReportCardRoutes } from './report-card-routes.js';
export type { ReportCardRoutesOptions } from './report-card-routes.js';
