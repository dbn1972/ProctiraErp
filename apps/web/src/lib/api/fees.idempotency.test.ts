/**
 * PRC-H058: refund and concession writes forward the caller's Idempotency-Key to the gateway
 * so a retried or double-submitted money action is applied at most once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));

import { applyConcession, refundInvoice } from './fees';

const KEY = '7a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

describe('fees money writes carry Idempotency-Key (PRC-H058)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { id: 'r-1', amountCents: 5 } });
  });

  it('refundInvoice sends the key header', async () => {
    await refundInvoice('inv-1', { amountCents: 500, reason: 'overpaid' }, KEY);
    const [path, init] = gatewayFetch.mock.calls[0]!;
    expect(path).toBe('/fees/invoices/inv-1/refund');
    expect(init.headers).toEqual({ 'Idempotency-Key': KEY });
  });

  it('applyConcession sends the key header', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { discountCents: 1, invoice: null },
    });
    await applyConcession(
      { studentId: 's', structureId: 'f', kind: 'percent', percent: 10, reason: 'sibling' },
      KEY,
    );
    expect(gatewayFetch.mock.calls[0]![1].headers).toEqual({ 'Idempotency-Key': KEY });
  });

  it('omits the header when no key is supplied', async () => {
    await refundInvoice('inv-1', { amountCents: 500, reason: 'overpaid' });
    expect(gatewayFetch.mock.calls[0]![1].headers).toBeUndefined();
  });
});
