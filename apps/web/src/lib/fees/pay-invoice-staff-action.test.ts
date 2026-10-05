/**
 * PRC-M065 / PRC-M089: staff payment recording sends the real method, a
 * (partial) amount in minor units, a reference and an idempotency key; sandbox
 * is refused unless explicitly enabled (never in production), and malformed
 * invoice ids never reach the gateway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const recordInvoicePayment = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/fees', () => ({
  recordInvoicePayment: (...args: unknown[]) => recordInvoicePayment(...args),
}));

import { payInvoiceStaffAction } from './actions';

const INVOICE = '11111111-2222-4333-8444-555555555555';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('payInvoiceStaffAction (PRC-M065 / PRC-M089)', () => {
  beforeEach(() => {
    recordInvoicePayment.mockReset();
    recordInvoicePayment.mockResolvedValue({ id: INVOICE });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records a partial cash payment of 500.00 as 50000 minor units', async () => {
    const result = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'cash',
      amount: '500.00',
      reference: ' RB-1042 ',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
    expect(recordInvoicePayment).toHaveBeenCalledWith(INVOICE, {
      method: 'cash',
      amountCents: 50000,
      idempotencyKey: KEY,
      reference: 'RB-1042',
    });
  });

  it('requires a reference for real methods (PRC-M089)', async () => {
    for (const method of ['cash', 'upi', 'card'] as const) {
      const result = await payInvoiceStaffAction({
        invoiceId: INVOICE,
        method,
        amount: '10',
        idempotencyKey: KEY,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fieldErrors?.some((f) => f.field === 'reference')).toBe(true);
      }
    }
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID invoice id without calling the gateway', async () => {
    const result = await payInvoiceStaffAction({
      invoiceId: '../../admin',
      method: 'cash',
      amount: '10',
      reference: 'RB-1',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(false);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it('rejects blank or zero amounts and missing methods', async () => {
    for (const values of [
      { method: 'cash', amount: '' },
      { method: 'cash', amount: '0' },
      { method: '', amount: '10' },
    ]) {
      const result = await payInvoiceStaffAction({
        invoiceId: INVOICE,
        reference: 'RB-1',
        idempotencyKey: KEY,
        ...(values as { method: 'cash'; amount: string }),
      });
      expect(result.success).toBe(false);
    }
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it('refuses the sandbox method unless explicitly enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEES_SANDBOX_PAYMENTS', '');
    vi.stubEnv('FEES_STAFF_SANDBOX_PAYMENTS', '');
    const result = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: '10',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(false);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });

  it('allows sandbox only in a non-production build with the flag on', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEES_SANDBOX_PAYMENTS', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    const result = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: '10',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
  });

  it('allows sandbox with the server-side FEES_STAFF_SANDBOX_PAYMENTS flag (PRC-M089)', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEES_SANDBOX_PAYMENTS', '');
    vi.stubEnv('FEES_STAFF_SANDBOX_PAYMENTS', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    const result = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: '10',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
    expect(recordInvoicePayment).toHaveBeenCalledWith(INVOICE, {
      method: 'sandbox',
      amountCents: 1000,
      idempotencyKey: KEY,
    });
  });

  it('refuses sandbox in production even with either flag on', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEES_SANDBOX_PAYMENTS', 'true');
    vi.stubEnv('FEES_STAFF_SANDBOX_PAYMENTS', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    const result = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'sandbox',
      amount: '10',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(false);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });
});
