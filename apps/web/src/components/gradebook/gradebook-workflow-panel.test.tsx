/**
 * PRC-L228: gradebook workflow transitions, confirm dialog and error state.
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

function entry(id: string, studentId: string, workflowStatus: string): GradeEntry {
  return {
    id,
    tenantId: 't',
    sectionId: 'sec',
    studentId,
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

function renderPanel(overrides: Partial<Parameters<typeof GradebookWorkflowPanel>[0]> = {}) {
  return render(
    <GradebookWorkflowPanel
      institutionId="inst"
      sectionId="sec"
      entries={[entry('e1', 's1', 'DRAFT'), entry('e2', 's2', 'APPROVED')]}
      ranks={[]}
      comments={[]}
      studentLabel={
        new Map([
          ['s1', 'Asha'],
          ['s2', 'Ravi'],
        ])
      }
      canSubmit
      canModerate
      {...overrides}
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  transitionOne.mockReset().mockResolvedValue({ ok: true });
  transitionBulk.mockReset().mockResolvedValue({ ok: true });
});

describe('GradebookWorkflowPanel', () => {
  it('renders the empty state', () => {
    renderPanel({ entries: [] });
    expect(screen.getByTestId('gradebook-empty')).toHaveTextContent(
      'No grades entered for this section',
    );
  });

  it('submits a selected draft immediately without confirmation', async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Select Asha'));
    fireEvent.click(screen.getByTestId('bulk-submit'));
    await waitFor(() =>
      expect(transitionOne).toHaveBeenCalledWith({
        id: 'e1',
        action: 'submit',
        institutionId: 'inst',
      }),
    );
    expect(await screen.findByTestId('gradebook-workflow-message')).toHaveTextContent(
      'submit applied to 1 entry.',
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('requires confirmation before publishing several entries', async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Select Asha'));
    fireEvent.click(screen.getByLabelText('Select Ravi'));
    fireEvent.click(screen.getByTestId('bulk-publish'));
    const dialog = await screen.findByTestId('gradebook-workflow-confirm');
    expect(dialog).toHaveTextContent('Publish 2 grade entries?');
    expect(transitionBulk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(transitionBulk).toHaveBeenCalledWith({
        ids: ['e1', 'e2'],
        action: 'publish',
        institutionId: 'inst',
      }),
    );
  });

  it('shows the action error and keeps the selection', async () => {
    transitionOne.mockResolvedValue({ ok: false, error: 'Entry is locked' });
    renderPanel();
    fireEvent.click(screen.getByLabelText('Select Asha'));
    fireEvent.click(screen.getByTestId('bulk-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry is locked');
    expect(screen.getByLabelText('Select Asha')).toBeChecked();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('hides moderation actions from submit-only users', () => {
    renderPanel({ canModerate: false });
    expect(screen.queryByTestId('bulk-publish')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-submit')).toBeInTheDocument();
  });
});
