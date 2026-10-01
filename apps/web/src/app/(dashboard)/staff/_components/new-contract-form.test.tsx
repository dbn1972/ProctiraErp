/**
 * PRC-L050 — contract form validates with the shared zod schema (any RFC UUID,
 * end >= start), captures notes, and does not promise an uncaptured status.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractFormSchema } from '@/lib/validation/staff-schema';

const createContractAction = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/shared/entity-search-select', () => ({
  EntitySearchSelect: ({ name, id }: { name: string; id: string }) => (
    <input id={id} name={name} data-testid="staff-select" />
  ),
}));
vi.mock('../hr-actions', () => ({
  createContractAction: (...a: unknown[]) => createContractAction(...a),
}));

import { NewContractForm } from './new-contract-form';

// UUIDv7 — rejected by the old v4-only regex.
const STAFF_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

function fill(start: string, end: string) {
  fireEvent.change(screen.getByTestId('staff-select'), { target: { value: STAFF_ID } });
  fireEvent.change(screen.getByLabelText(/Start/), { target: { value: start } });
  fireEvent.change(screen.getByLabelText(/^End/), { target: { value: end } });
}

describe('NewContractForm (PRC-L050)', () => {
  beforeEach(() => createContractAction.mockReset());

  it('shows a field error when end date is before start date', async () => {
    render(<NewContractForm staffOptions={[{ id: STAFF_ID, label: 'Asha Rao' }]} />);
    fill('2026-06-01', '2026-05-01');
    fireEvent.submit(screen.getByTestId('staff-contract-form'));
    await waitFor(() =>
      expect(screen.getByText('End date must be on or after start date')).toBeTruthy(),
    );
    expect(screen.getByLabelText(/^End/).getAttribute('aria-invalid')).toBe('true');
    expect(createContractAction).not.toHaveBeenCalled();
  });

  it('accepts a non-v4 UUID and submits notes', async () => {
    createContractAction.mockResolvedValue({ status: 'success', message: 'Contract recorded.' });
    render(<NewContractForm staffOptions={[{ id: STAFF_ID, label: 'Asha Rao' }]} />);
    fill('2026-06-01', '2027-05-31');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Science dept' } });
    fireEvent.submit(screen.getByTestId('staff-contract-form'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Contract recorded.'));
    expect(createContractAction.mock.calls[0][0]).toMatchObject({
      staffId: STAFF_ID,
      notes: 'Science dept',
      endDate: '2027-05-31',
    });
    expect(document.body.textContent).not.toMatch(/salary band, and status/);
  });

  it('server schema rejects end < start too', () => {
    const r = contractFormSchema.safeParse({
      staffId: STAFF_ID,
      contractType: 'permanent',
      startDate: '2026-06-01',
      endDate: '2026-05-01',
    });
    expect(r.success).toBe(false);
  });
});
