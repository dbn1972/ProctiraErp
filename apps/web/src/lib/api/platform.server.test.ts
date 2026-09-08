/**
 * G-727 — platform surface clients: shape mapping and access classification.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));

import { listAuditLogs, listBillingPlans, listTenants } from './platform.server';

function ok<T>(data: T) {
  return { status: 200, ok: true, data };
}

describe('platform.server clients', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
  });

  it('maps billing plans (feature/quota arrays → enabled keys + metric map) and forwards filters', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          {
            id: 'p1',
            name: 'Professional',
            tier: 'professional',
            status: 'active',
            features: [
              { featureKey: 'custom_fields', enabled: true },
              { featureKey: 'sso', enabled: false },
            ],
            quotas: [
              { metric: 'students', limit: 5000 },
              { metric: 'api_calls_per_day', limit: -1 },
            ],
            priceMonthly: 499900,
            priceYearly: 4999000,
            trialDays: 14,
            sortOrder: 2,
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        meta: { page: 2, pageSize: 20, totalItems: 21, totalPages: 2 },
      }),
    );

    const result = await listBillingPlans({ tier: 'professional', page: 2, pageSize: 20 });

    expect(gatewayFetch).toHaveBeenCalledWith(
      '/billing/plans?tier=professional&page=2&pageSize=20',
      expect.objectContaining({ throwOnError: false }),
    );
    expect(result.access).toBe('ok');
    expect(result.source).toBe('gateway');
    expect(result.meta).toEqual({ page: 2, pageSize: 20, totalItems: 21, totalPages: 2 });
    expect(result.data[0]).toMatchObject({
      id: 'p1',
      features: ['custom_fields'],
      quotas: { students: 5000, api_calls_per_day: -1 },
      priceMonthly: 499900,
      trialDays: 14,
    });
  });

  it('derives changed fields for audit entries and sorts newest first', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          {
            id: 'a1',
            entityType: 'student',
            entityId: 's-1',
            operation: 'UPDATE',
            userId: 'u1',
            userName: 'Asha',
            ipAddress: '10.0.0.1',
            timestamp: '2026-09-08T10:00:00.000Z',
            beforeValues: { status: 'draft', name: 'A', grade: 5 },
            afterValues: { status: 'active', name: 'A', grade: 6 },
          },
        ],
        meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
      }),
    );

    const result = await listAuditLogs({ entityType: 'student', startDate: '2026-09-01' });

    expect(gatewayFetch.mock.calls[0]?.[0]).toBe(
      '/audit-logs?entityType=student&startDate=2026-09-01&sortOrder=desc',
    );
    expect(result.data[0]?.changedFields).toEqual(['grade', 'status']);
    expect(result.data[0]?.userName).toBe('Asha');
  });

  it('classifies 403 as forbidden (not scaffold) and unreachable gateway as scaffold', async () => {
    gatewayFetch.mockResolvedValueOnce({
      status: 403,
      ok: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'nope' },
    });
    const forbidden = await listTenants();
    expect(forbidden.access).toBe('forbidden');
    expect(forbidden.source).toBe('gateway');
    expect(forbidden.data).toEqual([]);

    gatewayFetch.mockResolvedValueOnce({
      status: 0,
      ok: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'ECONNREFUSED' },
    });
    const offline = await listTenants();
    expect(offline.access).toBe('ok');
    expect(offline.source).toBe('scaffold');
    expect(offline.errorCode).toBe('NETWORK_ERROR');
  });

  it('maps tenant lifecycle rows and nullable timestamps', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          {
            id: 't1',
            name: 'Northside',
            slug: 'northside',
            status: 'suspended',
            plan: 'starter',
            region: 'ap-south-1',
            suspendedAt: '2026-09-02T00:00:00.000Z',
            suspendedReason: 'Non-payment',
            decommissionedAt: null,
            dataRetentionUntil: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-09-02T00:00:00.000Z',
          },
        ],
        meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      }),
    );

    const result = await listTenants({ status: 'suspended' });
    expect(gatewayFetch.mock.calls[0]?.[0]).toBe('/tenant-lifecycle?status=suspended');
    expect(result.data[0]).toMatchObject({
      slug: 'northside',
      status: 'suspended',
      suspendedReason: 'Non-payment',
      decommissionedAt: null,
    });
  });
});
