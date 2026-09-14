/**
 * W1-SEC-10 — gateway mutation audit fail-closed / explicit degrade.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  isSecuritySensitiveMutationPath,
  MUTATION_AUDIT_UNAVAILABLE_BODY,
  persistMutationAudit,
  shouldAuditMutation,
  shouldFailClosedOnMutationAuditFailure,
} from './mutation-audit.js';

describe('W1-SEC-10 mutation audit policy', () => {
  it('classifies health/fees/privacy mutations as security-sensitive', () => {
    expect(isSecuritySensitiveMutationPath('/api/v1/health/measurements')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/fees/invoices')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/scholarships/awards')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/billing/subscriptions')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/tenant-lifecycle/tenants/x')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/privacy/requests')).toBe(true);
    expect(isSecuritySensitiveMutationPath('/api/v1/students')).toBe(true);
  });

  it('does not treat library/lms as security-sensitive for fail-closed', () => {
    expect(isSecuritySensitiveMutationPath('/api/v1/library/loans')).toBe(false);
    expect(isSecuritySensitiveMutationPath('/api/v1/lms/courses')).toBe(false);
  });

  it('fail-closes sensitive paths in production without degrade flag', () => {
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/health/allergies',
        env: { NODE_ENV: 'production' },
      }),
    ).toBe(true);
  });

  it('allows explicit degrade via ALLOW_MUTATION_AUDIT_DEGRADE', () => {
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/fees/payments',
        env: { NODE_ENV: 'production', ALLOW_MUTATION_AUDIT_DEGRADE: '1' },
      }),
    ).toBe(false);
  });

  it('does not fail-close non-sensitive or non-prod failures', () => {
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/library/loans',
        env: { NODE_ENV: 'production' },
      }),
    ).toBe(false);
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/health/measurements',
        env: { NODE_ENV: 'test' },
      }),
    ).toBe(false);
  });

  it('persistMutationAudit returns failClosed for sensitive prod when recorder throws', async () => {
    const outcome = await persistMutationAudit({
      path: '/api/v1/health/measurements',
      env: { NODE_ENV: 'production' },
      auditService: {
        recordAudit: async () => {
          throw new Error('audit store down');
        },
      },
      input: {
        tenantId: 't1',
        entityType: 'health_record',
        entityId: 'x',
        operation: 'CREATE',
        userId: 'u1',
        userName: 'u1',
        ipAddress: '127.0.0.1',
        beforeValues: null,
        afterValues: { path: '/api/v1/health/measurements' },
        metadata: {},
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failClosed).toBe(true);
      expect(outcome.error).toBeInstanceOf(Error);
    }
    expect(MUTATION_AUDIT_UNAVAILABLE_BODY.statusCode).toBe(503);
  });

  it('persistMutationAudit logs-only (failClosed=false) for non-sensitive when recorder missing', async () => {
    const outcome = await persistMutationAudit({
      path: '/api/v1/library/loans',
      env: { NODE_ENV: 'production' },
      auditService: null,
      input: {
        tenantId: 't1',
        entityType: 'library',
        entityId: 'x',
        operation: 'CREATE',
        userId: 'u1',
        userName: 'u1',
        ipAddress: '127.0.0.1',
        beforeValues: null,
        afterValues: { path: '/api/v1/library/loans' },
        metadata: {},
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failClosed).toBe(false);
  });

  it('persistMutationAudit succeeds when recorder works', async () => {
    const recordAudit = vi.fn(async () => ({ id: 'a1' }));
    const outcome = await persistMutationAudit({
      path: '/api/v1/health/measurements',
      env: { NODE_ENV: 'production' },
      auditService: { recordAudit },
      input: {
        tenantId: 't1',
        entityType: 'health_record',
        entityId: 'x',
        operation: 'CREATE',
        userId: 'u1',
        userName: 'u1',
        ipAddress: '127.0.0.1',
        beforeValues: null,
        afterValues: { path: '/api/v1/health/measurements' },
        metadata: {},
      },
    });
    expect(outcome).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it('still selects mutating /api/v1 paths for audit', () => {
    expect(shouldAuditMutation('POST', '/api/v1/health/measurements')).toBe(true);
    expect(shouldAuditMutation('GET', '/api/v1/health/measurements')).toBe(false);
  });
});
