/**
 * PRC-M065 / PRC-M089: staff payment recording sends the real method, a
 * (partial) amount in minor units, a reference and an idempotency key;
 * sandbox is refused unless explicitly enabled server-side, and malformed
 * invoice ids never reach the gateway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const recordInvoicePayment = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/fees', () => ({
  recordInvoicePayment: (...args: unknown[]) => recordInvoicePayment(...args),
}));
import { recordStaffPaymentAction } from './actions';
const INVOICE = '11111111-2222-4333-8444-555555555555';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
describe('recordStaffPaymentAction (PRC-M065, PRC-M089)', () => {
  beforeEach(() => {
    recordInvoicePayment.mockReset();
    recordInvoicePayment.mockResolvedValue({ id: INVOICE });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('records a partial cash payment of 500.00 as 50000 minor units', async () => {
    const result = await recordStaffPaymentAction({
      invoiceId: INVOICE,
      method: 'cash',
      amount: 500,
      reference: 'RB-1',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
    expect(recordInvoicePayment).toHaveBeenCalledWith(INVOICE, {
      method: 'cash',
      amountCents: 50000,
      idempotencyKey: KEY,
      reference: 'RB-1',
    });
  });
  it('records a card payment with its approval code', async () => {
    const result = await recordStaffPaymentAction({
      invoiceId: INVOICE,
      method: 'card',
      amount: 10,
      reference: 'APPR-77',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
    expect(recordInvoicePayment).toHaveBeenCalledWith(
      INVOICE,
      expect.objectContaining({ method: 'card', reference: 'APPR-77' }),
    );
  });
  it('rejects a non-UUID invoice id without calling the gateway', async () => {
    const result = await recordStaffPaymentAction({
      invoiceId: '../../admin',
      method: 'cash',
      amount: 10,
      reference: 'RB-1',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(false);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });
  it('rejects zero amounts and missing references', async () => {
    for (const values of [
      { method: 'cash', amount: 0, reference: 'RB-1' },
      { method: 'cash', amount: Number.NaN, reference: 'RB-1' },
      { method: 'upi', amount: 10 },
    ]) {
      const result = await recordStaffPaymentAction({
        invoiceId: INVOICE,
        idempotencyKey: KEY,
        ...(values as { method: 'cash'; amount: number }),
      });
      expect(result.success).toBe(false);
    }
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });
  it('refuses the sandbox method unless explicitly enabled', async () => {
    vi.stubEnv('FEES_STAFF_SANDBOX_PAYMENTS', '');
    const result = await recordStaffPaymentAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: 10,
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(false);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });
  it('allows sandbox when the server flag is on', async () => {
    vi.stubEnv('FEES_STAFF_SANDBOX_PAYMENTS', 'true');
    const result = await recordStaffPaymentAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: 10,
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
  });
});
