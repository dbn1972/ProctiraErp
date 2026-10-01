import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AssignmentDetailPage from './page';

const ASSIGNMENT_ID = '00000000-0000-4000-8000-0000000000a1';
const STUDENT_ID = '00000000-0000-4000-8000-0000000000b1';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('../../_components/badges', () => ({
  KindPill: () => null,
  ScopePill: () => null,
  StatusPill: () => null,
  SubmissionPill: () => null,
}));
vi.mock('../../_components/criterion-options', () => ({
  loadCriterionOptions: vi.fn(async () => []),
}));
vi.mock('../../_components/assignment-lifecycle', () => ({ AssignmentLifecycle: () => null }));
vi.mock('../../_components/depth-grade-forms', () => ({
  AssignmentFileForm: () => null,
  RubricGradeForm: () => null,
}));
vi.mock('../../_components/grade-submission-form', () => ({ GradeSubmissionForm: () => null }));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async () => new Map([[STUDENT_ID, 'Aarav Mehta · ADM-001']])),
}));
vi.mock('@/lib/api/lms', () => ({
  getAssignment: vi.fn(async () => ({
    id: ASSIGNMENT_ID,
    kind: 'assignment',
    scope: 'school',
    status: 'published',
    title: 'Fractions worksheet',
    subject: 'Maths',
    gradeLevel: null,
    dueAt: null,
    maxScore: 10,
    questions: [],
  })),
  getQuizAnalytics: vi.fn(async () => null),
  getRubric: vi.fn(async () => null),
  listAssignmentFiles: vi.fn(async () => []),
  listSubmissions: vi.fn(async () => [
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      status: 'submitted',
      score: null,
      submittedAt: '2026-01-10T10:00:00.000Z',
    },
  ]),
}));

describe('AssignmentDetailPage submission roster (PRC-L044)', () => {
  it('shows the student name instead of the raw UUID', async () => {
    render(await AssignmentDetailPage({ params: Promise.resolve({ id: ASSIGNMENT_ID }) }));
    const cell = screen.getByTestId('submission-student');
    expect(cell.textContent).toBe('Aarav Mehta · ADM-001');
    expect(cell.textContent).not.toContain(STUDENT_ID);
  });
});
