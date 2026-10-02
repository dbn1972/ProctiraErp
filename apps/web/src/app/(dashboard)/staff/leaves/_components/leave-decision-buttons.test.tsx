/**
 * PRC-L056 — leave decisions carry staff/date context; transcript issue needs confirm.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const decideStaffLeaveAction = vi.fn();
const issueTranscriptAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../staff-leave-actions', () => ({
  decideStaffLeaveAction: (...a: unknown[]) => decideStaffLeaveAction(...a),
}));
vi.mock('@/app/(dashboard)/gradebook-actions', () => ({
  issueTranscriptAction: (...a: unknown[]) => issueTranscriptAction(...a),
}));

import { StaffLeaveDecisionButtons } from './leave-decision-buttons';
import { inclusiveLeaveDays } from './leave-days';
import { IssueTranscriptByName } from '../../../students/_components/issue-transcript-by-name';

beforeEach(() => {
  decideStaffLeaveAction.mockReset();
  issueTranscriptAction.mockReset();
});

describe('StaffLeaveDecisionButtons (PRC-L056)', () => {
  it('gives each row unique accessible names with staff and dates', () => {
    render(
      <>
        <StaffLeaveDecisionButtons
          leaveId="l1"
          status="pending"
          staffName="Asha Rao"
          leaveType="casual"
          startDate="2025-04-01"
          endDate="2025-04-03"
        />
        <StaffLeaveDecisionButtons
          leaveId="l2"
          status="pending"
          staffName="Ravi Kumar"
          leaveType="sick"
          startDate="2025-04-05"
          endDate="2025-04-05"
        />
      </>,
    );
    const approves = screen.getAllByRole('button', { name: /^Approve leave for/ });
    const names = approves.map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe('Approve leave for Asha Rao, 2025-04-01 to 2025-04-03');
    fireEvent.click(screen.getByRole('button', { name: /Reject leave for Ravi Kumar/ }));
    expect(screen.getByText(/Ravi Kumar, sick, 2025-04-05 to 2025-04-05 \(1 day\)/)).toBeVisible();
  });

  it('counts inclusive days', () => {
    expect(inclusiveLeaveDays('2025-04-01', '2025-04-03')).toBe(3);
    expect(inclusiveLeaveDays('2025-04-03', '2025-04-01')).toBeNull();
  });
});

describe('IssueTranscriptByName (PRC-L056)', () => {
  it('requires confirmation naming the student before issuing', async () => {
    issueTranscriptAction.mockResolvedValue({ ok: true, extra: { version: 2 } });
    render(<IssueTranscriptByName students={[{ id: 's1', label: 'Meera Nair' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Issue official transcript' }));
    expect(issueTranscriptAction).not.toHaveBeenCalled();
    expect(screen.getByText('Issue official transcript for Meera Nair?')).toBeVisible();
    fireEvent.click(screen.getByTestId('issue-transcript-confirm-confirm'));
    await waitFor(() => expect(issueTranscriptAction).toHaveBeenCalledWith({ studentId: 's1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Issued transcript version 2.');
  });
});
