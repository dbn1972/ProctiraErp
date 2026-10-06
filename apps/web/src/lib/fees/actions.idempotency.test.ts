/**
 * PRC-H058: staff money actions (refund, concession, scholarship netting, staff pay)
 * forward a per-submission `Idempotency-Key` header so the gateway idempotency
 * plugin executes a double-submitted / retried mutation at most once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import {
  applyConcessionAction,
  applyScholarshipNettingAction,
  payInvoiceStaffAction,
  refundInvoiceAction,
} from './actions';

const KEY = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const INVOICE = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000b1';
const STRUCTURE = '00000000-0000-4000-8000-0000000000c1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headerOf(call: unknown[]): string | undefined {
  const init = call[1] as { headers?: Record<string, string> };
  return init.headers?.['Idempotency-Key'];
}

beforeEach(() => {
  gatewayFetch.mockReset();
});

describe('fees money actions send Idempotency-Key (PRC-H058)', () => {
  it('refund forwards the client key', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 201, data: { id: 'r1', amountCents: 100 } });
    const result = await refundInvoiceAction({
      invoiceId: INVOICE,
      amount: 1,
      reason: 'duplicate charge',
      idempotencyKey: KEY,
    });
    expect(result.success).toBe(true);
    expect(gatewayFetch.mock.calls[0]![0]).toBe(`/fees/invoices/${INVOICE}/refund`);
    expect(headerOf(gatewayFetch.mock.calls[0]!)).toBe(KEY);
  });

  it('refund mints a v4 key when the caller sends none', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 201, data: { id: 'r1', amountCents: 100 } });
    await refundInvoiceAction({ invoiceId: INVOICE, amount: 1, reason: 'x' });
    expect(headerOf(gatewayFetch.mock.calls[0]!)).toMatch(UUID_V4);
  });

  it('rejects a malformed key without calling the gateway', async () => {
    const result = await refundInvoiceAction({
      invoiceId: INVOICE,
      amount: 1,
      reason: 'x',
      idempotencyKey: 'not-a-key',
    });
    expect(result.success).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
    const pay = await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'cash',
      amount: '10',
      idempotencyKey: 'not-a-key',
    });
    expect(pay.success).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('concession forwards the client key', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 201,
      data: { discountCents: 10, invoice: null },
    });
    await applyConcessionAction({
      studentId: STUDENT,
      structureId: STRUCTURE,
      invoiceId: INVOICE,
      kind: 'percent',
      percent: 10,
      reason: 'sibling',
      idempotencyKey: KEY,
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/concessions');
    expect(headerOf(gatewayFetch.mock.calls[0]!)).toBe(KEY);
  });

  it('scholarship netting forwards the client key', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: {} });
    await applyScholarshipNettingAction({
      studentId: STUDENT,
      disbursementId: 'disb-1',
      invoiceId: '',
      idempotencyKey: KEY,
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/fees/scholarships/net');
    expect(headerOf(gatewayFetch.mock.calls[0]!)).toBe(KEY);
  });

  it('staff pay forwards the client key', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 201, data: { invoice: { id: INVOICE } } });
    await payInvoiceStaffAction({
      invoiceId: INVOICE,
      method: 'cash',
      amount: '10',
      reference: 'RB-0042',
      idempotencyKey: KEY,
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe(`/fees/invoices/${INVOICE}/pay`);
    expect(headerOf(gatewayFetch.mock.calls[0]!)).toBe(KEY);
    // PRC-M065: the same key is also carried in the body for the fees service.
    expect((gatewayFetch.mock.calls[0]![1] as { json: unknown }).json).toEqual({
      method: 'cash',
      amountCents: 1000,
      idempotencyKey: KEY,
      reference: 'RB-0042',
    });
  });
});
