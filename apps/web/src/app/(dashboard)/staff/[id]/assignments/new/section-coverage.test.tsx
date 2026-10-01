/**
 * PRC-L051 — Section coverage reflects live assignments for the selected
 * class + subject; failures render an error state instead of an empty list.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CLASS_A = '00000000-0000-4000-8000-0000000000a1';
const CLASS_B = '00000000-0000-4000-8000-0000000000a2';
const SUBJECT = '00000000-0000-4000-8000-0000000000b1';
const STAFF = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';

const listSectionAssignments = vi.fn();
vi.mock('@/lib/api/staff', () => ({
  listSectionAssignments: (...a: unknown[]) => listSectionAssignments(...a),
  getStaff: vi.fn(async (id: string) =>
    id === OTHER ? { firstName: 'Ravi', lastName: 'Kumar', position: 'TGT' } : null,
  ),
}));
vi.mock('../../../_components/assignment-form', () => ({ AssignmentForm: () => null }));

import { loadSectionCoverageAction } from '../../../coverage-actions';
import { SectionCoverageCard } from './assignment-workspace';

function row(classId: string, staffId: string, status = 'ACTIVE') {
  return {
    id: `${classId}-${staffId}`,
    staffId,
    institutionId: 'i',
    subjectId: SUBJECT,
    classId,
    role: 'SUBJECT_TEACHER',
    allocationPercentage: 40,
    startDate: '2026-04-01',
    endDate: null,
    status,
    createdAt: '',
    updatedAt: '',
  };
}

describe('section coverage (PRC-L051)', () => {
  beforeEach(() => listSectionAssignments.mockReset());

  it('updates when class + subject selection changes', async () => {
    listSectionAssignments.mockImplementation(async (classId: string) => ({
      ok: true,
      items: classId === CLASS_A ? [row(CLASS_A, OTHER), row(CLASS_A, STAFF, 'INACTIVE')] : [],
    }));
    const { rerender } = render(<SectionCoverageCard staffId={STAFF} classId="" subjectId="" />);
    expect(screen.getByText(/Select a class and subject/)).toBeTruthy();

    rerender(<SectionCoverageCard staffId={STAFF} classId={CLASS_A} subjectId={SUBJECT} />);
    await waitFor(() => expect(screen.getByText(/Ravi Kumar/)).toBeTruthy());
    expect(screen.getByText(/1 active assignment · 40%/)).toBeTruthy();

    rerender(<SectionCoverageCard staffId={STAFF} classId={CLASS_B} subjectId={SUBJECT} />);
    await waitFor(() => expect(screen.getByText(/Coverage gap/)).toBeTruthy());
    expect(listSectionAssignments).toHaveBeenCalledWith(CLASS_B, SUBJECT);
  });

  it('shows an error state when assignments cannot be loaded', async () => {
    listSectionAssignments.mockResolvedValue({ ok: false, kind: 'denied', status: 403 });
    render(<SectionCoverageCard staffId={STAFF} classId={CLASS_A} subjectId={SUBJECT} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'You do not have access to section coverage.',
      ),
    );
  });

  it('rejects non-UUID selections without calling the gateway', async () => {
    expect(await loadSectionCoverageAction('x', SUBJECT)).toEqual({
      status: 'error',
      message: 'Select a valid class and subject.',
    });
    expect(listSectionAssignments).not.toHaveBeenCalled();
  });
});
