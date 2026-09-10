/**
 * Policy Service Unit Tests
 *
 * Tests CRUD operations, versioning, activation/deactivation,
 * and assignment logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { PolicyService } from './policy-service.js';
import { InMemoryPolicyRepository } from './in-memory-repository.js';
import type { CreatePolicyInput } from './schemas.js';

describe('PolicyService', () => {
  let service: PolicyService;
  let repository: InMemoryPolicyRepository;
  const tenantId = 'tenant-001';

  beforeEach(() => {
    repository = new InMemoryPolicyRepository();
    service = new PolicyService(repository);
  });

  const validPasswordPolicy: CreatePolicyInput = {
    name: 'Strong Password Policy',
    description: 'Requires complex passwords',
    type: 'password_complexity',
    scope: 'tenant',
    rules: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
    },
    priority: 100,
  };

  const validRetentionPolicy: CreatePolicyInput = {
    name: 'Data Retention 90 Days',
    description: 'Retain data for 90 days',
    type: 'data_retention',
    scope: 'platform',
    rules: {
      retentionDays: 90,
      archiveAfterDays: 60,
      deleteAfterArchive: true,
    },
    priority: 50,
  };

  // ─── Create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a policy with draft status', async () => {
      const result = await service.create(tenantId, validPasswordPolicy);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Strong Password Policy');
      expect(result.type).toBe('password_complexity');
      expect(result.scope).toBe('tenant');
      expect(result.status).toBe('draft');
      expect(result.version).toBe(1);
      expect(result.priority).toBe(100);
      expect(result.rules).toEqual(validPasswordPolicy.rules);
    });

    it('should create initial version (v1) on policy creation', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const versions = await service.getVersions(tenantId, policy.id);

      expect(versions).toHaveLength(1);
      expect(versions[0]!.version).toBe(1);
      expect(versions[0]!.rules).toEqual(validPasswordPolicy.rules);
    });

    it('should throw ConflictError if name already exists', async () => {
      await service.create(tenantId, validPasswordPolicy);

      await expect(service.create(tenantId, validPasswordPolicy)).rejects.toThrow(ConflictError);
    });

    it('should allow same name in different tenants', async () => {
      await service.create(tenantId, validPasswordPolicy);
      const result = await service.create('tenant-002', validPasswordPolicy);

      expect(result.name).toBe('Strong Password Policy');
    });

    it('should set effectiveFrom and effectiveUntil when provided', async () => {
      const input: CreatePolicyInput = {
        ...validPasswordPolicy,
        effectiveFrom: '2024-01-01T00:00:00.000Z',
        effectiveUntil: '2024-12-31T23:59:59.000Z',
      };

      const result = await service.create(tenantId, input);

      expect(result.effectiveFrom).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(result.effectiveUntil).toEqual(new Date('2024-12-31T23:59:59.000Z'));
    });
  });

  // ─── Update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update policy name', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const updated = await service.update(tenantId, policy.id, { name: 'Updated Policy' });

      expect(updated.name).toBe('Updated Policy');
    });

    it('should bump version when rules are updated', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const updated = await service.update(tenantId, policy.id, {
        rules: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: false,
        },
      });

      expect(updated.version).toBe(2);

      const versions = await service.getVersions(tenantId, policy.id);
      expect(versions).toHaveLength(2);
      expect(versions[0]!.version).toBe(2);
    });

    it('should not bump version when only name is updated', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const updated = await service.update(tenantId, policy.id, { name: 'New Name' });

      expect(updated.version).toBe(1);
    });

    it('should throw NotFoundError for non-existent policy', async () => {
      await expect(
        service.update(tenantId, '00000000-0000-4000-8000-000000000000', { name: 'X' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError if new name conflicts', async () => {
      await service.create(tenantId, validPasswordPolicy);
      const policy2 = await service.create(tenantId, validRetentionPolicy);

      await expect(
        service.update(tenantId, policy2.id, { name: 'Strong Password Policy' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  // ─── Activate / Deactivate ─────────────────────────────────────────────────

  describe('activate', () => {
    it('should activate a draft policy', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const activated = await service.activate(tenantId, policy.id);

      expect(activated.status).toBe('active');
    });

    it('should throw BusinessRuleError if already active', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      await service.activate(tenantId, policy.id);

      await expect(service.activate(tenantId, policy.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent policy', async () => {
      await expect(
        service.activate(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an active policy', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      await service.activate(tenantId, policy.id);
      const deactivated = await service.deactivate(tenantId, policy.id);

      expect(deactivated.status).toBe('inactive');
    });

    it('should throw BusinessRuleError if already inactive', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      await service.activate(tenantId, policy.id);
      await service.deactivate(tenantId, policy.id);

      await expect(service.deactivate(tenantId, policy.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  // ─── Get / List ────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('should return a policy by ID', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      const found = await service.getById(tenantId, policy.id);

      expect(found.id).toBe(policy.id);
      expect(found.name).toBe(policy.name);
    });

    it('should throw NotFoundError for non-existent policy', async () => {
      await expect(
        service.getById(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should list policies with pagination', async () => {
      await service.create(tenantId, validPasswordPolicy);
      await service.create(tenantId, validRetentionPolicy);

      const result = await service.list(tenantId, {}, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('should filter by type', async () => {
      await service.create(tenantId, validPasswordPolicy);
      await service.create(tenantId, validRetentionPolicy);

      const result = await service.list(
        tenantId,
        { type: 'password_complexity' },
        { page: 1, pageSize: 10 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.type).toBe('password_complexity');
    });

    it('should filter by scope', async () => {
      await service.create(tenantId, validPasswordPolicy);
      await service.create(tenantId, validRetentionPolicy);

      const result = await service.list(tenantId, { scope: 'platform' }, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.scope).toBe('platform');
    });

    it('should search by name', async () => {
      await service.create(tenantId, validPasswordPolicy);
      await service.create(tenantId, validRetentionPolicy);

      const result = await service.list(
        tenantId,
        { search: 'password' },
        { page: 1, pageSize: 10 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toContain('Password');
    });
  });

  // ─── Assignments ───────────────────────────────────────────────────────────

  describe('assignPolicy', () => {
    it('should assign an active policy to a target', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      await service.activate(tenantId, policy.id);

      const assignment = await service.assignPolicy(tenantId, {
        policyId: policy.id,
        targetType: 'tenant',
        targetId: tenantId,
      });

      expect(assignment.policyId).toBe(policy.id);
      expect(assignment.targetType).toBe('tenant');
      expect(assignment.targetId).toBe(tenantId);
    });

    it('should throw BusinessRuleError if policy is not active', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);

      await expect(
        service.assignPolicy(tenantId, {
          policyId: policy.id,
          targetType: 'tenant',
          targetId: tenantId,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent policy', async () => {
      await expect(
        service.assignPolicy(tenantId, {
          policyId: '00000000-0000-4000-8000-000000000000',
          targetType: 'tenant',
          targetId: tenantId,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('removeAssignment', () => {
    it('should remove an assignment', async () => {
      const policy = await service.create(tenantId, validPasswordPolicy);
      await service.activate(tenantId, policy.id);
      const assignment = await service.assignPolicy(tenantId, {
        policyId: policy.id,
        targetType: 'tenant',
        targetId: tenantId,
      });

      await service.removeAssignment(tenantId, assignment.id);

      const assignments = await service.getAssignments(tenantId, policy.id);
      expect(assignments).toHaveLength(0);
    });

    it('should throw NotFoundError for non-existent assignment', async () => {
      await expect(
        service.removeAssignment(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
