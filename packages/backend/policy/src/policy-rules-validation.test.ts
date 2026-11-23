/**
 * PRC-M609: policy rules are validated against the per-type rule schema, and
 * an assignment must be consistent with the policy scope.
 *
 * Failing-first: on the base source `rules` is an untyped record, so rules of
 * another type, wrong value types and out-of-range values are stored, and a
 * policy can be assigned to any target type and target id.
 */
import { BusinessRuleError, ValidationError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPolicyRepository } from './in-memory-repository.js';
import { PolicyService } from './policy-service.js';
import type { CreatePolicyInput } from './schemas.js';

const tenantId = 'tenant-m609';

const passwordPolicy: CreatePolicyInput = {
  name: 'Password Policy',
  type: 'password_complexity',
  scope: 'tenant',
  rules: {
    minLength: 10,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
  },
  priority: 100,
};

let service: PolicyService;

beforeEach(() => {
  service = new PolicyService(new InMemoryPolicyRepository());
});

describe('PRC-M609 rules are validated against the policy type', () => {
  it.each([
    ['a key of another policy type', { retentionDays: 30 }],
    ['a value of the wrong type', { requireUppercase: 'yes' }],
    ['a value below the schema minimum', { minLength: 2 }],
  ])('rejects create with %s', async (_label, rules) => {
    await expect(service.create(tenantId, { ...passwordPolicy, rules })).rejects.toThrow(
      ValidationError,
    );
    expect((await service.list(tenantId, {}, { page: 1, pageSize: 10 })).data).toHaveLength(0);
  });

  it('accepts a partial override that only sets keys of its type', async () => {
    const policy = await service.create(tenantId, {
      ...passwordPolicy,
      rules: { minLength: 12 },
    });
    expect(policy.rules).toEqual({ minLength: 12 });
  });

  it('rejects an update whose rules do not match the stored type and keeps the policy', async () => {
    const policy = await service.create(tenantId, passwordPolicy);
    await expect(
      service.update(tenantId, policy.id, { rules: { maxRequests: 100 } }),
    ).rejects.toThrow(ValidationError);
    const stored = await service.getById(tenantId, policy.id);
    expect(stored.version).toBe(1);
    expect(stored.rules).toEqual(passwordPolicy.rules);
  });
});

describe('PRC-M609 assignments must match the policy scope', () => {
  async function activePolicy(scope: CreatePolicyInput['scope']) {
    const policy = await service.create(tenantId, {
      ...passwordPolicy,
      name: `${scope} policy`,
      scope,
    });
    await service.activate(tenantId, policy.id);
    return policy;
  }

  it('rejects assigning a tenant-scope policy to the platform target', async () => {
    const policy = await activePolicy('tenant');
    await expect(
      service.assignPolicy(tenantId, { policyId: policy.id, targetType: 'platform' }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('rejects a tenant assignment that targets another tenant', async () => {
    const policy = await activePolicy('tenant');
    await expect(
      service.assignPolicy(tenantId, {
        policyId: policy.id,
        targetType: 'tenant',
        targetId: 'other-tenant',
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('rejects a platform assignment with a targetId', async () => {
    const policy = await activePolicy('platform');
    await expect(
      service.assignPolicy(tenantId, {
        policyId: policy.id,
        targetType: 'platform',
        targetId: 'x',
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('rejects an institution assignment without a targetId', async () => {
    const policy = await activePolicy('institution');
    await expect(
      service.assignPolicy(tenantId, { policyId: policy.id, targetType: 'institution' }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('accepts an assignment consistent with the policy scope', async () => {
    const policy = await activePolicy('institution');
    const assignment = await service.assignPolicy(tenantId, {
      policyId: policy.id,
      targetType: 'institution',
      targetId: 'inst-1',
    });
    expect(assignment.targetType).toBe('institution');
    expect(assignment.targetId).toBe('inst-1');
  });
});
