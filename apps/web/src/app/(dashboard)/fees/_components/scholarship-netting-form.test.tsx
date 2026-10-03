/**
 * @vitest-environment jsdom
 *
 * PRC-H020 — netting uses a picker of verified paid disbursements; no free-text id and
 * no operator-typed amount reach POST /fees/scholarships/net.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const applyMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/fees/actions', () => ({
  applyScholarshipNettingAction: (values: unknown) => applyMock(values),
}));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
// PRC-L040: amounts are formatted with the viewer locale from next-intl.
vi.mock('next-intl', () => ({ useLocale: () => 'en-IN' }));

import { formatAmount } from './format-amount';
import { ScholarshipNettingForm } from './scholarship-netting-form';

const STUDENT = '00000000-0000-4000-8000-000000000099';

afterEach(() => {
  cleanup();
  applyMock.mockReset();
});

describe('ScholarshipNettingForm (PRC-H020)', () => {
  it('has no free-text disbursement id or amount input', () => {
    render(<ScholarshipNettingForm />);
    expect(screen.queryByPlaceholderText(/Paid disbursement id/i)).toBeNull();
    expect(screen.queryByLabelText(/Amount/i)).toBeNull();
  });

  it('shows an alert when paid disbursements could not be loaded', () => {
    render(<ScholarshipNettingForm disbursementsFailed />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i);
    expect((screen.getByTestId('submit-scholarship-netting') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('submits the picked disbursement with its student and no amount', async () => {
    applyMock.mockResolvedValue({ success: false, error: 'stop' });
    render(
      <ScholarshipNettingForm
        studentOptions={[{ id: STUDENT, label: 'STU-1 · Asha' }]}
        disbursements={[
          {
            id: 'disb-paid',
            tenantId: 't',
            studentId: STUDENT,
            amountCents: 2500,
            paymentStatus: 'paid',
            currency: 'INR',
          },
        ]}
      />,
    );
    const select = screen.getByLabelText('Paid disbursement') as HTMLSelectElement;
    expect(select.textContent).toContain(`STU-1 · Asha · ${formatAmount(2500, 'INR', 'en-IN')}`);
    fireEvent.change(select, { target: { value: 'disb-paid' } });
    fireEvent.submit(screen.getByTestId('scholarship-netting-form'));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply credit' }));
    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    const sent = applyMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toEqual({
      studentId: STUDENT,
      disbursementId: 'disb-paid',
      invoiceId: '',
      currency: 'INR',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(sent).not.toHaveProperty('amount');
  });
});
