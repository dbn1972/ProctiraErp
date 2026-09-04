/**
 * Workflow Repository Interface
 *
 * Defines the data access contract for workflow definitions, instances, and audit records.
 * Implementations can target PostgreSQL (production) or in-memory (testing).
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  WorkflowStateInput,
  WorkflowTransitionInput,
  EscalationRuleInput,
} from './schemas.js';

// ─── Workflow Definition Entity ──────────────────────────────────────────────

export interface WorkflowDefinitionEntity {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  description: string | null;
  states: WorkflowStateInput[];
  transitions: WorkflowTransitionInput[];
  escalationRules: EscalationRuleInput[] | null;
  /** When false the definition is paused. */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Workflow Instance Entity ────────────────────────────────────────────────

export type WorkflowInstanceStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface ApprovalRecord {
  stateId: string;
  actorId: string;
  action: string;
  timestamp: Date;
}

export interface WorkflowInstanceEntity {
  id: string;
  tenantId: string;
  workflowDefinitionId: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  status: WorkflowInstanceStatus;
  metadata: Record<string, unknown> | null;
  approvals: ApprovalRecord[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Transition Audit Entity ─────────────────────────────────────────────────

export interface TransitionAuditEntity {
  id: string;
  tenantId: string;
  instanceId: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  actorId: string;
  comments: string | null;
  timestamp: Date;
}

// ─── Repository Filters ──────────────────────────────────────────────────────

export interface WorkflowDefinitionFilter {
  entityType?: string;
}

export interface WorkflowInstanceFilter {
  entityType?: string;
  entityId?: string;
  status?: WorkflowInstanceStatus;
  workflowDefinitionId?: string;
}

// ─── Repository Interface ────────────────────────────────────────────────────

export interface WorkflowRepository {
  // Workflow Definition operations
  createDefinition(entity: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'>): Promise<WorkflowDefinitionEntity>;
  findDefinitionById(id: string, tenantId: string): Promise<WorkflowDefinitionEntity | null>;
  updateDefinition(id: string, tenantId: string, data: Partial<WorkflowDefinitionEntity>): Promise<WorkflowDefinitionEntity | null>;
  deleteDefinition(id: string, tenantId: string): Promise<boolean>;
  listDefinitions(tenantId: string, filter: WorkflowDefinitionFilter, pagination: PaginationOptions): Promise<PaginatedResult<WorkflowDefinitionEntity>>;

  // Workflow Instance operations
  createInstance(entity: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'>): Promise<WorkflowInstanceEntity>;
  findInstanceById(id: string, tenantId: string): Promise<WorkflowInstanceEntity | null>;
  updateInstance(id: string, tenantId: string, data: Partial<WorkflowInstanceEntity>): Promise<WorkflowInstanceEntity | null>;
  listInstances(tenantId: string, filter: WorkflowInstanceFilter, pagination: PaginationOptions): Promise<PaginatedResult<WorkflowInstanceEntity>>;

  // Transition Audit operations
  createAuditRecord(entity: TransitionAuditEntity): Promise<TransitionAuditEntity>;
  getAuditHistory(instanceId: string, tenantId: string): Promise<TransitionAuditEntity[]>;
}
