/**
 * @vitest-environment jsdom
 *
 * PRC-M077: approve/reject is confirmed, forwards a decision note and shows a
 * role=alert message when the decision fails.
 *
 * PRC-M081: regularisation requests never ask for a pasted attendance-record
 * UUID or a free-text "from status", and the request lists name the student
 * and class.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

const decideRegularisationAction = vi.fn();
const decideLeaveAction = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../actions', () => ({
  createLeaveRequestAction: vi.fn(),
  createRegularisationAction: vi.fn(),
  decideLeaveAction: (...args: unknown[]) => decideLeaveAction(...args),
  decideRegularisationAction: (...args: unknown[]) => decideRegularisationAction(...args),
}));

import { AttendanceOpsForms } from './attendance-ops-forms';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';

afterEach(cleanup);

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

describe('AttendanceOpsForms (PRC-M081)', () => {
  it('has no record-id or from-status inputs', () => {
    render(<AttendanceOpsForms regularisations={[]} leaves={[]} />);
    expect(screen.queryByLabelText(/attendance record id/i)).toBeNull();
    expect(screen.queryByLabelText(/from status/i)).toBeNull();
  });

  it('lists requests with student and class names', () => {
    render(
      <AttendanceOpsForms
        regularisations={[
          {
            id: 'r1',
            studentId: STUDENT,
            classId: CLASS,
            fromStatus: 'ABSENT',
            toStatus: 'PRESENT',
            status: 'approved',
            attendanceDate: '2024-06-10',
          },
        ]}
        leaves={[
          {
            id: 'l1',
            studentId: 'unknown-id',
            fromDate: '2024-06-11',
            toDate: '2024-06-12',
            status: 'approved',
            reason: null,
          },
        ]}
        studentOptions={[{ id: STUDENT, label: 'Asha Rao' }]}
        classOptions={[{ id: CLASS, label: 'NHS · 10A' }]}
      />,
    );
    const regList = screen.getByTestId('regularisation-list');
    expect(regList.textContent).toContain('Asha Rao');
    expect(regList.textContent).toContain('NHS · 10A');
    expect(document.body.textContent).toContain('Unknown student');
    expect(document.body.textContent).not.toContain('unknown-id');
  });
});
