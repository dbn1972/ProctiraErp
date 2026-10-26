/**
 * PRC-L228 — component tests for the staff list page (async Server Component).
 *
 * Asserts current behaviour only: rows link to the detail and edit routes, the
 * empty state renders for an empty page, and URL search params reach
 * `listStaff` (page, clamped pageSize, filters, the server-side type tab).
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clampPageSize } from '@/lib/api/pagination';

const listStaff = vi.fn();
const listInstitutions = vi.fn();

vi.mock('@/lib/api/staff', () => ({ listStaff: (...a: unknown[]) => listStaff(...a) }));
vi.mock('@/lib/api/institutions', () => ({
  listInstitutions: (...a: unknown[]) => listInstitutions(...a),
}));
// Client children need router context; their own tests cover them.
vi.mock('./_components/staff-list-filters', () => ({
  StaffListFilters: () => <div data-testid="staff-filters-stub" />,
}));
vi.mock('./_components/staff-list-pagination', () => ({
  StaffListPagination: () => <div data-testid="staff-pagination-stub" />,
}));
vi.mock('./_components/staff-type-tabs', () => ({
  StaffTypeTabs: ({ activeType }: { activeType: string }) => (
    <div data-testid="staff-tabs-stub" data-active={activeType} />
  ),
}));

import StaffListPage from './page';

const INST = '11111111-1111-4111-8111-111111111111';

function staffPage(data: unknown[], totalItems = data.length) {
  return { data, meta: { page: 1, pageSize: 20, totalItems, totalPages: 1 } };
}

async function renderPage(params: Record<string, string> = {}) {
  render(await StaffListPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  listStaff.mockReset();
  listInstitutions.mockReset();
  listInstitutions.mockResolvedValue([{ id: INST, name: 'Green Valley School' }]);
});

describe('StaffListPage (PRC-L228)', () => {
  it('renders a row per staff member with detail and edit links', async () => {
    listStaff.mockResolvedValue(
      staffPage([
        {
          id: 'staff-1',
          firstName: 'Asha',
          lastName: 'Rao',
          identityNumber: 'EMP-001',
          position: 'Teacher',
          status: 'ACTIVE',
          customData: { designation: 'PGT', subjects: ['Maths', 'Physics'] },
        },
      ]),
    );
    await renderPage();

    const table = screen.getByRole('table', { name: 'Staff records' });
    const name = within(table).getByRole('link', { name: 'Asha Rao' });
    expect(name).toHaveAttribute('href', '/staff/staff-1');
    expect(within(table).getByRole('link', { name: 'Edit Asha Rao' })).toHaveAttribute(
      'href',
      '/staff/staff-1/edit',
    );
    expect(within(table).getByText('EMP-001')).toBeInTheDocument();
    expect(within(table).getByText('PGT')).toBeInTheDocument();
    expect(within(table).getByText('Maths')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/^1 staff/)).toBeInTheDocument();
  });

  it('renders the empty state when the page has no staff', async () => {
    listStaff.mockResolvedValue(staffPage([]));
    await renderPage();
    expect(screen.getByText('No staff found')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('passes page, clamped pageSize and filters from the URL to listStaff', async () => {
    listStaff.mockResolvedValue(staffPage([]));
    await renderPage({
      page: '3',
      pageSize: '500',
      search: 'asha',
      institutionId: INST,
      position: 'Teacher',
      status: 'ACTIVE',
      type: 'TEACHING',
    });
    expect(listStaff).toHaveBeenCalledWith({
      page: 3,
      pageSize: clampPageSize(500),
      sortBy: 'lastName',
      sortOrder: 'asc',
      search: 'asha',
      institutionId: INST,
      position: 'Teacher',
      status: 'ACTIVE',
      type: 'TEACHING',
    });
    expect(clampPageSize(500)).toBeLessThan(500);
    expect(screen.getByTestId('staff-tabs-stub')).toHaveAttribute('data-active', 'TEACHING');
  });

  it('ignores an unknown type tab and the ALL status', async () => {
    listStaff.mockResolvedValue(staffPage([]));
    await renderPage({ type: 'BOGUS', status: 'ALL' });
    expect(listStaff).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'lastName',
      sortOrder: 'asc',
    });
  });
});
