/**
 * PRC-L237 — examination detail pages show write controls only to roles that
 * hold the examination write the server actions require; the exam ops page
 * is denied to read-only roles before any gateway read.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ canWrite: false }));
const api = vi.hoisted(() => ({
  getExamination: vi.fn(),
  listExaminationCandidates: vi.fn(),
  getExaminationResultsView: vi.fn(),
  listExaminationDocuments: vi.fn(),
  listExamSessions: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
  usePathname: () => '/examinations/exam-1',
}));
vi.mock('@/lib/auth/require-permission', () => ({
  hasSessionPermission: vi.fn(async () => gate.canWrite),
}));
vi.mock('@/lib/api/examinations', () => api);
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentDirectory: vi.fn(async () => ({ options: [], total: 0 })),
  loadStudentOptions: vi.fn(async () => []),
  withStudentLabels: vi.fn(async (labels: Map<string, string>) => labels),
}));
vi.mock('@/components/examinations/exam-ops-controls', () => ({
  RegisterCandidateDialog: () => <button type="button">Register candidate</button>,
  ResultsControls: () => <button type="button">Upload marks</button>,
  GenerateDocumentButtons: () => <button type="button">Generate admit cards</button>,
}));
vi.mock('@/components/auth/route-access-denied', () => ({
  RouteAccessDenied: () => <p data-testid="route-access-denied">Access denied</p>,
}));

import CandidatesPage from './candidates/page';
import DocumentsPage from './documents/page';
import { ExamTabs } from './exam-tabs';
import OpsPage from './ops/page';
import ResultsPage from './results/page';

const params = Promise.resolve({ id: 'exam-1' });
const EXAM = { id: 'exam-1', centers: [], subjects: [] };

beforeEach(() => {
  vi.clearAllMocks();
  api.getExamination.mockResolvedValue(EXAM);
  api.listExaminationCandidates.mockResolvedValue([]);
  api.getExaminationResultsView.mockResolvedValue({
    rows: [],
    subjects: [],
    published: false,
    publishedAt: null,
  });
  api.listExaminationDocuments.mockResolvedValue([]);
});

describe('examination management gates (PRC-L237)', () => {
  it('denies exam ops to a read-only role without loading exam data', async () => {
    gate.canWrite = false;
    render(await OpsPage({ params }));
    expect(screen.getByTestId('route-access-denied')).toBeTruthy();
    expect(api.getExamination).not.toHaveBeenCalled();
    expect(api.listExamSessions).not.toHaveBeenCalled();
  });

  it.each([
    ['candidates', CandidatesPage, 'Register candidate'],
    ['results', ResultsPage, 'Upload marks'],
    ['documents', DocumentsPage, 'Generate admit cards'],
  ] as const)('%s page hides its write control from a read-only role', async (_, Page, label) => {
    gate.canWrite = false;
    render(await Page({ params }));
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  });

  it.each([
    ['candidates', CandidatesPage, 'Register candidate'],
    ['results', ResultsPage, 'Upload marks'],
    ['documents', DocumentsPage, 'Generate admit cards'],
  ] as const)(
    '%s page shows its write control to an examination writer',
    async (_, Page, label) => {
      gate.canWrite = true;
      render(await Page({ params }));
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    },
  );

  it('hides the Exam ops tab unless the session can manage', () => {
    const { unmount } = render(<ExamTabs examId="exam-1" canManage={false} />);
    expect(screen.queryByRole('link', { name: 'Exam ops' })).toBeNull();
    unmount();
    render(<ExamTabs examId="exam-1" canManage />);
    expect(screen.getByRole('link', { name: 'Exam ops' })).toBeTruthy();
  });
});
