/**
 * PRC-L228 — component tests for the student list page (async Server Component).
 *
 * Asserts current behaviour only: rows resolve placement names through the
 * directories and status through the active enrollment, the empty state renders
 * for an empty page, and URL search params reach `listStudents`.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listStudents = vi.fn();
const listInstitutions = vi.fn();
const loadActiveEnrollments = vi.fn();
const loadPlacementDirectories = vi.fn();

vi.mock('@/lib/api/students', () => ({
  listStudents: (...a: unknown[]) => listStudents(...a),
}));
vi.mock('@/lib/api/institutions', () => ({
  listInstitutions: (...a: unknown[]) => listInstitutions(...a),
}));
vi.mock('./_components/load-student-placement', () => ({
  loadActiveEnrollments: (...a: unknown[]) => loadActiveEnrollments(...a),
  loadPlacementDirectories: (...a: unknown[]) => loadPlacementDirectories(...a),
  // Same rule as the real module (PRC-M128): status comes from the enrollment.
  deriveEnrollmentStatus: (e: { status: string } | null) => e?.status ?? 'NOT_ENROLLED',
  canGraduateFromEnrollment: (e: { status: string } | null) => e?.status === 'ENROLLED',
}));
// Client children need router context; their own tests cover them.
vi.mock('./_components/student-list-filters', () => ({
  StudentListFilters: () => <div data-testid="student-filters-stub" />,
}));
vi.mock('./_components/student-list-pagination', () => ({
  StudentListPagination: () => <div data-testid="student-pagination-stub" />,
}));
vi.mock('./_components/student-status-tabs', () => ({
  StudentStatusTabs: ({ activeStatus }: { activeStatus: string }) => (
    <div data-testid="student-tabs-stub" data-active={activeStatus} />
  ),
}));
vi.mock('./_components/students-bulk-graduate-bar', () => ({
  StudentsBulkGraduateBar: ({
    rows,
  }: {
    rows: Array<{ studentId: string; canGraduate: boolean }>;
  }) => (
    <div
      data-testid="bulk-graduate-stub"
      data-graduatable={rows
        .filter((r) => r.canGraduate)
        .map((r) => r.studentId)
        .join(',')}
    />
  ),
}));

import StudentListPage from './page';

const INST = '11111111-1111-4111-8111-111111111111';
const GRADE = '22222222-2222-4222-8222-222222222222';
const CLASS = '33333333-3333-4333-8333-333333333333';

function student(id: string, firstName: string, lastName: string) {
  return {
    id,
    firstName,
    lastName,
    dateOfBirth: '2014-04-18',
    gender: 'male',
    nationalId: `NID-${id}`,
    nationality: null,
    contacts: [],
    guardians: [],
    identityDocuments: [],
    customData: {},
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function studentPage(data: unknown[]) {
  return { data, meta: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

async function renderPage(params: Record<string, string> = {}) {
  render(await StudentListPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  listStudents.mockReset();
  listInstitutions.mockReset();
  loadActiveEnrollments.mockReset();
  loadPlacementDirectories.mockReset();
  listInstitutions.mockResolvedValue([{ id: INST, name: 'Green Valley School' }]);
  loadPlacementDirectories.mockResolvedValue({
    institutions: new Map([[INST, 'Green Valley School']]),
    grades: new Map([[GRADE, 'Grade 5']]),
    classes: new Map([[CLASS, '5-A']]),
  });
});

describe('StudentListPage (PRC-L228)', () => {
  it('renders rows with placement names and enrollment-derived status', async () => {
    listStudents.mockResolvedValue(
      studentPage([student('st-1', 'Ravi', 'Kumar'), student('st-2', 'Meera', 'Das')]),
    );
    loadActiveEnrollments.mockResolvedValue(
      new Map([
        ['st-1', { institutionId: INST, gradeId: GRADE, classId: CLASS, status: 'ENROLLED' }],
        ['st-2', null],
      ]),
    );
    await renderPage();

    expect(loadActiveEnrollments).toHaveBeenCalledWith(['st-1', 'st-2']);
    const names = screen.getAllByTestId('student-row-name');
    expect(names.map((n) => n.textContent)).toEqual(['Ravi Kumar', 'Meera Das']);
    expect(names[0]).toHaveAttribute('href', '/students/st-1');

    const [ravi, meera] = screen.getAllByRole('row').slice(1);
    expect(within(ravi!).getByTestId('student-institution')).toHaveTextContent(
      'Green Valley School',
    );
    expect(within(ravi!).getByTestId('student-class-section')).toHaveTextContent('Grade 5 · 5-A');
    expect(within(ravi!).getByText('Enrolled')).toBeInTheDocument();
    expect(within(ravi!).getByRole('link', { name: 'Edit Ravi Kumar' })).toHaveAttribute(
      'href',
      '/students/st-1/edit',
    );
    // No active enrollment: placement is unknown and the student is not enrolled.
    expect(within(meera!).getByTestId('student-institution')).toHaveTextContent('—');
    expect(within(meera!).getByText('Not enrolled')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-graduate-stub')).toHaveAttribute('data-graduatable', 'st-1');
  });

  it('renders the empty state when the page has no students', async () => {
    listStudents.mockResolvedValue(studentPage([]));
    loadActiveEnrollments.mockResolvedValue(new Map());
    await renderPage();
    expect(screen.getByText('No students found')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByText('Manage student records, enrollment, and transfers.'),
    ).toBeInTheDocument();
  });

  it('passes page and filters from the URL to listStudents', async () => {
    listStudents.mockResolvedValue(studentPage([]));
    loadActiveEnrollments.mockResolvedValue(new Map());
    await renderPage({ page: '2', search: 'ravi', institutionId: INST, status: 'ENROLLED' });
    expect(listStudents).toHaveBeenCalledWith({
      page: 2,
      pageSize: 20,
      sortBy: 'lastName',
      sortOrder: 'asc',
      search: 'ravi',
      institutionId: INST,
      status: 'ENROLLED',
    });
    expect(screen.getByTestId('student-tabs-stub')).toHaveAttribute('data-active', 'ENROLLED');
  });

  it('omits the status filter for the ALL tab and ignores a non-positive page', async () => {
    listStudents.mockResolvedValue(studentPage([]));
    loadActiveEnrollments.mockResolvedValue(new Map());
    await renderPage({ page: '-4', status: 'ALL' });
    expect(listStudents).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'lastName',
      sortOrder: 'asc',
    });
  });
});
