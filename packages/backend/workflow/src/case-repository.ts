/**
 * Case Repository Interface
 *
 * Defines the data access contract for case management entities.
 * Implementations can target PostgreSQL (production) or in-memory (testing).
 *
 * Requirements: 13.5
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  CaseType,
  CaseStatus,
  CaseAttachmentInput,
  CaseResolutionInput,
} from './case-schemas.js';

// ─── Case Entity ─────────────────────────────────────────────────────────────

export interface CaseEntity {
  id: string;
  tenantId: string;
  type: CaseType;
  title: string;
  description: string;
  status: CaseStatus;
  entityType: string;
  entityId: string;
  institutionId: string | null;
  areaId: string | null;
  assignedTo: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical' | null;
  workflowInstanceId: string | null;
  attachments: CaseAttachmentInput[];
  resolution: CaseResolutionInput | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Case Filter ─────────────────────────────────────────────────────────────

export interface CaseFilter {
  type?: CaseType;
  status?: CaseStatus;
  entityType?: string;
  entityId?: string;
  assignedTo?: string;
  institutionId?: string;
  areaId?: string;
}

// ─── Case Repository Interface ───────────────────────────────────────────────

export interface CaseRepository {
  createCase(entity: Omit<CaseEntity, 'createdAt' | 'updatedAt'>): Promise<CaseEntity>;
  findCaseById(id: string, tenantId: string): Promise<CaseEntity | null>;
  updateCase(id: string, tenantId: string, data: Partial<CaseEntity>): Promise<CaseEntity | null>;
  listCases(tenantId: string, filter: CaseFilter, pagination: PaginationOptions): Promise<PaginatedResult<CaseEntity>>;
}
