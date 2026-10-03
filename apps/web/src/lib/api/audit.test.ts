/**
 * PRC-M576 — the audit viewer calls the routes the gateway actually mounts
 * (`/api/v1/audit-logs`, `/entity-types`, `/:id`) and maps the backend
 * entry shape onto the viewer model. The matching server-side contract is
 * packages/backend/audit/src/viewer-contract.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuditEntriesPath,
  getAuditEntry,
  listAuditEntityTypes,
  listAuditEntries,
} from './audit';

function mockFetch(body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function calledPath(fetchMock: ReturnType<typeof mockFetch>): string {
  const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
  return url.slice(url.indexOf('/api/v1'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audit API client (PRC-M576)', () => {
  it('builds the list URL with backend filter names', () => {
    expect(
      buildAuditEntriesPath({ entityType: 'student', dateFrom: '2026-01-01', dateTo: '2026-01-31' }),
    ).toBe('/audit-logs?entityType=student&startDate=2026-01-01&endDate=2026-01-31');
    expect(buildAuditEntriesPath()).toBe('/audit-logs');
  });

  it('listAuditEntries hits /api/v1/audit-logs and maps entries', async () => {
    const fetchMock = mockFetch({
      data: [
        {
          id: 'e1',
          entityType: 'student',
          entityId: 's1',
          operation: 'UPDATE',
          userId: 'u1',
          userName: 'Asha Rao',
          ipAddress: null,
          timestamp: '2026-01-02T00:00:00.000Z',
          beforeValues: { grade: '9', name: 'A' },
          afterValues: { grade: '10', name: 'A' },
          metadata: null,
        },
      ],
      meta: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
    });
    const res = await listAuditEntries({ page: 1 });
    expect(calledPath(fetchMock)).toBe('/api/v1/audit-logs?page=1');
    expect(res.data[0]).toMatchObject({
      userDisplayName: 'Asha Rao',
      changes: [{ field: 'grade', before: '9', after: '10' }],
    });
    expect(res.meta.totalItems).toBe(1);
  });

  it('getAuditEntry and listAuditEntityTypes use the mounted routes', async () => {
    let fetchMock = mockFetch({
      id: 'e/1',
      entityType: 'x',
      entityId: 'y',
      operation: 'CREATE',
      userId: 'u1',
      timestamp: '2026-01-02T00:00:00.000Z',
      afterValues: { a: 1 },
    });
    const entry = await getAuditEntry('e/1');
    expect(calledPath(fetchMock)).toBe('/api/v1/audit-logs/e%2F1');
    expect(entry.userDisplayName).toBe('u1');
    vi.unstubAllGlobals();
    fetchMock = mockFetch({ data: ['student'] });
    expect(await listAuditEntityTypes()).toEqual(['student']);
    expect(calledPath(fetchMock)).toBe('/api/v1/audit-logs/entity-types');
  });
});
