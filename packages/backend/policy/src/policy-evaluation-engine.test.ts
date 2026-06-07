/**
 * Policy Evaluation Engine Unit Tests
 *
 * Tests the inheritance chain: platform → tenant → institution
 * and effective date filtering.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { PolicyService } from './policy-service.js';
import { PolicyEvaluationEngine } from './policy-evaluation-engine.js';
import { InMemoryPolicyRepository } from './in-memory-repository.js';
import type { CreatePolicyInput } from './schemas.js';

describe('PolicyEvaluationEngine', () => {
  let service: PolicyService;
  let repository: InMemoryPolicyRepository;
  const tenantId = 'tenant-001';
  const institutionId = 'inst-001';

  beforeEach(() => {
    repository = new InMemoryPolicyRepository();
    service = new PolicyService(repository);
  });

  // Helper to create and activate a policy with assignment
  async function createAndAssign(
    input: CreatePolicyInput,
    targetType: 'platform' | 'tenant' | 'institution',
    targetId: string | null,
  ) {
    const policy = await service.create(tenantId, input);
    await service.activate(tenantId, policy.id);
    await service.assignPolicy(tenantId, {
      policyId: policy.id,
      targetType,
      targetId: targetId ?? undefined,
    });
    return policy;
  }

  describe('inheritance chain', () => {
    it('should return null when no policies exist', async () => {
      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy).toBeNull();
      expect(result.mergedRules).toEqual({});
    });

    it('should return platform policy when only platform policy exists', async () => {
      await createAndAssign(
        {
          name: 'Platform Password Policy',
          type: 'password_complexity',
          scope: 'platform',
          rules: { minLength: 8, requireUppercase: true },
          priority: 50,
        },
        'platform',
        null,
      );

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy).not.toBeNull();
      expect(result.effectivePolicy!.name).toBe('Platform Password Policy');
      expect(result.mergedRules).toEqual({ minLength: 8, requireUppercase: true });
    });

    it('should override platform with tenant policy', async () => {
      await createAndAssign(
        {
          name: 'Platform Password Policy',
          type: 'password_complexity',
          scope: 'platform',
          rules: { minLength: 6, requireUppercase: false },
          priority: 50,
        },
        'platform',
        null,
      );

      await createAndAssign(
        {
          name: 'Tenant Password Policy',
          type: 'password_complexity',
          scope: 'tenant',
          rules: { minLength: 10, requireUppercase: true },
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy!.name).toBe('Tenant Password Policy');
      // Merged rules: tenant overrides platform
      expect(result.mergedRules).toEqual({ minLength: 10, requireUppercase: true });
    });

    it('should override tenant with institution policy', async () => {
      await createAndAssign(
        {
          name: 'Platform Policy',
          type: 'session_timeout',
          scope: 'platform',
          rules: { idleTimeoutMinutes: 30, absoluteTimeoutMinutes: 480 },
          priority: 50,
        },
        'platform',
        null,
      );

      await createAndAssign(
        {
          name: 'Tenant Policy',
          type: 'session_timeout',
          scope: 'tenant',
          rules: { idleTimeoutMinutes: 20, absoluteTimeoutMinutes: 480 },
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      await createAndAssign(
        {
          name: 'Institution Policy',
          type: 'session_timeout',
          scope: 'institution',
          rules: { idleTimeoutMinutes: 15, absoluteTimeoutMinutes: 240 },
          priority: 150,
        },
        'institution',
        institutionId,
      );

      const result = await service.evaluate({
        type: 'session_timeout',
        tenantId,
        institutionId,
      });

      expect(result.effectivePolicy!.name).toBe('Institution Policy');
      expect(result.mergedRules).toEqual({
        idleTimeoutMinutes: 15,
        absoluteTimeoutMinutes: 240,
      });
    });

    it('should build correct inheritance chain', async () => {
      const platformPolicy = await createAndAssign(
        {
          name: 'Platform Rate Limit',
          type: 'rate_limiting',
          scope: 'platform',
          rules: { windowMs: 60000, maxRequests: 100 },
          priority: 50,
        },
        'platform',
        null,
      );

      const tenantPolicy = await createAndAssign(
        {
          name: 'Tenant Rate Limit',
          type: 'rate_limiting',
          scope: 'tenant',
          rules: { windowMs: 60000, maxRequests: 200 },
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'rate_limiting',
        tenantId,
      });

      expect(result.inheritanceChain).toHaveLength(3);
      expect(result.inheritanceChain[0]!.scope).toBe('platform');
      expect(result.inheritanceChain[0]!.policyId).toBe(platformPolicy.id);
      expect(result.inheritanceChain[1]!.scope).toBe('tenant');
      expect(result.inheritanceChain[1]!.policyId).toBe(tenantPolicy.id);
      expect(result.inheritanceChain[2]!.scope).toBe('institution');
      expect(result.inheritanceChain[2]!.policyId).toBeNull();
    });

    it('should merge rules from all levels', async () => {
      await createAndAssign(
        {
          name: 'Platform Password',
          type: 'password_complexity',
          scope: 'platform',
          rules: { minLength: 6, requireUppercase: false, preventReuse: 3 },
          priority: 50,
        },
        'platform',
        null,
      );

      await createAndAssign(
        {
          name: 'Tenant Password',
          type: 'password_complexity',
          scope: 'tenant',
          rules: { minLength: 10, requireUppercase: true },
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      // Merged: platform provides preventReuse, tenant overrides minLength and requireUppercase
      expect(result.mergedRules).toEqual({
        minLength: 10,
        requireUppercase: true,
        preventReuse: 3,
      });
    });
  });

  describe('effective dates', () => {
    it('should not include policies that have not started yet', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      await createAndAssign(
        {
          name: 'Future Policy',
          type: 'password_complexity',
          scope: 'tenant',
          rules: { minLength: 12 },
          effectiveFrom: futureDate.toISOString(),
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy).toBeNull();
    });

    it('should not include policies that have expired', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);

      await createAndAssign(
        {
          name: 'Expired Policy',
          type: 'password_complexity',
          scope: 'tenant',
          rules: { minLength: 12 },
          effectiveUntil: pastDate.toISOString(),
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy).toBeNull();
    });

    it('should include policies within effective date range', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      await createAndAssign(
        {
          name: 'Current Policy',
          type: 'data_retention',
          scope: 'tenant',
          rules: { retentionDays: 90 },
          effectiveFrom: pastDate.toISOString(),
          effectiveUntil: futureDate.toISOString(),
          priority: 100,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'data_retention',
        tenantId,
      });

      expect(result.effectivePolicy).not.toBeNull();
      expect(result.effectivePolicy!.name).toBe('Current Policy');
    });
  });

  describe('priority resolution', () => {
    it('should select higher priority policy at the same scope', async () => {
      await createAndAssign(
        {
          name: 'Low Priority',
          type: 'rate_limiting',
          scope: 'tenant',
          rules: { windowMs: 60000, maxRequests: 50 },
          priority: 50,
        },
        'tenant',
        tenantId,
      );

      await createAndAssign(
        {
          name: 'High Priority',
          type: 'rate_limiting',
          scope: 'tenant',
          rules: { windowMs: 60000, maxRequests: 200 },
          priority: 200,
        },
        'tenant',
        tenantId,
      );

      const result = await service.evaluate({
        type: 'rate_limiting',
        tenantId,
      });

      expect(result.effectivePolicy!.name).toBe('High Priority');
      expect(result.mergedRules).toEqual({ windowMs: 60000, maxRequests: 200 });
    });
  });

  describe('inactive policies', () => {
    it('should not include inactive policies in evaluation', async () => {
      const policy = await service.create(tenantId, {
        name: 'Inactive Policy',
        type: 'password_complexity',
        scope: 'tenant',
        rules: { minLength: 8 },
        priority: 100,
      });
      await service.activate(tenantId, policy.id);
      await service.assignPolicy(tenantId, {
        policyId: policy.id,
        targetType: 'tenant',
        targetId: tenantId,
      });
      // Now deactivate
      await service.deactivate(tenantId, policy.id);

      const result = await service.evaluate({
        type: 'password_complexity',
        tenantId,
      });

      expect(result.effectivePolicy).toBeNull();
    });
  });
});
