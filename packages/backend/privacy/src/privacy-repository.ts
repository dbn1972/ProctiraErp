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

/** PRC-M322: marker stored in place of erased/applied correction values (column is NOT NULL). */
export const CORRECTION_VALUE_REDACTED = '[REDACTED]';

/**
 * W1-SEC-06: every find/update-by-id takes tenantId and filters by it (IDOR fail-closed).
 */
export interface PrivacyRepository {
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
  ): Promise<{ erasure: ErasureRequestEntity; job: AnonymizationJobEntity } | null>;
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
}

/** Bounded list window for HTTP list endpoints (PRC-L137). */
export interface ListPage {
  limit: number;
  offset: number;
}
