/**
 * Mocked-gateway tests for the fees client (PRC-M487, PRC-M489).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});
import { GatewayError } from './gateway';
import { createInvoice, listInvoicesResult, recordInvoicePayment, refundInvoice } from './fees';
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

describe('fees client — money mutations (PRC-M489)', () => {
  it('createInvoice posts integer amountCents unchanged', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'inv-1', amountCents: 125050 }));
    await createInvoice({ studentId: 's', title: 'Term', amountCents: 125050 } as never);
    const [path, init] = gatewayFetch.mock.calls[0]!;
    expect(path).toBe('/fees/invoices');
    expect(init).toMatchObject({ method: 'POST', json: { amountCents: 125050 } });
    expect(Number.isInteger((init as { json: { amountCents: number } }).json.amountCents)).toBe(
      true,
    );
  });
  it('refundInvoice encodes the id and sends integer cents with the reason', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'r-1', amountCents: 500 }));
    await refundInvoice('inv/1', { amountCents: 500, reason: 'overpaid' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/invoices/inv%2F1/refund');
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      json: { amountCents: 500, reason: 'overpaid' },
    });
  });
  it('recordInvoicePayment unwraps the invoice and throws GatewayError on an empty body', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ invoice: { id: 'inv-1', status: 'PAID' } }));
    await expect(recordInvoicePayment('inv-1')).resolves.toMatchObject({ status: 'PAID' });
    gatewayFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: null,
      error: { code: 'ALREADY_PAID', message: 'Already paid' },
    });
    await expect(recordInvoicePayment('inv-1')).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_PAID',
    });
    expect(GatewayError).toBeDefined();
  });
});
