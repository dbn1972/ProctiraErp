import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scholarship-browser', () => ({
  BrowserGatewayError: class BrowserGatewayError extends Error {},
  scholarshipBrowserFetch: vi.fn(),
}));

import { scholarshipBrowserFetch } from '../scholarship-browser';

import ScholarshipDisbursementSchedule from './ScholarshipDisbursementSchedule';

const ID = 'd1';
const row = {
  id: ID,
  tenantId: 't',
  applicationId: 'a',
  amount: 100,
  scheduledDate: '2025-01-01',
  paidDate: null,
  paymentStatus: 'processing',
  paymentMethod: null,
  transactionReference: null,
  notes: null,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
};

describe('ScholarshipDisbursementSchedule mark paid (PRC-H085)', () => {
  beforeEach(() => {
    vi.mocked(scholarshipBrowserFetch).mockReset();
    vi.mocked(scholarshipBrowserFetch).mockImplementation(async (_path, init) => {
      if (init?.method === 'PUT') return {} as never;
      return { data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } as never;
    });
  });
  afterEach(cleanup);

  it('requires a transaction reference and sends it with paidDate', async () => {
    render(<ScholarshipDisbursementSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: `Mark disbursement ${ID} as paid` }));

    const ref = screen.getByLabelText(/Transaction reference/);
    expect(ref).toHaveProperty('required', true);
    const date = screen.getByLabelText('Paid date') as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enter the bank or payment transaction reference.',
    );
    expect(
      vi.mocked(scholarshipBrowserFetch).mock.calls.some(([, init]) => init?.method === 'PUT'),
    ).toBe(false);

    fireEvent.change(ref, { target: { value: 'UTR-42' } });
    fireEvent.change(date, { target: { value: '2025-02-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));

    await waitFor(() =>
      expect(scholarshipBrowserFetch).toHaveBeenCalledWith(`/scholarships/disbursements/${ID}`, {
        method: 'PUT',
        json: { paymentStatus: 'paid', transactionReference: 'UTR-42', paidDate: '2025-02-03' },
      }),
    );
  });
});
