import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatMoney } from '@/lib/format-money';
import LibraryFinesPage from './page';

vi.mock('@/lib/auth/server', () => ({ requireSession: vi.fn(async () => ({})) }));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelMap: vi.fn(async () => ({})),
}));
vi.mock('../_components/mark-paid-button', () => ({ MarkPaidButton: () => null }));
vi.mock('@/lib/api/library', () => ({
  listLibraryFines: vi.fn(async () => [
    {
      id: 'f1',
      loanId: 'l1',
      studentId: 's1',
      amountCents: 5000,
      currency: 'INR',
      overdueDays: 5,
      status: 'assessed',
      invoiceId: null,
    },
  ]),
}));

describe('formatMoney', () => {
  it('formats cents as currency', () => {
    expect(formatMoney(5000, 'INR')).toBe('₹50.00');
    expect(formatMoney(1234, 'USD')).toContain('12.34');
  });
});

describe('LibraryFinesPage (PRC-L043)', () => {
  it('renders 5000 cents as ₹50.00 instead of raw cents', async () => {
    render(await LibraryFinesPage());
    const row = screen.getByTestId('library-fine-row');
    expect(row.textContent).toContain('₹50.00');
    expect(row.textContent).not.toContain('cents');
  });
});
