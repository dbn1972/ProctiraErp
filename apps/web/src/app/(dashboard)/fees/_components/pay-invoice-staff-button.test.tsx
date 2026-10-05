/**
 * @vitest-environment jsdom
 *
 * PRC-M065 / PRC-M089: staff payment control records real methods with a
 * (partial) amount, a reference and a stable idempotency key; no sandbox
 * option unless the server enables it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const payInvoiceStaffAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/lib/fees/actions', () => ({
  payInvoiceStaffAction: (...args: unknown[]) => payInvoiceStaffAction(...args),
}));

import { PayInvoiceStaffButton } from './pay-invoice-staff-button';
import { staffPaymentFormSchema } from '@/lib/fees/validation';

const INVOICE = '11111111-2222-4333-8444-555555555555';

afterEach(cleanup);

describe('PayInvoiceStaffButton (PRC-M065 / PRC-M089)', () => {
  beforeEach(() => {
    payInvoiceStaffAction.mockReset();
    payInvoiceStaffAction.mockResolvedValue({ success: true, data: { id: INVOICE } });
  });

  it('does not label or offer sandbox payments by default', () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    expect(screen.getByTestId('staff-pay-invoice').textContent).toBe('Record payment');
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    const values = Array.from(
      (screen.getByTestId('staff-pay-method') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(values).toEqual(['', 'cash', 'upi', 'card']);
  });

  it('offers sandbox only when the server enables it', () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} sandboxEnabled />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    const values = Array.from(
      (screen.getByTestId('staff-pay-method') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(values).toContain('sandbox');
  });

  it('starts with a blank amount instead of prefilling the invoice face amount', () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    expect((screen.getByTestId('staff-pay-amount') as HTMLInputElement).value).toBe('');
  });

  it('submits the chosen method, amount, reference and an idempotency key', async () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'cash' } });
    fireEvent.change(screen.getByLabelText('Amount received (INR)'), {
      target: { value: '500.00' },
    });
    fireEvent.change(screen.getByLabelText('Receipt book number'), {
      target: { value: 'RB-1042' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(payInvoiceStaffAction).toHaveBeenCalledWith({
      invoiceId: INVOICE,
      method: 'cash',
      amount: '500.00',
      reference: 'RB-1042',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('labels the reference for UPI and reuses the idempotency key on retry', async () => {
    payInvoiceStaffAction.mockResolvedValue({ success: false, error: 'Network' });
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText('Amount received (INR)'), {
      target: { value: '400.50' },
    });
    fireEvent.change(screen.getByLabelText('UPI transaction id'), {
      target: { value: 'UTR123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(payInvoiceStaffAction).toHaveBeenCalledTimes(1);
    const first = payInvoiceStaffAction.mock.calls[0]![0];
    expect(first).toMatchObject({
      invoiceId: INVOICE,
      method: 'upi',
      amount: '400.50',
      reference: 'UTR123',
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(payInvoiceStaffAction).toHaveBeenCalledTimes(2);
    expect(payInvoiceStaffAction.mock.calls[1]![0].idempotencyKey).toBe(first.idempotencyKey);
  });

  it('shows field errors returned by the action', async () => {
    payInvoiceStaffAction.mockResolvedValue({
      success: false,
      error: 'Validation failed',
      fieldErrors: [
        { field: 'amount', message: 'Amount is required' },
        { field: 'reference', message: 'Reference is required' },
      ],
    });
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(screen.getByRole('alert').textContent).toBe('Validation failed');
    expect(screen.getByText('Amount is required')).toBeTruthy();
    expect(screen.getByText('Reference is required')).toBeTruthy();
  });

  it('schema requires a reference for cash/UPI/card but not sandbox', () => {
    const base = { invoiceId: INVOICE, amount: 10, idempotencyKey: INVOICE };
    for (const method of ['cash', 'upi', 'card'] as const) {
      expect(staffPaymentFormSchema.safeParse({ ...base, method }).success).toBe(false);
      expect(staffPaymentFormSchema.safeParse({ ...base, method, reference: '  ' }).success).toBe(
        false,
      );
      expect(staffPaymentFormSchema.safeParse({ ...base, method, reference: 'RB-1' }).success).toBe(
        true,
      );
    }
    expect(staffPaymentFormSchema.safeParse({ ...base, method: 'sandbox' }).success).toBe(true);
  });
});
