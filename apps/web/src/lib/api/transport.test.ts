/**
 * @vitest-environment node
 *
 * T-D2 — transport list clients must read every page, not the gateway's default
 * first 20 rows, and must report the gateway's total rather than the rows read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetchMock = vi.fn();
vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetchMock(...args),
  GatewayError: class extends Error {},
}));
import {
  listDriverAssignments,
  listStudentAssignments,
  listTransportRoutes,
  listTransportRoutesWithTotal,
  listTransportVehicles,
  listTransportVehiclesWithTotal,
  listDriverAssignmentsWithTotal,
  listStudentAssignmentsWithTotal,
} from './transport';
/** The transport package's default page size when the client sends none. */
const SERVER_DEFAULT_PAGE_SIZE = 20;
const TOTAL = 130;
/** A gateway list endpoint holding `TOTAL` rows; `failPage` answers 500 for that page. */
function serveList(failPage?: number) {
  return (path: string) => {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? SERVER_DEFAULT_PAGE_SIZE);
    if (page === failPage) {
      return Promise.resolve({ ok: false, status: 500, data: null, error: { code: 'X' } });
    }
    const start = (page - 1) * pageSize;
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, TOTAL - start)) }, (_, i) => ({
      id: `row-${start + i}`,
      name: `Row ${start + i}`,
      registrationNumber: `REG-${start + i}`,
    }));
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        data,
        meta: { page, pageSize, totalItems: TOTAL, totalPages: Math.ceil(TOTAL / pageSize) },
      },
    });
  };
}
const ARRAY_READERS = [
  ['listTransportRoutes', '/transport/routes', listTransportRoutes],
  ['listTransportVehicles', '/transport/vehicles', listTransportVehicles],
  ['listDriverAssignments', '/transport/driver-assignments', listDriverAssignments],
  ['listStudentAssignments', '/transport/student-assignments', listStudentAssignments],
] as const;
const COUNTED_READERS = [
  ['listTransportRoutesWithTotal', listTransportRoutesWithTotal],
  ['listTransportVehiclesWithTotal', listTransportVehiclesWithTotal],
  ['listDriverAssignmentsWithTotal', listDriverAssignmentsWithTotal],
  ['listStudentAssignmentsWithTotal', listStudentAssignmentsWithTotal],
] as const;
beforeEach(() => {
  gatewayFetchMock.mockReset();
});
describe('T-D2 transport list clients read every page', () => {
  it.each(ARRAY_READERS)('%s returns all %s rows, past the first 20', async (_name, path, read) => {
    gatewayFetchMock.mockImplementation(serveList());
    const rows = await read();
    expect(rows).toHaveLength(TOTAL);
    expect(rows.at(-1)?.id).toBe(`row-${TOTAL - 1}`);
    expect(gatewayFetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `${path}?page=1&pageSize=100`,
      `${path}?page=2&pageSize=100`,
    ]);
  });
  it.each(COUNTED_READERS)('%s reports the gateway total', async (_name, read) => {
    gatewayFetchMock.mockImplementation(serveList());
    const list = await read();
    expect(list.items).toHaveLength(TOTAL);
    expect(list.totalItems).toBe(TOTAL);
    expect(list.truncated).toBe(false);
  });
  it.each(COUNTED_READERS)(
    '%s keeps the rows read and the true total when a later page fails',
    async (_name, read) => {
      gatewayFetchMock.mockImplementation(serveList(2));
      const list = await read();
      expect(list.items).toHaveLength(100);
      expect(list.totalItems).toBe(TOTAL);
      expect(list.truncated).toBe(true);
    },
  );
  it.each(COUNTED_READERS)('%s is empty when the first page fails', async (_name, read) => {
    gatewayFetchMock.mockImplementation(serveList(1));
    await expect(read()).resolves.toEqual({ items: [], totalItems: 0, truncated: false });
  });
  it('maps route rows', async () => {
    gatewayFetchMock.mockImplementation(serveList());
    const { items } = await listTransportRoutesWithTotal();
    expect(items[0]).toMatchObject({ id: 'row-0', name: 'Row 0', operatingDays: [] });
  });
});
