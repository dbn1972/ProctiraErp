/**
 * W1-SEC-10 — PHI read audit fail-closed / explicit degrade.
 */
import { describe, it, expect, vi } from 'vitest';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import type { HealthRepository } from './health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import type { PhiAccessLogInput } from './pg-special-needs-store.js';
import {
  PhiAuditUnavailableError,
  recordPhiReadAudit,
  shouldFailClosedOnPhiAudit,
} from './phi-read-audit.js';

const entry: PhiAccessLogInput = {
  tenantId: 'tenant-1',
  actorUserId: 'user-1',
  studentId: 'student-1',
  resourceType: 'measurement',
  resourceId: 'm-1',
};

describe('W1-SEC-10 PHI read audit policy', () => {
  it('fail-closes in production when auditor missing', async () => {
    expect(shouldFailClosedOnPhiAudit({ NODE_ENV: 'production' })).toBe(true);
    await expect(
      recordPhiReadAudit({
        logPhiAccess: null,
        entry,
        env: { NODE_ENV: 'production' },
      }),
    ).rejects.toBeInstanceOf(PhiAuditUnavailableError);
  });

  it('allows explicit degrade in production via ALLOW_PHI_AUDIT_DEGRADE', async () => {
    const onDegrade = vi.fn();
    await expect(
      recordPhiReadAudit({
        logPhiAccess: null,
        entry,
        env: { NODE_ENV: 'production', ALLOW_PHI_AUDIT_DEGRADE: '1' },
        onDegrade,
      }),
    ).resolves.toBeUndefined();
    expect(onDegrade).toHaveBeenCalledWith('missing_auditor');
  });

  it('no-ops outside production when auditor missing', async () => {
    await expect(
      recordPhiReadAudit({
        logPhiAccess: undefined,
        entry,
        env: { NODE_ENV: 'test' },
      }),
    ).resolves.toBeUndefined();
  });

  it('fail-closes in production when auditor throws', async () => {
    await expect(
      recordPhiReadAudit({
        logPhiAccess: async () => {
          throw new Error('disk full');
        },
        entry,
        env: { NODE_ENV: 'production' },
      }),
    ).rejects.toMatchObject({
      name: 'PhiAuditUnavailableError',
      statusCode: 503,
    });
  });

  it('degrades auditor throws outside production', async () => {
    const onDegrade = vi.fn();
    await expect(
      recordPhiReadAudit({
        logPhiAccess: async () => {
          throw new Error('transient');
        },
        entry,
        env: { NODE_ENV: 'development' },
        onDegrade,
      }),
    ).resolves.toBeUndefined();
    expect(onDegrade).toHaveBeenCalledWith('auditor_threw', expect.any(Error));
  });

  it('persists when auditor is present', async () => {
    const logPhiAccess = vi.fn(async () => undefined);
    await recordPhiReadAudit({
      logPhiAccess,
      entry,
      env: { NODE_ENV: 'production' },
    });
    expect(logPhiAccess).toHaveBeenCalledWith(entry);
  });
});

describe('W1-SEC-10 HealthService PHI read integration', () => {
  const tenantId = 'tenant-001';
  const access: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  it('refuses PHI list read in production when repository lacks logPhiAccess', async () => {
    const previous = process.env.NODE_ENV;
    const previousDegrade = process.env.ALLOW_PHI_AUDIT_DEGRADE;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PHI_AUDIT_DEGRADE;

    try {
      const memory = new InMemoryHealthRepository();
      await memory.createMeasurement({
        id: 'm-1',
        tenantId,
        studentId: 'student-001',
        date: '2024-01-01',
        height: 160,
        weight: 50,
        bmi: null,
        bloodPressureSystolic: null,
        bloodPressureDiastolic: null,
        heartRate: null,
        visionLeft: null,
        visionRight: null,
        notes: null,
      });

      const proxy = new Proxy(memory, {
        get(target, prop, receiver) {
          if (prop === 'logPhiAccess') return undefined;
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }) as HealthRepository;

      const service = new HealthService(proxy);
      await expect(
        service.listMeasurements(tenantId, 'student-001', { page: 1, pageSize: 10 }, access),
      ).rejects.toBeInstanceOf(PhiAuditUnavailableError);
    } finally {
      process.env.NODE_ENV = previous;
      if (previousDegrade === undefined) delete process.env.ALLOW_PHI_AUDIT_DEGRADE;
      else process.env.ALLOW_PHI_AUDIT_DEGRADE = previousDegrade;
    }
  });
});
