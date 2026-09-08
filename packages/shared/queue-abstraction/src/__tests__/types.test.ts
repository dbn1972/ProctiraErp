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

  it('should handle empty tenant ID', () => {
    expect(buildTenantName('', 'events')).toBe('tenant..events');
  });

  it('should handle complex topic names', () => {
    expect(buildTenantName('org-456', 'workflow.approval.step1')).toBe(
      'tenant.org-456.workflow.approval.step1',
    );
  });
});
