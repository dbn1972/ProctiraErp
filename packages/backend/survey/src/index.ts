/**
 * @proctira/backend-survey - Survey domain service
 *
 * Provides survey operations including:
 * - Survey CRUD with configurable question types (text, number, date,
 *   dropdown, checkbox, table, repeater)
 * - Distribution to institutions based on area, type, classification filters
 * - Submission validation (required fields, data type constraints)
 * - Completion tracking per institution with reminder support
 * - Response aggregation with cross-tabulation by area and type
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */

// Plugin
export { surveyPlugin } from './survey-plugin.js';
export type { SurveyPluginOptions } from './survey-plugin.js';

// Service
export { SurveyService } from './survey-service.js';
export type {
  NotificationPublisher,
  QuestionSummary,
  CrossTabulationEntry,
} from './survey-service.js';

// Repository interfaces
export type {
  SurveyEntity,
  QuestionEntity,
  RepeaterFieldEntity,
  QuestionValidation,
  SurveyFilter,
  SurveyRepository,
  DistributionRecordEntity,
  DistributionRepository,
  SubmissionEntity,
  AnswerEntity,
  SubmissionRepository,
  InstitutionLookup,
  InstitutionMetadata,
} from './survey-repository.js';

// In-memory repositories (for testing)
export {
  InMemorySurveyRepository,
  InMemoryDistributionRepository,
  InMemorySubmissionRepository,
  InMemoryInstitutionLookup,
} from './in-memory-repository.js';

// Prisma repositories (Postgres + RLS) + factories
export {
  PrismaSurveyRepository,
  PrismaDistributionRepository,
  PrismaSubmissionRepository,
  PrismaInstitutionLookup,
} from './prisma-survey-repository.js';
export {
  createSurveyRepository,
  createDistributionRepository,
  createSubmissionRepository,
  createInstitutionLookup,
} from './repository-factory.js';
export type { SurveyRepositoryConfig } from './repository-factory.js';

// Schemas
export {
  QuestionTypeEnum,
  SurveyStatusEnum,
  CompletionStatusEnum,
  DropdownOptionSchema,
  TableColumnSchema,
  QuestionSchema,
  CreateSurveySchema,
  UpdateSurveySchema,
  SurveyParamsSchema,
  SurveyListQuerySchema,
  SurveyResponseSchema,
  DistributeSurveySchema,
  SubmitSurveySchema,
  SendReminderSchema,
  AggregateResponsesQuerySchema,
  AggregatedResponseSchema,
  DistributionRecordResponseSchema,
} from './schemas.js';
export type {
  QuestionType,
  SurveyStatus,
  CompletionStatus,
  DropdownOption,
  TableColumn,
  QuestionInput,
  CreateSurveyInput,
  UpdateSurveyInput,
  SurveyParams,
  SurveyListQuery,
  SurveyResponse,
  DistributeSurveyInput,
  SubmitSurveyInput,
  SendReminderInput,
  AggregateResponsesQuery,
  AggregatedResponse,
  DistributionRecordResponse,
} from './schemas.js';

// Routes
export { registerSurveyRoutes } from './routes.js';
export type { SurveyRoutesOptions } from './routes.js';
