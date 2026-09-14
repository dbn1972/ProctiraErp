/**
 * Unit tests for the queue abstraction types and utility functions.
 */

import { describe, it, expect } from 'vitest';

import { buildTenantName } from '../types';

describe('buildTenantName', () => {
  it('should prefix with tenant.{tenantId}.{name}', () => {
    expect(buildTenantName('abc-123', 'student.enrolled')).toBe('tenant.abc-123.student.enrolled');
  });

  it('should handle simple names', () => {
    expect(buildTenantName('t1', 'reports')).toBe('tenant.t1.reports');
  });

  it('should reject empty tenant ID (W1-SEC-11)', () => {
    expect(() => buildTenantName('', 'events')).toThrow(/tenantId is required/);
  });

  it('should reject unscoped names via assert', async () => {
    const { assertTenantScopedQueueName, TenantScopeError } = await import('../tenant-scope');
    expect(() => assertTenantScopedQueueName('events')).toThrow(TenantScopeError);
    expect(() => assertTenantScopedQueueName('tenant..events')).toThrow(TenantScopeError);
    expect(() => assertTenantScopedQueueName('#')).toThrow(TenantScopeError);
  });

  it('should accept tenant.# and tenant.* patterns', async () => {
    const { assertTenantScopedQueueName, isTenantScopedQueueName } = await import('../tenant-scope');
    expect(isTenantScopedQueueName('tenant.#')).toBe(true);
    expect(isTenantScopedQueueName('tenant.*.events')).toBe(true);
    expect(() => assertTenantScopedQueueName('tenant.#')).not.toThrow();
  });

  it('should handle complex topic names', () => {
    expect(buildTenantName('org-456', 'workflow.approval.step1')).toBe(
      'tenant.org-456.workflow.approval.step1',
    );
  });
});
