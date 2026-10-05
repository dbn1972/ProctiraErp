/** PRC-M094: report card page is preview-only, names the student, 404s foreign jobs. */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const m = vi.hoisted(() => ({ listReportCardJobs: vi.fn(), notFound: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    m.notFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/api/gradebook', () => ({ listReportCardJobs: m.listReportCardJobs }));
vi.mock('@/lib/load-entity-labels', () => ({
  withStudentLabels: vi.fn(async () => new Map([['stu-1', 'Asha Rao']])),
}));

import ReportCardJobPage from './page';

const job = {
  id: 'job-1',
  institutionId: 'inst-1',
  status: 'SUCCEEDED',
  errorMessage: null,
  metadata: { studentId: 'stu-1', term: 'Term 1', gradeCount: 4 },
};

describe('ReportCardJobPage (PRC-M094)', () => {
  it('shows the real student name and "Preview only", never a PDF', async () => {
    m.listReportCardJobs.mockResolvedValue({ ok: true, data: [job] });
    const html = renderToStaticMarkup(
      await ReportCardJobPage({ params: Promise.resolve({ id: 'inst-1', jobId: 'job-1' }) }),
    );
    expect(html).toContain('Asha Rao');
    expect(html).toContain('Preview only');
    expect(html).not.toMatch(/\bPDF\b(?! is not)/);
  });

  it('404s an unknown or other-institution job', async () => {
    m.listReportCardJobs.mockResolvedValue({ ok: true, data: [job] });
    await expect(
      ReportCardJobPage({ params: Promise.resolve({ id: 'inst-2', jobId: 'job-1' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(
      ReportCardJobPage({ params: Promise.resolve({ id: 'inst-1', jobId: 'nope' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
