/**
 * W1-SEC-10 — gateway mutation audit fail-closed / no production bypass /
 * same-txn markers for regulated routes.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  ATOMIC_MUTATION_AUDIT_PATH_PREFIXES,
  isAtomicMutationAuditPath,
  isDeniedMutationStatus,
  isMutationAuditDegradeAllowed,
  isSecuritySensitiveMutationPath,
  markRegulatedMutationAuditCommitted,
  MUTATION_AUDIT_UNAVAILABLE_BODY,
  mutationAuditPayloadFor,
  operationForMethod,
  persistMutationAudit,
  shouldAuditMutation,
  shouldFailClosedOnMutationAuditFailure,
  wasRegulatedMutationAuditCommitted,
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

  it('ignores ALLOW_MUTATION_AUDIT_DEGRADE in production (no bypass)', () => {
    expect(
      isMutationAuditDegradeAllowed({
        NODE_ENV: 'production',
        ALLOW_MUTATION_AUDIT_DEGRADE: '1',
      }),
    ).toBe(false);
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/fees/payments',
        env: { NODE_ENV: 'production', ALLOW_MUTATION_AUDIT_DEGRADE: '1' },
      }),
    ).toBe(true);
  });

  it('allows explicit degrade only outside production', () => {
    expect(
      shouldFailClosedOnMutationAuditFailure({
        path: '/api/v1/fees/payments',
        env: { NODE_ENV: 'development', ALLOW_MUTATION_AUDIT_DEGRADE: '1' },
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

  it('marks atomic regulated path prefixes', () => {
    expect(ATOMIC_MUTATION_AUDIT_PATH_PREFIXES.length).toBeGreaterThan(0);
    expect(isAtomicMutationAuditPath('/api/v1/health/measurements')).toBe(true);
    expect(isAtomicMutationAuditPath('/api/v1/fees/payments')).toBe(true);
    expect(isAtomicMutationAuditPath('/api/v1/privacy/holds')).toBe(false);
  });

  it('tracks request-level atomic audit commit marker', () => {
    const request = {} as Parameters<typeof markRegulatedMutationAuditCommitted>[0];
    expect(wasRegulatedMutationAuditCommitted(request)).toBe(false);
    markRegulatedMutationAuditCommitted(request);
    expect(wasRegulatedMutationAuditCommitted(request)).toBe(true);
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

/**
 * V15-15 — denied mutations must leave an audit row.
 *
 * The gateway's `onSend` hook returned early for both 401 and 403, so every RBAC denial,
 * `TENANT_SUSPENDED`, `FEATURE_NOT_ENTITLED` and default-deny rejection on a mutating
 * route left only a log line. The decision lived inline in the hook and nothing covered
 * it, which is how it survived; it is now `mutationAuditPayloadFor` so it can be asserted
 * without booting the app.
 */
describe('V15-15 denied mutation auditing', () => {
  const request = {
    method: 'POST',
    url: '/api/v1/students/abc-123/consents?force=1',
    body: { guardianId: 'g-1', secret: 'do-not-persist' },
    ip: '10.1.2.3',
  } as unknown as Parameters<typeof mutationAuditPayloadFor>[0]['request'];

  it('classifies 401 and 403 as refusals, and nothing else', () => {
    expect(isDeniedMutationStatus(401)).toBe(true);
    expect(isDeniedMutationStatus(403)).toBe(true);
    // A validation failure is not an authorization decision; a fault is not a decision.
    expect(isDeniedMutationStatus(400)).toBe(false);
    expect(isDeniedMutationStatus(409)).toBe(false);
    expect(isDeniedMutationStatus(422)).toBe(false);
    expect(isDeniedMutationStatus(500)).toBe(false);
    expect(isDeniedMutationStatus(201)).toBe(false);
  });

  it('marks a 403 as denied so it is queryable', () => {
    const payload = mutationAuditPayloadFor({
      operation: 'CREATE',
      request,
      statusCode: 403,
      method: 'POST',
      path: '/api/v1/students/abc-123/consents',
    });
    expect(payload.metadata).toMatchObject({
      outcome: 'denied',
      statusCode: 403,
      method: 'POST',
      path: '/api/v1/students/abc-123/consents',
    });
  });

  it('persists no request payload for a refused call — not even a hash', () => {
    // The body of a denied mutation is unvalidated caller-controlled data. Storing it, or
    // a hash of it, puts attacker-chosen content in a tenant's audit trail.
    const payload = mutationAuditPayloadFor({
      operation: 'CREATE',
      request,
      statusCode: 403,
      method: 'POST',
      path: '/api/v1/students/abc-123/consents',
    });
    expect(payload.beforeValues).toBeNull();
    expect(payload.afterValues).toBeNull();
    expect(JSON.stringify(payload)).not.toContain('do-not-persist');
    expect(JSON.stringify(payload)).not.toContain('bodyHash');
  });

  it('keeps the attempted operation rather than inventing a DENY verb', () => {
    // `AuditOperation` is a closed CREATE|UPDATE|DELETE union backed by the hash chain, so
    // recording the attempt plus an outcome avoids a migration and a drift-gate change.
    for (const [method, operation] of [
      ['POST', 'CREATE'],
      ['PATCH', 'UPDATE'],
      ['DELETE', 'DELETE'],
    ] as const) {
      expect(operationForMethod(method)).toBe(operation);
      const payload = mutationAuditPayloadFor({
        operation,
        request,
        statusCode: 403,
        method,
        path: '/api/v1/students/abc-123',
      });
      expect(payload.metadata.outcome).toBe('denied');
    }
  });

  it('still records an applied mutation with its body hash', () => {
    // The pre-existing behaviour must not regress: a permitted mutation keeps the hash so
    // a change can be correlated without storing the payload.
    const payload = mutationAuditPayloadFor({
      operation: 'CREATE',
      request,
      statusCode: 201,
      method: 'POST',
      path: '/api/v1/students/abc-123/consents',
    });
    expect(payload.metadata.outcome).toBe('applied');
    expect(payload.afterValues).toMatchObject({ path: '/api/v1/students/abc-123/consents' });
    expect(payload.afterValues?.bodyHash).toBeTypeOf('string');
    expect(JSON.stringify(payload)).not.toContain('do-not-persist');
  });

  it('records a validation failure as applied-path, not as a refusal', () => {
    // 4xx that is not 401/403 was already audited and must keep that shape.
    const payload = mutationAuditPayloadFor({
      operation: 'CREATE',
      request,
      statusCode: 422,
      method: 'POST',
      path: '/api/v1/students/abc-123/consents',
    });
    expect(payload.metadata).toMatchObject({ outcome: 'applied', statusCode: 422 });
  });
});
