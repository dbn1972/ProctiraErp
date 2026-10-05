export { privacyPlugin, readPrivacyJobStuckMinutes } from './privacy-plugin.js';
export type { PrivacyPluginOptions } from './privacy-plugin.js';
export { PrivacyExecutorNotConfiguredError, PrivacyService } from './privacy-service.js';
export type { DestructiveDeleteGuard, PrivacyServiceOptions } from './privacy-service.js';
export type {
  AnonymizationJobEntity,
  CorrectionRequestEntity,
  ErasureRequestEntity,
  LegalHoldEntity,
  ListPage,
  OffboardChecklistItem,
  PrivacyRepository,
  StuckPrivacyJobRef,
  TenantOffboardJobEntity,
} from './privacy-repository.js';
export { InMemoryPrivacyRepository } from './in-memory-repository.js';
export {
  getSharedInMemoryPrivacyRepository,
  resetSharedInMemoryPrivacyRepositoryForTests,
} from './shared-store.js';
export { createPrivacyRepository, isPgPrivacyEnabled } from './create-privacy-repository.js';
export {
  PgPrivacyRepository,
  getSharedPrivacyPool,
  ensurePrivacySchema,
} from './pg-privacy-repository.js';
export {
  LegalHoldScopeEnum,
  ErasureStatusEnum,
  ErasureRequestTypeEnum,
  CorrectionStatusEnum,
  AnonymizationJobStatusEnum,
  OffboardJobStatusEnum,
  PlaceLegalHoldSchema,
  CreateErasureRequestSchema,
  CreateCorrectionRequestSchema,
  RequestTenantOffboardSchema,
} from './schemas.js';
export type {
  LegalHoldScope,
  ErasureStatus,
  ErasureRequestType,
  CorrectionStatus,
  AnonymizationJobStatus,
  OffboardJobStatus,
  PlaceLegalHoldInput,
  CreateErasureRequestInput,
  CreateCorrectionRequestInput,
  RequestTenantOffboardInput,
} from './schemas.js';
export { registerPrivacyRoutes } from './routes.js';
export type { PrivacyRoutesOptions } from './routes.js';
export { RecordingPrivacyAuditPort, NoopPrivacyAuditPort } from './privacy-audit.js';
export type { PrivacyAuditPort, PrivacyAuditEvent } from './privacy-audit.js';
export {
  RecordingSubjectAnonymizer,
  ResidualTenantWipeExecutor,
  DEFAULT_OFFBOARD_DOMAINS,
} from './subject-anonymizer.js';
export type {
  SubjectAnonymizer,
  TenantWipeExecutor,
  AnonymizeSubjectInput,
  AnonymizeSubjectResult,
  TenantWipeInput,
  TenantWipeDomainResult,
} from './subject-anonymizer.js';
export {
  QueuePrivacyAnonymizationPublisher,
  QueuePrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';
export type {
  PrivacyAnonymizationPublisher,
  PrivacyOffboardPublisher,
  PrivacyAnonymizationJobPayload,
  PrivacyTenantOffboardJobPayload,
} from './queue-privacy-publisher.js';
export { createPrivacyQueuePublishersFromEnv } from './privacy-queue-factory.js';
export type { PrivacyQueueHandle } from './privacy-queue-factory.js';
export { createPrivacyAnonymizationWorker, createPrivacyOffboardWorker } from './privacy-worker.js';
export type {
  PrivacyWorker,
  PrivacyWorkerLogger,
  PrivacyAnonymizationProcessor,
  PrivacyOffboardProcessor,
} from './privacy-worker.js';
export {
  PgDomainSubjectAnonymizer,
  PgTenantWipeExecutor,
  classifyWipeTable,
  createStudentPhotoAnonymizer,
  defaultDomainAnonymizers,
  readFinanceHealthErasureMode,
  studentSiblingsAnonymizer,
} from './domain-anonymizers.js';
export {
  SUBJECT_LINK_COLUMNS,
  SUBJECT_LINK_REGISTRY,
  TENANT_WIPE_REGISTRY,
  subjectKindFor,
  tenantWipeDisposition,
} from './tenant-data-registry.js';
export type {
  SubjectKind,
  SubjectLink,
  SubjectLinkHandling,
  TenantWipeDisposition,
} from './tenant-data-registry.js';
export type {
  DomainSubjectAnonymizer,
  FinanceHealthErasureMode,
  ObjectEraser,
} from './domain-anonymizers.js';
