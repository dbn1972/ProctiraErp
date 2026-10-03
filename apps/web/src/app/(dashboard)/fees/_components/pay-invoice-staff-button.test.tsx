/**
 * @vitest-environment jsdom
 *
 * PRC-M089: staff record payment — method, partial amount, reference and a
 * stable idempotency key; sandbox only when enabled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ recordStaffPaymentAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/lib/fees/actions', () => ({ recordStaffPaymentAction: m.recordStaffPaymentAction }));

import { PayInvoiceStaffButton } from './pay-invoice-staff-button';
import { recordPaymentFormSchema } from '@/lib/fees/validation';

afterEach(cleanup);
const ID = '11111111-1111-4111-8111-111111111111';

describe('PayInvoiceStaffButton (PRC-M089)', () => {
  it('hides sandbox unless enabled and submits method/amount/reference/key', async () => {
    m.recordStaffPaymentAction.mockResolvedValue({ success: false, error: 'Network' });
    render(<PayInvoiceStaffButton invoiceId={ID} amountCents={100_000} />);
    expect(screen.getByTestId('staff-pay-invoice').textContent).toBe('Record payment');
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    expect(screen.queryByLabelText(/Sandbox/)).toBeNull();
    fireEvent.click(screen.getByLabelText('UPI'));
    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: '400.50' } });
    fireEvent.change(screen.getByLabelText(/UPI transaction id/), { target: { value: 'UTR123' } });
    fireEvent.submit(screen.getByTestId('staff-pay-form'));
    await waitFor(() => expect(m.recordStaffPaymentAction).toHaveBeenCalledTimes(1));
    const first = m.recordStaffPaymentAction.mock.calls[0]![0];
    expect(first).toMatchObject({
      invoiceId: ID,
      method: 'upi',
      amount: 400.5,
      reference: 'UTR123',
    });
    // Retry reuses the same idempotency key.
    fireEvent.submit(screen.getByTestId('staff-pay-form'));
    await waitFor(() => expect(m.recordStaffPaymentAction).toHaveBeenCalledTimes(2));
    expect(m.recordStaffPaymentAction.mock.calls[1]![0].idempotencyKey).toBe(first.idempotencyKey);
  });

  it('offers sandbox only when enabled', () => {
    render(<PayInvoiceStaffButton invoiceId={ID} sandboxEnabled />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    expect(screen.getByLabelText(/Sandbox/)).toBeTruthy();
  });

  it('schema requires a reference for cash/UPI', () => {
    const base = { invoiceId: ID, amount: 10, idempotencyKey: ID };
    expect(recordPaymentFormSchema.safeParse({ ...base, method: 'cash' }).success).toBe(false);
    expect(
      recordPaymentFormSchema.safeParse({ ...base, method: 'cash', reference: 'RB-1' }).success,
    ).toBe(true);
    expect(recordPaymentFormSchema.safeParse({ ...base, method: 'sandbox' }).success).toBe(true);
  });
});
