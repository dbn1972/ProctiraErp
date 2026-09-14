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

export interface PrivacyRepository {
  createLegalHold(
    data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LegalHoldEntity>;
  updateLegalHold(
    id: string,
    data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>,
  ): Promise<LegalHoldEntity | null>;
  findLegalHoldById(id: string): Promise<LegalHoldEntity | null>;
  listActiveLegalHolds(tenantId: string): Promise<LegalHoldEntity[]>;

  createErasureRequest(
    data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ErasureRequestEntity>;
  updateErasureRequest(
    id: string,
    data: Partial<
      Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>
    >,
  ): Promise<ErasureRequestEntity | null>;
  findErasureRequestById(id: string): Promise<ErasureRequestEntity | null>;
  listErasureRequests(tenantId: string): Promise<ErasureRequestEntity[]>;

  createCorrectionRequest(
    data: Omit<CorrectionRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CorrectionRequestEntity>;
  updateCorrectionRequest(
    id: string,
    data: Partial<
      Pick<
        CorrectionRequestEntity,
        'status' | 'reviewedBy' | 'statusReason' | 'appliedAt' | 'currentValue' | 'requestedValue'
      >
    >,
  ): Promise<CorrectionRequestEntity | null>;
  findCorrectionRequestById(id: string): Promise<CorrectionRequestEntity | null>;
  listCorrectionRequests(tenantId: string): Promise<CorrectionRequestEntity[]>;

  createAnonymizationJob(
    data: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AnonymizationJobEntity>;
  updateAnonymizationJob(
    id: string,
    data: Partial<
      Pick<
        AnonymizationJobEntity,
        | 'status'
        | 'statusReason'
        | 'fieldsTouched'
        | 'residualNote'
        | 'startedAt'
        | 'completedAt'
      >
    >,
  ): Promise<AnonymizationJobEntity | null>;
  findAnonymizationJobById(id: string): Promise<AnonymizationJobEntity | null>;
  listAnonymizationJobs(tenantId: string): Promise<AnonymizationJobEntity[]>;

  createTenantOffboardJob(
    data: Omit<TenantOffboardJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TenantOffboardJobEntity>;
  updateTenantOffboardJob(
    id: string,
    data: Partial<
      Pick<
        TenantOffboardJobEntity,
        | 'status'
        | 'statusReason'
        | 'checklist'
        | 'residualNote'
        | 'startedAt'
        | 'completedAt'
      >
    >,
  ): Promise<TenantOffboardJobEntity | null>;
  findTenantOffboardJobById(id: string): Promise<TenantOffboardJobEntity | null>;
  listTenantOffboardJobs(tenantId: string): Promise<TenantOffboardJobEntity[]>;
}
