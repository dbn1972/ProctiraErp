/**
 * PRC-M630: merged rules honour priority across scope levels and merge nested
 * objects deeply.
 *
 * Failing-first: on the base source the merge is a shallow Object.assign in
 * platform -> tenant -> institution order, so a lower-priority tenant policy
 * silently replaces a higher-priority (stricter) platform value, and a nested
 * rule object replaces the inherited one wholesale.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPolicyRepository } from './in-memory-repository.js';
import { PolicyEvaluationEngine } from './policy-evaluation-engine.js';

const tenantId = 'tenant-m630';
let repository: InMemoryPolicyRepository;
let engine: PolicyEvaluationEngine;
let seq = 0;

/** Store an active policy and its assignment directly (the engine reads the repository). */
async function seed(
  scope: 'platform' | 'tenant',
  priority: number,
  rules: Record<string, unknown>,
): Promise<void> {
  seq += 1;
  const id = `00000000-0000-4000-8000-00000000000${seq}`;
  await repository.create({
    id,
    tenantId,
    name: `${scope}-${seq}`,
    description: null,
    type: 'password_complexity',
    scope,
    status: 'active',
    rules,
    version: 1,
    effectiveFrom: null,
    effectiveUntil: null,
    priority,
  });
  await repository.createAssignment({
    id: `10000000-0000-4000-8000-00000000000${seq}`,
    policyId: id,
    targetType: scope,
    targetId: scope === 'tenant' ? tenantId : null,
    tenantId,
  });
}

beforeEach(() => {
  seq = 0;
  repository = new InMemoryPolicyRepository();
  engine = new PolicyEvaluationEngine(repository);
});

describe('PRC-M630 merge is priority-aware across scope levels', () => {
  it('keeps a higher-priority platform value over a lower-priority tenant value', async () => {
    await seed('platform', 500, { minLength: 14, requireNumbers: true });
    await seed('tenant', 100, { minLength: 8, requireUppercase: true });

    const result = await engine.evaluate({ type: 'password_complexity', tenantId });

    expect(result.mergedRules).toEqual({
      minLength: 14,
      requireNumbers: true,
      requireUppercase: true,
    });
  });

  it('lets the more specific scope win at equal priority', async () => {
    await seed('platform', 100, { minLength: 8 });
    await seed('tenant', 100, { minLength: 12 });

    const result = await engine.evaluate({ type: 'password_complexity', tenantId });

    expect(result.mergedRules).toEqual({ minLength: 12 });
  });
});

describe('PRC-M630 merge is deep', () => {
  it('merges nested rule objects key by key instead of replacing them', async () => {
    await seed('platform', 100, { lockout: { attempts: 5, windowMinutes: 15 } });
    await seed('tenant', 200, { lockout: { attempts: 3 } });

    const result = await engine.evaluate({ type: 'password_complexity', tenantId });

    expect(result.mergedRules).toEqual({ lockout: { attempts: 3, windowMinutes: 15 } });
  });
});
