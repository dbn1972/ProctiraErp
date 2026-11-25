/**
 * @vitest-environment jsdom
 *
 * PRC-M090: the refund dialog targets one payment of the invoice. It lists the
 * invoice's refundable payments and sends the chosen paymentId; the action refuses
 * a refund without a paymentId before calling the gateway.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const refundInvoiceAction = vi.fn(async (_values: unknown) => ({
  success: true as const,
  data: { id: 'r-1' },
}));
const listRefundablePaymentsAction = vi.fn(async (_invoiceId: string) => ({
  success: true as const,
  data: [
    {
      paymentId: '22222222-2222-4222-8222-222222222222',
      method: 'cash',
      amountCents: 6_000,
      refundedCents: 6_000,
      refundableCents: 0,
      paidAt: '2026-09-01T10:00:00.000Z',
    },
    {
      paymentId: '33333333-3333-4333-8333-333333333333',
      method: 'upi',
      amountCents: 4_000,
      refundedCents: 1_000,
      refundableCents: 3_000,
      paidAt: '2026-09-02T10:00:00.000Z',
    },
  ],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/lib/fees/actions', () => ({
  refundInvoiceAction: (values: unknown) => refundInvoiceAction(values),
  listRefundablePaymentsAction: (invoiceId: string) => listRefundablePaymentsAction(invoiceId),
}));
vi.mock('@/components/shared/confirm-action-dialog', () => ({
  ConfirmActionDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" data-testid="refund-confirm-confirm" onClick={onConfirm}>
        confirm
      </button>
    ) : null,
}));

import { RefundDialog } from './refund-dialog';

afterEach(() => {
  cleanup();
  refundInvoiceAction.mockClear();
  listRefundablePaymentsAction.mockClear();
});

const INVOICE = '11111111-1111-4111-8111-111111111111';

describe('refund dialog targets a payment (PRC-M090)', () => {
  it('loads the invoice payments, offers only refundable ones and sends the chosen paymentId', async () => {
    render(<RefundDialog invoiceId={INVOICE} amountCents={10_000} />);
    fireEvent.click(screen.getByTestId('open-refund'));
    await waitFor(() => expect(listRefundablePaymentsAction).toHaveBeenCalledWith(INVOICE));
    const select = (await screen.findByLabelText(/^Payment/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('33333333-3333-4333-8333-333333333333'));
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '33333333-3333-4333-8333-333333333333',
    ]);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '25.00' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'overcharge' } });
    fireEvent.submit(screen.getByTestId('refund-form'));
    fireEvent.click(await screen.findByTestId('refund-confirm-confirm'));
    await waitFor(() => expect(refundInvoiceAction).toHaveBeenCalledTimes(1));
    expect(refundInvoiceAction.mock.calls[0]![0]).toMatchObject({
      invoiceId: INVOICE,
      paymentId: '33333333-3333-4333-8333-333333333333',
      amount: 25,
      reason: 'overcharge',
    });
  });
});

describe('refundInvoiceAction requires a paymentId (PRC-M090)', () => {
  it('rejects a refund without paymentId before calling the gateway', async () => {
    const actual =
      await vi.importActual<typeof import('@/lib/fees/validation')>('@/lib/fees/validation');
    const parsed = actual.refundFormSchema.safeParse({
      invoiceId: INVOICE,
      amount: 1,
      reason: 'x',
    });
    expect(parsed.success).toBe(false);
    expect(
      actual.refundFormSchema.safeParse({
        invoiceId: INVOICE,
        paymentId: '33333333-3333-4333-8333-333333333333',
        amount: 1,
        reason: 'x',
      }).success,
    ).toBe(true);
  });
});
