import type { ErasureRequestType, ErasureStatus, LegalHoldScope } from './schemas.js';

export interface LegalHoldEntity {
  id: string; tenantId: string; scope: LegalHoldScope;
  subjectType: string | null; subjectId: string | null;
  reason: string; placedBy: string; placedAt: Date;
  releasedBy: string | null; releasedAt: Date | null; active: boolean;
  createdAt: Date; updatedAt: Date;
}

export interface ErasureRequestEntity {
  id: string; tenantId: string; subjectType: string; subjectId: string;
  status: ErasureStatus; requestType: ErasureRequestType; reason: string | null;
  requestedBy: string; reviewedBy: string | null; statusReason: string | null;
  completedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface PrivacyRepository {
  createLegalHold(data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>): Promise<LegalHoldEntity>;
  updateLegalHold(id: string, data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>): Promise<LegalHoldEntity | null>;
  findLegalHoldById(id: string): Promise<LegalHoldEntity | null>;
  listActiveLegalHolds(tenantId: string): Promise<LegalHoldEntity[]>;
  createErasureRequest(data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>): Promise<ErasureRequestEntity>;
  updateErasureRequest(id: string, data: Partial<Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>>): Promise<ErasureRequestEntity | null>;
  findErasureRequestById(id: string): Promise<ErasureRequestEntity | null>;
  listErasureRequests(tenantId: string): Promise<ErasureRequestEntity[]>;
}
