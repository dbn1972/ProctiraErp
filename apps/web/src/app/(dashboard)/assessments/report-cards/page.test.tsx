import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const ARTIFACT_URI = 's3://tenant-a-reports/students/stu-123/report-card.pdf?X-Amz-Signature=abc';

vi.mock('@/lib/api/gradebook', () => ({
  listGradebookSections: vi.fn(async () => ({ ok: true, data: [] })),
  listPublishedGradeEntries: vi.fn(async () => ({ ok: true, data: [] })),
  listGradeEntries: vi.fn(async () => ({ ok: true, data: [] })),
  readGradeWorkflowStatus: vi.fn(() => 'DRAFT'),
  listReportCardJobs: vi.fn(async () => ({
    ok: true,
    data: [
      {
        id: 'job-1',
        jobType: 'REPORT_CARD',
        status: 'COMPLETED',
        artifactUri: ARTIFACT_URI,
        createdAt: '2025-01-15T10:30:00.000Z',
      },
    ],
  })),
}));
vi.mock('@/lib/institutions/api', () => ({
  listInstitutions: vi.fn(async () => ({ data: [] })),
}));

import AssessmentReportCardsPage from './page';

describe('AssessmentReportCardsPage jobs list (PRC-L030)', () => {
  it('does not render the raw storage URI', async () => {
    const { container } = render(await AssessmentReportCardsPage());
    expect(container.innerHTML).not.toContain(ARTIFACT_URI);
    expect(container.innerHTML).not.toContain('s3://');
    const job = screen.getByTestId('report-card-job');
    expect(job.textContent).toContain('Report card · COMPLETED');
    expect(job.textContent).toContain('Artifact ready');
    expect(job.querySelector('time')?.getAttribute('dateTime')).toBe('2025-01-15T10:30:00.000Z');
  });
});
