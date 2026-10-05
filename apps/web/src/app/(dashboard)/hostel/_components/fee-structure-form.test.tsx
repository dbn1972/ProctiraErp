/**
 * @vitest-environment jsdom
 *
 * PRC-M095: hostel fee amounts are entered in rupees; blank is rejected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ createHostelFeeStructureAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('../../campus-ops-actions', () => ({
  createHostelFeeStructureAction: m.createHostelFeeStructureAction,
}));

import { HostelFeeStructureForm } from './fee-structure-form';

afterEach(cleanup);
const hostels = [{ id: '11111111-1111-4111-8111-111111111111', name: 'North', code: 'N' }] as never;

describe('HostelFeeStructureForm (PRC-M095)', () => {
  it('blocks a blank amount and sends rupees as typed', async () => {
    m.createHostelFeeStructureAction.mockResolvedValue({ status: 'success', message: 'Saved.' });
    render(<HostelFeeStructureForm hostels={hostels} />);
    expect(screen.getByLabelText(/Amount \(₹\)/)).toBeTruthy();
    fireEvent.submit(screen.getByTestId('hostel-fee-form'));
    expect(screen.getByRole('alert').textContent).toMatch(/greater than 0/);
    expect(m.createHostelFeeStructureAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: '5000.00' } });
    fireEvent.submit(screen.getByTestId('hostel-fee-form'));
    await waitFor(() =>
      expect(m.createHostelFeeStructureAction).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '5000.00' }),
      ),
    );
  });
});
