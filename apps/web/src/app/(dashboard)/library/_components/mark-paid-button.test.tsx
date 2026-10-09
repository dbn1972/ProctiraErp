import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MarkPaidButton } from './mark-paid-button';

const markFinePaidAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../../campus-ops-actions', () => ({
  markFinePaidAction: (...args: unknown[]) => markFinePaidAction(...args),
}));

const FINE_ID = '11111111-1111-4111-8111-111111111111';

describe('MarkPaidButton (PRC-H025)', () => {
  beforeEach(() => {
    markFinePaidAction.mockReset();
    refresh.mockReset();
  });

  it('opens a labelled confirm dialog with payment method + reference inputs', async () => {
    render(<MarkPaidButton fineId={FINE_ID} />);
    fireEvent.click(screen.getByTestId(`mark-paid-${FINE_ID}`));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Labelled inputs (accessible-name resolution via <Label htmlFor>).
    expect(screen.getByLabelText('Payment method')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt / transaction reference')).toBeInTheDocument();
  });

  it('disables confirm until a reference is entered', async () => {
    render(<MarkPaidButton fineId={FINE_ID} />);
    fireEvent.click(screen.getByTestId(`mark-paid-${FINE_ID}`));
    await screen.findByRole('dialog');

    const confirm = screen.getByTestId(`confirm-mark-paid-${FINE_ID}`);
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Receipt / transaction reference'), {
      target: { value: 'RCPT-100' },
    });
    expect(confirm).toBeEnabled();
  });

  it('passes the chosen payment method + reference to the action (not a synthetic reference)', async () => {
    markFinePaidAction.mockResolvedValue({
      status: 'success',
      id: FINE_ID,
      message: 'Fine marked paid.',
    });
    render(<MarkPaidButton fineId={FINE_ID} />);
    fireEvent.click(screen.getByTestId(`mark-paid-${FINE_ID}`));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText('Receipt / transaction reference'), {
      target: { value: '  TXN-7788  ' },
    });
    fireEvent.click(screen.getByTestId(`confirm-mark-paid-${FINE_ID}`));

    await waitFor(() => expect(markFinePaidAction).toHaveBeenCalledTimes(1));
    expect(markFinePaidAction).toHaveBeenCalledWith(FINE_ID, {
      paymentMethod: 'upi',
      reference: 'TXN-7788', // trimmed, real reference
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows an error and keeps the dialog open when the action fails', async () => {
    markFinePaidAction.mockResolvedValue({ status: 'error', message: 'Mark paid failed' });
    render(<MarkPaidButton fineId={FINE_ID} />);
    fireEvent.click(screen.getByTestId(`mark-paid-${FINE_ID}`));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Receipt / transaction reference'), {
      target: { value: 'RCPT-1' },
    });
    fireEvent.click(screen.getByTestId(`confirm-mark-paid-${FINE_ID}`));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mark paid failed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
