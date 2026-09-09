/**
 * @proctira/backend-examination - Examination domain service
 *
 * Provides CRUD operations for examinations with:
 * - Typebox schema validation
 * - Minimum 1 subject and 1 center per examination
 * - Exam dates at least 7 days in the future
 * - 1–10 grading schemes per examination with minimum pass thresholds
 * - Session scheduling within examination date range
 * - Candidate registration with eligibility validation
 * - Result publication with grade calculation (within 30 seconds)
 * - Incomplete result data handling (skip, flag, continue)
 * - Result analysis (pass rate, mean score, score distribution by subject/center/gender/area)
 * - Document generation (admit cards, seating plans, result certificates as PDF)
 * - Batch processing of up to 500 candidates within 60 seconds
 * - RabbitMQ queue integration for background document generation
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */

// Plugin
export { examinationPlugin } from './examination-plugin.js';
export type { ExaminationPluginOptions } from './examination-plugin.js';

// Service
export {
  ExaminationService,
  MIN_DAYS_IN_FUTURE,
  MAX_GRADING_SCHEMES,
  MIN_GRADING_SCHEMES,
} from './examination-service.js';

// Result Publication Service
export {
  ResultPublicationService,
  MAX_PUBLICATION_DURATION_MS,
  SCORE_DISTRIBUTION_BUCKETS,
} from './result-publication-service.js';

// Document Generation Service
export {
  DocumentGenerationService,
  InMemoryDocumentBlobStore,
  NoOpDocumentTaskQueue,
  MAX_BATCH_SIZE,
  MAX_GENERATION_DURATION_MS,
} from './document-generation-service.js';
export type {
  GenerateDocumentsInput,
  DocumentTaskQueue,
  DocumentBlobStore,
} from './document-generation-service.js';

// PDF Generator
export { SimplePdfGenerator } from './pdf-generator.js';
export type { PdfGenerator, ExaminationInfo } from './pdf-generator.js';

// Repository
export type {
  ExaminationEntity,
  ExaminationFilter,
  ExaminationRepository,
  ExaminationSubject,
  ExaminationCenter,
  ExaminationSession,
  ExaminationGradingScheme,
  GradeThreshold,
  CandidateRegistration,
  StudentEnrollment,
} from './examination-repository.js';

// Result Repository
export type {
  ResultRepository,
  ExaminationCandidate,
  CandidateSubjectResult,
  CandidateGradeResult,
  IncompleteRecord,
  PublicationResult,
  ResultAnalysis,
  AnalysisBreakdown,
  ScoreDistributionBucket,
  AcademicRecordUpdate,
  CandidateGender,
} from './result-repository.js';

// Document Repository
export type {
  DocumentRepository,
  DocumentType,
  DocumentJobStatus,
  DocumentCandidate,
  SeatingAssignment,
  CandidateResultData,
  DocumentGenerationJob,
} from './document-repository.js';

// In-memory repositories (for testing)
export { InMemoryExaminationRepository } from './in-memory-repository.js';
export { InMemoryResultRepository } from './in-memory-result-repository.js';
export { InMemoryDocumentRepository } from './in-memory-document-repository.js';

// Persistence: Prisma repositories + env-driven factory
export { PrismaExaminationRepository } from './prisma-examination-repository.js';
export { PrismaResultRepository } from './prisma-result-repository.js';
export { PrismaDocumentRepository } from './prisma-document-repository.js';
export {
  createExaminationRepository,
  createResultRepository,
  createDocumentRepository,
  createExamOpsStore,
  isPgExaminationEnabled,
} from './repository-factory.js';
export type { ExaminationRepositoryConfig } from './repository-factory.js';

// Cached repository decorator
export { CachedExaminationRepository } from './cached-examination-repository.js';

// Schemas
export {
  CreateExaminationSchema,
  UpdateExaminationSchema,
  ExaminationListQuerySchema,
  ExaminationParamsSchema,
  ExaminationResponseSchema,
  ExaminationListResponseSchema,
  ExaminationSubjectSchema,
  ExaminationCenterSchema,
  ExaminationSessionSchema,
  ExaminationGradingSchemeSchema,
  GradeThresholdSchema,
  RegisterCandidateSchema,
  CandidateRegistrationResponseSchema,
} from './schemas.js';
export type {
  CreateExaminationInput,
  UpdateExaminationInput,
  ExaminationListQuery,
  ExaminationParams,
  ExaminationResponse,
  ExaminationListResponse,
  ExaminationSubjectInput,
  ExaminationCenterInput,
  ExaminationSessionInput,
  ExaminationGradingSchemeInput,
  GradeThresholdInput,
  RegisterCandidateInput,
  CandidateRegistrationResponse,
} from './schemas.js';

// Result Schemas
export {
  ResultExaminationParamsSchema,
  PublicationResultResponseSchema,
  ResultAnalysisResponseSchema,
  ScoreDistributionBucketSchema,
  AnalysisBreakdownSchema,
} from './result-schemas.js';
export type {
  ResultExaminationParams,
  PublicationResultResponse,
  ResultAnalysisResponse,
} from './result-schemas.js';

// Document Schemas
export {
  GenerateDocumentsSchema,
  DocumentJobParamsSchema,
  DocumentExaminationParamsSchema,
  DocumentJobResponseSchema,
  DocumentJobListResponseSchema,
} from './document-schemas.js';
export type {
  DocumentJobParams,
  DocumentExaminationParams,
  DocumentJobResponse,
  DocumentJobListResponse,
} from './document-schemas.js';

// Routes
export { registerExaminationRoutes } from './routes.js';
export type { ExaminationRoutesOptions } from './routes.js';

// Result Routes
export { registerResultRoutes } from './result-routes.js';
export type { ResultRoutesOptions } from './result-routes.js';

// Document Routes
export { registerDocumentRoutes } from './document-routes.js';
export type { DocumentRoutesOptions } from './document-routes.js';

export {
  ExamOpsService,
  DEFAULT_VARIANCE_TOLERANCE,
  isModeratorRole,
  conflictResponse,
} from './ops-service.js';
export type { ExamOpsActor, ExamOpsServiceDeps, AllocateOutcome, MarksPairView } from './ops-service.js';
export { InMemoryExamOpsStore, PgExamOpsStore } from './ops-store.js';
export type { ExamOpsStore, ExamSessionRecord, ExamInvigilatorRecord } from './ops-store.js';
export { registerExamOpsRoutes } from './ops-routes.js';
export type { ExamOpsRoutesOptions } from './ops-routes.js';
export { generateSeatingPlan, SEATS_PER_ROOM } from './seating-generator.js';
export {
  sessionsOverlap,
  findStaffClashes,
  findRoomClashes,
  invigilatorsAreClashFree,
} from './clash.js';
