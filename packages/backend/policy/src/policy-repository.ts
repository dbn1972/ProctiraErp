/**
 * Policy Repository Interface
 *
 * Defines the data access contract for policy operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Tables: policy_policies, policy_versions, policy_assignments
 * Charter: Section 27 (Security and Compliance)
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { PolicyType, PolicyStatus, PolicyScope } from './schemas.js';

// ─── Entity Types ────────────────────────────────────────────────────────────

/**
 * Policy entity as stored in the policy_policies table.
 */
export interface PolicyEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: PolicyType;
  scope: PolicyScope;
  status: PolicyStatus;
  rules: Record<string, unknown>;
  version: number;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy version entity as stored in the policy_versions table.
 */
export interface PolicyVersionEntity {
  id: string;
  policyId: string;
  version: number;
  rules: Record<string, unknown>;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

/**
 * Policy assignment entity as stored in the policy_assignments table.
 */
export interface PolicyAssignmentEntity {
  id: string;
  policyId: string;
  targetType: 'platform' | 'tenant' | 'institution';
  targetId: string | null;
  tenantId: string;
  createdAt: Date;
}

// ─── Filter Types ────────────────────────────────────────────────────────────

/**
 * Filter options for listing policies.
 */
export interface PolicyFilter {
  type?: PolicyType;
  scope?: PolicyScope;
  status?: PolicyStatus;
  search?: string;
}

// ─── Repository Interface ────────────────────────────────────────────────────

/**
 * Repository interface for policy data access.
 */
export interface PolicyRepository {
  // ─── Policy CRUD ─────────────────────────────────────────────────────────

  /** Create a new policy */
  create(data: Omit<PolicyEntity, 'createdAt' | 'updatedAt'>): Promise<PolicyEntity>;

  /** Update an existing policy */
  update(id: string, tenantId: string, data: Partial<PolicyEntity>): Promise<PolicyEntity | null>;

  /** Find a policy by ID within a tenant */
  findById(id: string, tenantId: string): Promise<PolicyEntity | null>;

  /** Find a policy by name within a tenant (for uniqueness check) */
  findByName(name: string, tenantId: string): Promise<PolicyEntity | null>;

  /** List policies with pagination and filtering */
  list(
    tenantId: string,
    filter: PolicyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PolicyEntity>>;

  /** Delete a policy */
  delete(id: string, tenantId: string): Promise<boolean>;

  // ─── Policy Versions ─────────────────────────────────────────────────────

  /** Create a new policy version */
  createVersion(data: Omit<PolicyVersionEntity, 'createdAt'>): Promise<PolicyVersionEntity>;

  /** Get all versions for a policy */
  getVersions(policyId: string): Promise<PolicyVersionEntity[]>;

  /** Get a specific version */
  getVersion(policyId: string, version: number): Promise<PolicyVersionEntity | null>;

  // ─── Policy Assignments ──────────────────────────────────────────────────

  /** Create a policy assignment */
  createAssignment(data: Omit<PolicyAssignmentEntity, 'createdAt'>): Promise<PolicyAssignmentEntity>;

  /** Remove a policy assignment */
  removeAssignment(id: string, tenantId: string): Promise<boolean>;

  /** Find assignments for a specific target */
  findAssignmentsByTarget(
    targetType: 'platform' | 'tenant' | 'institution',
    targetId: string | null,
    tenantId: string,
    policyType?: PolicyType,
  ): Promise<PolicyAssignmentEntity[]>;

  /** Find all assignments for a policy */
  findAssignmentsByPolicy(policyId: string, tenantId: string): Promise<PolicyAssignmentEntity[]>;
}
