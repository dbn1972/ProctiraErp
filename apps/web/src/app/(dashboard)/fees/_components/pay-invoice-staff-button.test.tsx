/**
 * @vitest-environment jsdom
 *
 * PRC-M065: staff payment control records real methods; no sandbox option
 * unless explicitly enabled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const payInvoiceStaffAction = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/lib/fees/actions', () => ({
  payInvoiceStaffAction: (...args: unknown[]) => payInvoiceStaffAction(...args),
}));

import { PayInvoiceStaffButton } from './pay-invoice-staff-button';

const INVOICE = '11111111-2222-4333-8444-555555555555';

describe('PayInvoiceStaffButton (PRC-M065)', () => {
  beforeEach(() => {
    payInvoiceStaffAction.mockReset();
    payInvoiceStaffAction.mockResolvedValue({ success: true, data: { id: INVOICE } });
  });

  it('does not label or offer sandbox payments by default', () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    expect(screen.getByTestId('staff-pay-invoice').textContent).not.toMatch(/sandbox/i);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    const values = Array.from(
      (screen.getByTestId('staff-pay-method') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(values).toEqual(['', 'cash', 'upi', 'card']);
  });

  it('submits the chosen method, amount and an idempotency key', async () => {
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'cash' } });
    fireEvent.change(screen.getByLabelText('Amount received (INR)'), {
      target: { value: '500.00' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(payInvoiceStaffAction).toHaveBeenCalledWith({
      invoiceId: INVOICE,
      method: 'cash',
      amount: '500.00',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('shows field errors returned by the action', async () => {
    payInvoiceStaffAction.mockResolvedValue({
      success: false,
      error: 'Validation failed',
      fieldErrors: [{ field: 'amount', message: 'Amount is required' }],
    });
    render(<PayInvoiceStaffButton invoiceId={INVOICE} />);
    fireEvent.click(screen.getByTestId('staff-pay-invoice'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('staff-pay-confirm-confirm'));
    });
    expect(screen.getByRole('alert').textContent).toBe('Validation failed');
    expect(screen.getByText('Amount is required')).toBeTruthy();
  });
});
