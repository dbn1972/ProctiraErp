/**
 * PRC-M484: the parent "Pay" action must fail closed when sandbox payments are
 * not explicitly enabled, and — when enabled — must forward a per-attempt
 * `Idempotency-Key` so a double-submit collapses to a single ledger entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import { payInvoiceAction } from './parent-actions';

const INVOICE = '00000000-0000-4000-8000-0000000000a1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function paymentPayload() {
  return {
    ok: true,
    status: 201,
    data: {
      invoice: { id: INVOICE },
      payment: { id: 'pay-1' },
      receipt: { receiptNumber: 'RC-1' },
    },
  };
}

beforeEach(() => {
  gatewayFetch.mockReset();
  delete process.env.FEES_STAFF_SANDBOX_PAYMENTS;
  delete process.env.NEXT_PUBLIC_FEES_SANDBOX_PAYMENTS;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('payInvoiceAction (PRC-M484)', () => {
  it('fails closed and never calls the gateway when sandbox is not enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = await payInvoiceAction(INVOICE);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/cannot settle payments/i);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('refuses sandbox payment in production even if the flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.FEES_STAFF_SANDBOX_PAYMENTS = 'true';
    const result = await payInvoiceAction(INVOICE);
    expect(result.status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('records a sandbox payment with a v4 Idempotency-Key when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.FEES_STAFF_SANDBOX_PAYMENTS = 'true';
    gatewayFetch.mockResolvedValue(paymentPayload());
    const result = await payInvoiceAction(INVOICE);
    expect(result.status).toBe('success');
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    const [path, init] = gatewayFetch.mock.calls[0] as [
      string,
      { json?: { method?: string }; headers?: Record<string, string> },
    ];
    expect(path).toBe(`/parent-portal/fees/invoices/${INVOICE}/pay`);
    expect(init.json).toEqual({ method: 'sandbox' });
    expect(init.headers?.['Idempotency-Key']).toMatch(UUID_V4);
  });
});
