import type {
  CorrectionStatus,
  ErasureRequestType,
  ErasureStatus,
  LegalHoldScope,
  AnonymizationJobStatus,
  OffboardJobStatus,
} from './schemas.js';

export interface LegalHoldEntity {
  id: string;
  tenantId: string;
  scope: LegalHoldScope;
  subjectType: string | null;
  subjectId: string | null;
  reason: string;
  placedBy: string;
  placedAt: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ErasureRequestEntity {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  status: ErasureStatus;
  requestType: ErasureRequestType;
  reason: string | null;
  requestedBy: string;
  reviewedBy: string | null;
  statusReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CorrectionRequestEntity {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  fieldPath: string;
  currentValue: string | null;
  requestedValue: string;
  reason: string | null;
  status: CorrectionStatus;
  requestedBy: string;
  reviewedBy: string | null;
  statusReason: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnonymizationJobEntity {
  id: string;
  tenantId: string;
  erasureRequestId: string;
  subjectType: string;
  subjectId: string;
  requestType: ErasureRequestType;
  status: AnonymizationJobStatus;
  actorId: string;
  statusReason: string | null;
  fieldsTouched: string[];
  residualNote: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OffboardChecklistItem {
  domain: string;
  status: 'pending' | 'completed' | 'residual' | 'skipped';
  note?: string;
}

export interface TenantOffboardJobEntity {
  id: string;
  tenantId: string;
  status: OffboardJobStatus;
  reason: string;
  requestedBy: string;
  statusReason: string | null;
  checklist: OffboardChecklistItem[];
  residualNote: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Outcome of {@link PrivacyRepository.releaseStalledErasureExecution}. */
export type ReleaseStalledErasureResult =
  | { outcome: 'released'; erasure: ErasureRequestEntity; failedJobIds: string[] }
  | { outcome: 'live_job'; jobId: string }
  | { outcome: 'not_in_progress' };

/** Anonymization job statuses that are still runnable by a worker. */
export const NON_TERMINAL_ANONYMIZATION_JOB_STATUSES: readonly AnonymizationJobStatus[] = [
  'queued',
  'in_progress',
];

/** PRC-M322: marker stored in place of erased/applied correction values (column is NOT NULL). */
export const CORRECTION_VALUE_REDACTED = '[REDACTED]';

/**
 * PRC-M013 (B07, Topic 5 Option A — PII export / privacy): the audit row for an
 * erasure state transition must be written in the SAME transaction as the
 * transition, so a crash between "erasure state committed" and "audit written"
 * can never leave an unaudited durable privacy-lifecycle mutation.
 */
export interface PrivacyTxnAuditEvent {
  tenantId: string;
  /** Privacy lifecycle entity audited in-transaction. */
  entityType: 'privacy_erasure';
  entityId: string;
  operation: 'UPDATE';
  /** Field names + status change only — never the subject's PII values (DPDP minimisation). */
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  /** JWT `sub` of the caller; null when raised outside an authenticated request. */
  actorId: string | null;
  /** Client IP resolved by the gateway; null outside a request. */
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * The injected client type is intentionally structural (`query(text, values)`)
 * so this package does not import a database client type. The gateway passes a
 * `PgQueryable`-shaped adapter built over the mutation's own transaction.
 */
export interface PrivacyTxnAuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PrivacyTxnAuditPort {
  /** Append the audit row on the caller's transaction client. */
  appendAuditInTxn(client: PrivacyTxnAuditClient, event: PrivacyTxnAuditEvent): Promise<void>;
}

/**
 * PRC-M013: audit context a mutating erasure call carries so the audit row is
 * written in the same transaction. Supplied by {@link PrivacyService} only when
 * the repository advertises {@link PrivacyRepository.supportsTransactionalAudit}.
 */
export interface PrivacyAuditDirective {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  actorId: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * W1-SEC-06: every find/update-by-id takes tenantId and filters by it (IDOR fail-closed).
 */
export interface PrivacyRepository {
  /**
   * PRC-M013: when `true`, the repository writes the erasure state-transition
   * audit row in the SAME transaction as the transition (given a
   * {@link PrivacyAuditDirective}), so the service must NOT also emit a post-hoc
   * audit event for that transition. Absent / `false` (e.g. the in-memory
   * repository) keeps the post-hoc path.
   */
  readonly supportsTransactionalAudit?: boolean;

  createLegalHold(data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>): Promise<LegalHoldEntity>;
  updateLegalHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>,
  ): Promise<LegalHoldEntity | null>;
  findLegalHoldById(id: string, tenantId: string): Promise<LegalHoldEntity | null>;
  listActiveLegalHolds(tenantId: string, page?: ListPage): Promise<LegalHoldEntity[]>;
  /**
   * Single indexed lookup for the destructive-op gate (PRC-L138): returns an
   * active tenant-scope hold, or an active subject-scope hold matching
   * `subjectId` (and `subjectType` when given). Tenant-scope wins.
   */
  findActiveHold(
    tenantId: string,
    subject?: { subjectType?: string; subjectId?: string },
  ): Promise<Pick<LegalHoldEntity, 'id' | 'scope'> | null>;

  createErasureRequest(
    data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ErasureRequestEntity>;
  updateErasureRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>
    >,
    /**
     * Compare-and-set guard: when set, the update applies only if the row is
     * still in this status; otherwise `null` is returned (PRC-H076).
     */
    options?: { expectedStatus?: ErasureRequestEntity['status'] },
    /**
     * PRC-M013: when supplied (and the repository supports transactional audit),
     * the audit row is appended on the same transaction as the status update, so
     * an audit-append failure rolls the update back.
     */
    audit?: PrivacyAuditDirective,
  ): Promise<ErasureRequestEntity | null>;
  /**
   * PRC-M320: atomically move an erasure `approved` -> `in_progress` AND create its
   * anonymization job in one transaction. Returns null (nothing written) when the
   * request is no longer `approved`; if the job insert fails the status flip is rolled back.
   */
  startErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    job: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
    /** PRC-M013: audit row appended on the same transaction as the status flip + job insert. */
    audit?: PrivacyAuditDirective,
  ): Promise<{ erasure: ErasureRequestEntity; job: AnonymizationJobEntity } | null>;
  /**
   * PRC-M320 (review #554): manual `in_progress` -> `approved` for a stalled run. In ONE
   * transaction: lock the request (must be `in_progress`) and its non-terminal anonymization
   * jobs; if any job was started/queued after `staleBefore` it is still live and nothing is
   * written (`live_job`). Otherwise every non-terminal job is marked `failed` (fencing the
   * worker) and the request is moved back to `approved`.
   */
  releaseStalledErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    staleBefore: Date,
    /** PRC-M013: audit row appended on the same transaction as the release. */
    audit?: PrivacyAuditDirective,
  ): Promise<ReleaseStalledErasureResult>;
  findErasureRequestById(id: string, tenantId: string): Promise<ErasureRequestEntity | null>;
  listErasureRequests(tenantId: string, page?: ListPage): Promise<ErasureRequestEntity[]>;

  createCorrectionRequest(
    data: Omit<CorrectionRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CorrectionRequestEntity>;
  updateCorrectionRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        CorrectionRequestEntity,
        'status' | 'reviewedBy' | 'statusReason' | 'appliedAt' | 'currentValue' | 'requestedValue'
      >
    >,
  ): Promise<CorrectionRequestEntity | null>;
  /**
   * PRC-M322: erase the subject's correction PII (current value -> NULL, requested value ->
   * redaction marker) for every correction row of the subject. Returns rows touched.
   */
  redactCorrectionValuesForSubject(
    tenantId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<number>;
  findCorrectionRequestById(id: string, tenantId: string): Promise<CorrectionRequestEntity | null>;
  listCorrectionRequests(tenantId: string, page?: ListPage): Promise<CorrectionRequestEntity[]>;

  createAnonymizationJob(
    data: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AnonymizationJobEntity>;
  updateAnonymizationJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        AnonymizationJobEntity,
        'status' | 'statusReason' | 'fieldsTouched' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
    /**
     * Compare-and-set guard: when set, the update applies only if the job is still in this
     * status; otherwise `null` is returned and nothing is written (review #554).
     */
    options?: { expectedStatus?: AnonymizationJobEntity['status'] },
  ): Promise<AnonymizationJobEntity | null>;
  findAnonymizationJobById(id: string, tenantId: string): Promise<AnonymizationJobEntity | null>;
  listAnonymizationJobs(tenantId: string): Promise<AnonymizationJobEntity[]>;

  createTenantOffboardJob(
    data: Omit<TenantOffboardJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TenantOffboardJobEntity>;
  updateTenantOffboardJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        TenantOffboardJobEntity,
        'status' | 'statusReason' | 'checklist' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<TenantOffboardJobEntity | null>;
  findTenantOffboardJobById(id: string, tenantId: string): Promise<TenantOffboardJobEntity | null>;
  listTenantOffboardJobs(tenantId: string, page?: ListPage): Promise<TenantOffboardJobEntity[]>;
  /**
   * PRC-H078: cross-tenant (control-plane) lookup of jobs still `queued` with
   * `updatedAt` older than `olderThan`. Returns identifiers only.
   */
  listStuckQueuedJobs?(olderThan: Date, limit: number): Promise<StuckPrivacyJobRef[]>;
}

/** PRC-H078: identifier of a privacy job stuck in `queued`. */
export interface StuckPrivacyJobRef {
  kind: 'anonymization' | 'offboard';
  id: string;
  tenantId: string;
}

/** Bounded list window for HTTP list endpoints (PRC-L137). */
export interface ListPage {
  limit: number;
  offset: number;
}
