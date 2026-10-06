/**
 * PRC-M474: moderators can reject a submitted entry with a mandatory reason, and bulk
 * results report the server's count rather than the selection size.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const transitionOne = vi.fn();
const transitionBulk = vi.fn();
vi.mock('@/app/(dashboard)/gradebook-actions', () => ({
  transitionGradeEntryAction: (...a: unknown[]) => transitionOne(...a),
  bulkTransitionGradeEntriesAction: (...a: unknown[]) => transitionBulk(...a),
  computeClassRankAction: vi.fn(),
  createCommentsBankAction: vi.fn(),
}));

import type { GradeEntry } from '@/lib/gradebook/workflow-status';
import { GradebookWorkflowPanel } from './gradebook-workflow-panel';

function entry(id: string, workflowStatus: string): GradeEntry {
  return {
    id,
    tenantId: 't',
    sectionId: 'sec',
    studentId: `s-${id}`,
    assessmentCode: 'T1',
    numericScore: 80,
    letterGrade: 'A',
    enteredBy: null,
    enteredAt: '2025-01-01T00:00:00Z',
    lockedAt: null,
    publishedAt: null,
    metadata: { workflowStatus },
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function renderPanel(entries: GradeEntry[], canModerate = true) {
  return render(
    <GradebookWorkflowPanel
      institutionId="inst"
      sectionId="sec"
      entries={entries}
      ranks={[]}
      comments={[]}
      studentLabel={new Map()}
      canSubmit
      canModerate={canModerate}
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  transitionOne.mockReset().mockResolvedValue({ ok: true, id: 'e1' });
  transitionBulk.mockReset();
});

describe('GradebookWorkflowPanel reject + bulk count (PRC-M474)', () => {
  it('requires a reason before rejecting and sends it', async () => {
    renderPanel([entry('e1', 'SUBMITTED')]);
    fireEvent.click(screen.getByTestId('transition-reject-e1'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(/Enter a reason/)).toBeTruthy();
    expect(transitionOne).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Marks do not match the answer sheet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(transitionOne).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'e1',
          action: 'reject',
          reason: 'Marks do not match the answer sheet',
        }),
      ),
    );
  });

  it('hides Reject from non-moderators', () => {
    renderPanel([entry('e1', 'SUBMITTED')], false);
    expect(screen.queryByTestId('transition-reject-e1')).toBeNull();
  });

  it("bulk of 3 with server count 2 shows '2 of 3'", async () => {
    transitionBulk.mockResolvedValue({ ok: true, id: 'e1', extra: { count: 2 } });
    renderPanel([entry('e1', 'DRAFT'), entry('e2', 'DRAFT'), entry('e3', 'DRAFT')]);
    for (const id of ['e1', 'e2', 'e3']) fireEvent.click(screen.getByTestId(`select-entry-${id}`));
    fireEvent.click(screen.getByTestId('bulk-submit'));
    expect(await screen.findByTestId('gradebook-workflow-message')).toHaveTextContent('2 of 3');
  });
});
