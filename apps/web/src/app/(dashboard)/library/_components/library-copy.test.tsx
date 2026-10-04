/**
 * PRC-L046 — library UI shows user copy (no API route strings), labels the
 * clearance check as advisory, and announces new-item success via role=status.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CirculationDesk } from './circulation-desk';
import { LibraryClearanceForm } from './clearance-form';
import { NewLibraryItemForm } from './new-item-form';

const createLibraryItemAction = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/library',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../campus-actions', () => ({
  createLibraryItemAction: (...args: unknown[]) => createLibraryItemAction(...args),
  checkLibraryClearanceAction: vi.fn(),
  checkoutLibraryItemAction: vi.fn(),
  renewLibraryLoanAction: vi.fn(),
  returnLibraryLoanAction: vi.fn(),
}));
vi.mock('../../campus-ops-actions', () => ({
  lookupIsbnFillAction: vi.fn(),
  checkoutBarcodeAction: vi.fn(),
  returnBarcodeAction: vi.fn(),
}));

describe('library copy (PRC-L046)', () => {
  it('circulation desk and clearance form contain no API route strings', () => {
    const { container } = render(
      <>
        <CirculationDesk items={[]} patronUserId="u1" />
        <LibraryClearanceForm />
      </>,
    );
    expect(container.textContent).not.toMatch(/\/library\/|POST|hook/);
    expect(screen.getByText(/Advisory check before a transfer/)).toBeTruthy();
  });

  it('announces success after creating a catalog item', async () => {
    createLibraryItemAction.mockResolvedValue({ status: 'success', id: 'i1' });
    render(<NewLibraryItemForm />);
    fireEvent.change(screen.getByTestId('library-title-input'), {
      target: { value: 'Wings of Fire' },
    });
    fireEvent.submit(screen.getByTestId('library-item-form'));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Added “Wings of Fire”'),
    );
    expect((screen.getByTestId('library-title-input') as HTMLInputElement).value).toBe('');
  });
});
