/**
 * @vitest-environment jsdom
 *
 * PRC-M114 — applications are paged and filtered by the API (status groups,
 * programId), with page controls; the program detail request carries programId.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listScholarshipApplications = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/scholarships', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/scholarships')>()),
  listScholarshipApplications,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/scholarships/applications',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../_components/application-status-tabs', () => ({ ApplicationStatusTabs: () => null }));
vi.mock('../_components/applications-export-button', () => ({
  ApplicationsExportButton: () => null,
}));

import Page from './page';

const app = (i: number) => ({
  id: `a${i}`,
  programId: 'p1',
  programName: 'Merit',
  applicantId: `s${i}`,
  applicantName: `Student ${i}`,
  submittedAt: '2026-01-01',
  status: 'UNDER_REVIEW',
  totalScore: null,
  reviewerId: null,
  reviewNotes: null,
});

describe('applications paging (PRC-M114)', () => {
  beforeEach(() => {
    listScholarshipApplications.mockReset();
    listScholarshipApplications.mockImplementation(async (params: { pageSize?: number }) =>
      params.pageSize === 1
        ? { ok: true, items: [app(0)], meta: { totalItems: 500 } }
        : {
            ok: true,
            items: Array.from({ length: 20 }, (_, i) => app(i)),
            meta: { page: 3, pageSize: 20, totalItems: 500, totalPages: 25 },
          },
    );
  });

  it('issues a paged, status-filtered request with programId and renders page controls', async () => {
    render(
      await Page({
        searchParams: Promise.resolve({ status: 'UNDER_REVIEW', programId: 'p1', page: '3' }),
      }),
    );
    expect(listScholarshipApplications).toHaveBeenCalledWith({
      programId: 'p1',
      status: 'submitted,under_review',
      page: 3,
      pageSize: 20,
    });
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(21);
  });
});
