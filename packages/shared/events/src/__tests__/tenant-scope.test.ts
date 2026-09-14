/**
 * W1-SEC-11 — events tenant topic/queue/routing-key enforcement.
 */
import { describe, it, expect } from 'vitest';

import { buildTenantTopic } from '../kafka/config.js';
import { buildTenantQueue, buildTenantRoutingKey } from '../rabbitmq/config.js';
import {
  TenantScopeError,
  assertTenantScopedEventName,
  isTenantScopedEventName,
} from '../tenant-scope.js';

describe('W1-SEC-11 events tenant namespaces', () => {
  it('builds tenant-prefixed names', () => {
    expect(buildTenantTopic('t1', 'student')).toBe('tenant.t1.student');
    expect(buildTenantQueue('t1', 'reports')).toBe('tenant.t1.reports');
    expect(buildTenantRoutingKey('t1', 'report.generate')).toBe('tenant.t1.report.generate');
  });

  it('rejects missing tenant id', () => {
    expect(() => buildTenantTopic('', 'student')).toThrow(TenantScopeError);
    expect(() => buildTenantQueue('  ', 'reports')).toThrow(TenantScopeError);
    expect(() => buildTenantRoutingKey('', 'x')).toThrow(TenantScopeError);
  });

  it('rejects empty suffix', () => {
    expect(() => buildTenantTopic('t1', '')).toThrow(TenantScopeError);
    expect(() => buildTenantQueue('t1', '   ')).toThrow(TenantScopeError);
  });

  it('rejects unscoped names', () => {
    for (const name of ['student', 'reports', 'tenant..student', 'tenant.', '', 'global.events']) {
      expect(isTenantScopedEventName(name)).toBe(false);
      expect(() => assertTenantScopedEventName(name)).toThrow(TenantScopeError);
    }
  });

  it('accepts scoped names', () => {
    expect(isTenantScopedEventName('tenant.acme.student.enrolled')).toBe(true);
    expect(() => assertTenantScopedEventName('tenant.acme.student')).not.toThrow();
  });
});
