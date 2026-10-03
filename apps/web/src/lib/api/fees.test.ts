/**
 * Mocked-gateway tests for the fees client (PRC-M487, PRC-M489).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});
import { listInvoicesResult } from './fees';
function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
beforeEach(() => {
  gatewayFetch.mockReset();
});
describe('fees client — invoices (PRC-M487)', () => {
  it('sends studentId to the server and does not filter client-side', async () => {
    // Server already scoped the result; the client must return it as-is.
    gatewayFetch.mockResolvedValueOnce(ok({ data: [{ id: 'inv-101', studentId: 'stu-1' }] }));
    const result = await listInvoicesResult('staff', { studentId: 'stu-1' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/invoices?studentId=stu-1');
    expect(result.ok && result.items.map((i) => i.id)).toEqual(['inv-101']);
  });
  it('combines parent scope with the student filter and encodes it', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [] }));
    await listInvoicesResult('parent', { studentId: 'a/b' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/invoices?scope=parent&studentId=a%2Fb');
  });
  it('omits the query string when there are no filters', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [] }));
    await listInvoicesResult('staff');
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/invoices');
  });
});
