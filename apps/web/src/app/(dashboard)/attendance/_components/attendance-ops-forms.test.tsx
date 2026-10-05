/**
 * @vitest-environment jsdom
 *
 * PRC-M077: approve/reject is confirmed, forwards a decision note and shows a
 * role=alert message when the decision fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

const decideRegularisationAction = vi.fn();
const decideLeaveAction = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../actions', () => ({
  createLeaveRequestAction: vi.fn(),
  createRegularisationAction: vi.fn(),
  decideLeaveAction: (...args: unknown[]) => decideLeaveAction(...args),
  decideRegularisationAction: (...args: unknown[]) => decideRegularisationAction(...args),
}));

import { AttendanceOpsForms } from './attendance-ops-forms';

const regularisation = {
  id: 'reg-1',
  studentId: 's-1',
  fromStatus: 'ABSENT',
  toStatus: 'PRESENT',
  status: 'requested',
  attendanceDate: '2026-01-05',
};

function renderForms() {
  return render(<AttendanceOpsForms regularisations={[regularisation]} leaves={[]} />);
}

describe('AttendanceOpsForms decisions (PRC-M077)', () => {
  beforeEach(() => {
    decideRegularisationAction.mockReset();
    decideLeaveAction.mockReset();
    refresh.mockReset();
  });

  it('confirms and forwards the decision note', async () => {
    decideRegularisationAction.mockResolvedValue({ status: 'success', data: { id: 'reg-1' } });
    renderForms();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decideRegularisationAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/decision note/i), {
      target: { value: 'Medical certificate seen' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    });
    expect(decideRegularisationAction).toHaveBeenCalledWith(
      'reg-1',
      'approve',
      'Medical certificate seen',
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a role=alert message when the decision fails', async () => {
    decideRegularisationAction.mockResolvedValue({ status: 'error', message: 'Already decided' });
    renderForms();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('Already decided');
    expect(refresh).not.toHaveBeenCalled();
  });
});
