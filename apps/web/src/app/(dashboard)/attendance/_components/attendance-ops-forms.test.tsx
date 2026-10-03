/**
 * @vitest-environment jsdom
 *
 * PRC-M081: regularisation requests never ask for a pasted attendance-record
 * UUID or a free-text "from status", and the request lists name the student
 * and class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../actions', () => ({
  createLeaveRequestAction: vi.fn(),
  createRegularisationAction: vi.fn(),
  decideLeaveAction: vi.fn(),
  decideRegularisationAction: vi.fn(),
}));

import { AttendanceOpsForms } from './attendance-ops-forms';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';

afterEach(cleanup);

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
