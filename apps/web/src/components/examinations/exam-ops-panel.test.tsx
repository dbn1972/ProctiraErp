/**
 * @vitest-environment jsdom
 *
 * PRC-M060: regenerating a persisted seating plan requires explicit confirmation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const generateSeatingAction = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/app/(dashboard)/examinations/actions', () => ({
  allocateInvigilatorAction: vi.fn(),
  assignReevaluationAction: vi.fn(),
  completeReevaluationAction: vi.fn(),
  createExamSessionAction: vi.fn(),
  generateSeatingAction: (...args: unknown[]) => generateSeatingAction(...args),
  recordDoubleEntryAction: vi.fn(),
  requestReevaluationAction: vi.fn(),
  resolveMarksAction: vi.fn(),
}));

import { ExamOpsPanel, type ExamOpsPanelProps } from './exam-ops-panel';

const baseProps = {
  examination: { id: 'exam-1', name: 'Term 1', subjects: [], centers: [] },
  sessions: [],
  invigilatorsBySession: {},
  marks: [],
  reevaluations: [],
} as unknown as Omit<ExamOpsPanelProps, 'seats'>;

const seat = {
  id: 'seat-1',
  seatNumber: 'A1',
  roomNumber: '101',
  studentName: 'Student One',
  centerName: 'Main',
} as unknown as ExamOpsPanelProps['seats'][number];

describe('ExamOpsPanel seating regenerate (PRC-M060)', () => {
  beforeEach(() => {
    generateSeatingAction.mockReset();
    generateSeatingAction.mockResolvedValue({ status: 'success', message: 'ok' });
  });

  it('generates immediately when no plan exists', async () => {
    render(<ExamOpsPanel {...baseProps} seats={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-seating'));
    });
    expect(generateSeatingAction).toHaveBeenCalledWith('exam-1');
  });

  it('opens a confirmation and cancelling makes no request', async () => {
    render(<ExamOpsPanel {...baseProps} seats={[seat]} />);
    fireEvent.click(screen.getByTestId('generate-seating'));
    expect(screen.getByTestId('regenerate-seating-dialog').textContent).toContain('Admit cards');
    fireEvent.click(screen.getByTestId('regenerate-seating-dialog-cancel'));
    expect(generateSeatingAction).not.toHaveBeenCalled();
  });

  it('regenerates only after confirming', async () => {
    render(<ExamOpsPanel {...baseProps} seats={[seat]} />);
    fireEvent.click(screen.getByTestId('generate-seating'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('regenerate-seating-dialog-confirm'));
    });
    expect(generateSeatingAction).toHaveBeenCalledTimes(1);
  });
});
