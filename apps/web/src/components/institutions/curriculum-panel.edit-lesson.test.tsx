/**
 * @vitest-environment jsdom
 *
 * PRC-M137: editing a lesson-plan title must go through an accessible dialog,
 * not the native window.prompt. The dialog lets the editor cancel and only
 * calls the update action when confirmed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const updateLessonPlanAction = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock('@/app/(dashboard)/institutions/[id]/curriculum/actions', () => ({
  createLearningOutcomeAction: vi.fn(),
  createLessonPlanAction: vi.fn(),
  createSyllabusUnitAction: vi.fn(),
  deleteLearningOutcomeAction: vi.fn(),
  deleteLessonPlanAction: vi.fn(),
  markUnitTaughtAction: vi.fn(),
  unmarkUnitTaughtAction: vi.fn(),
  updateLessonPlanAction: (...args: unknown[]) => updateLessonPlanAction(...args),
}));

import { CurriculumPanel } from './curriculum-panel';

const UNIT = {
  id: 'unit-1',
  institutionId: 'inst-1',
  subjectId: 'sub-1',
  gradeId: 'grade-1',
  academicPeriodId: 'period-1',
  title: 'Unit One',
  sequence: 1,
};

function renderPanel() {
  return render(
    <CurriculumPanel
      institutionId="inst-1"
      subjects={[{ id: 'sub-1', name: 'Math' } as never]}
      grades={[{ id: 'grade-1', name: 'Grade 1' } as never]}
      periods={[{ id: 'period-1', name: '2026' } as never]}
      units={[UNIT as never]}
      plansByUnit={{
        'unit-1': [{ id: 'plan-1', unitId: 'unit-1', title: 'Intro', plannedDate: null } as never],
      }}
      outcomes={[]}
      coverage={null}
      coverageRows={[]}
      defaultSubjectId="sub-1"
      defaultGradeId="grade-1"
      defaultPeriodId="period-1"
    />,
  );
}

beforeEach(() => {
  updateLessonPlanAction.mockReset();
  updateLessonPlanAction.mockResolvedValue({ ok: true });
  routerRefresh.mockReset();
});

describe('CurriculumPanel lesson edit (PRC-M137)', () => {
  it('does not use window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    renderPanel();
    fireEvent.click(screen.getByTestId('edit-lesson-plan-1'));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('curriculum-edit-lesson')).toBeTruthy();
    promptSpy.mockRestore();
  });

  it('saves the edited title through the update action', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('edit-lesson-plan-1'));
    const input = screen.getByTestId('curriculum-edit-lesson-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Introduction v2' } });
    fireEvent.click(screen.getByTestId('curriculum-edit-lesson-confirm'));
    await waitFor(() => expect(updateLessonPlanAction).toHaveBeenCalledTimes(1));
    expect(updateLessonPlanAction).toHaveBeenCalledWith('inst-1', {
      id: 'plan-1',
      title: 'Introduction v2',
      plannedDate: '',
    });
  });
});
