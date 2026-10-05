/**
 * PRC-M573: circulation desk form branches (barcode vs catalog item, return,
 * renew) and the due date reaching barcode checkouts.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = {
  checkoutLibraryItemAction: vi.fn(),
  returnLibraryLoanAction: vi.fn(),
  renewLibraryLoanAction: vi.fn(),
  checkoutBarcodeAction: vi.fn(),
  returnBarcodeAction: vi.fn(),
};
vi.mock('../../campus-actions', () => ({
  checkoutLibraryItemAction: (...a: unknown[]) => actions.checkoutLibraryItemAction(...a),
  returnLibraryLoanAction: (...a: unknown[]) => actions.returnLibraryLoanAction(...a),
  renewLibraryLoanAction: (...a: unknown[]) => actions.renewLibraryLoanAction(...a),
}));
vi.mock('../../campus-ops-actions', () => ({
  checkoutBarcodeAction: (...a: unknown[]) => actions.checkoutBarcodeAction(...a),
  returnBarcodeAction: (...a: unknown[]) => actions.returnBarcodeAction(...a),
}));
import { CirculationDesk } from './circulation-desk';
const items = [{ id: 'item-1', title: 'Atlas', available: 2, copies: 2 }] as unknown as Parameters<
  typeof CirculationDesk
>[0]['items'];
beforeEach(() => {
  for (const fn of Object.values(actions)) {
    fn.mockReset();
    fn.mockResolvedValue({ status: 'success', id: 'loan-1' });
  }
});
function renderDesk() {
  render(<CirculationDesk items={items} patronUserId="patron-1" />);
}
describe('CirculationDesk', () => {
  it('barcode checkout sends the due date (not dropped)', async () => {
    renderDesk();
    fireEvent.change(screen.getByTestId('library-checkout-barcode'), {
      target: { value: 'BC-1' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-02-01' } });
    fireEvent.submit(screen.getByTestId('library-checkout-form'));
    await waitFor(() => expect(actions.checkoutBarcodeAction).toHaveBeenCalledTimes(1));
    expect(actions.checkoutBarcodeAction.mock.calls[0]![0]).toMatchObject({
      barcode: 'BC-1',
      patronUserId: 'patron-1',
      dueAt: '2026-02-01',
    });
    expect(actions.checkoutLibraryItemAction).not.toHaveBeenCalled();
  });
  it('catalog checkout uses the item action with the due date', async () => {
    renderDesk();
    fireEvent.change(screen.getByLabelText('Catalog item'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-02-01' } });
    fireEvent.submit(screen.getByTestId('library-checkout-form'));
    await waitFor(() => expect(actions.checkoutLibraryItemAction).toHaveBeenCalledTimes(1));
    expect(actions.checkoutLibraryItemAction.mock.calls[0]![0]).toMatchObject({
      itemId: 'item-1',
      dueAt: '2026-02-01',
    });
  });
  it('requires an item or barcode before calling any action', () => {
    renderDesk();
    fireEvent.submit(screen.getByTestId('library-checkout-form'));
    expect(screen.getByRole('alert')).toHaveTextContent('Select a catalog item or scan a barcode.');
    expect(actions.checkoutBarcodeAction).not.toHaveBeenCalled();
    expect(actions.checkoutLibraryItemAction).not.toHaveBeenCalled();
  });
  it('return by barcode vs loan id, and renew by 14 days', async () => {
    renderDesk();
    fireEvent.change(screen.getByTestId('library-return-barcode'), { target: { value: 'BC-9' } });
    fireEvent.submit(screen.getByTestId('library-return-form'));
    await waitFor(() => expect(actions.returnBarcodeAction).toHaveBeenCalledWith('BC-9'));
    expect(actions.returnLibraryLoanAction).not.toHaveBeenCalled();
    const renewForm = screen.getByTestId('library-renew-form');
    fireEvent.change(renewForm.querySelector('input[name="loanId"]')!, {
      target: { value: 'loan-7' },
    });
    fireEvent.submit(renewForm);
    await waitFor(() => expect(actions.renewLibraryLoanAction).toHaveBeenCalledWith('loan-7', 14));
  });
});
