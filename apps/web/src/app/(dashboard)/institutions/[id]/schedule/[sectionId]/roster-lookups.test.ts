/**
 * PRC-M097 — a 50-enrollment roster resolves missing student names with one
 * batch request, not one gateway call per enrollment.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
const getSection = vi.fn();
const listPeriods = vi.fn(async () => ({ ok: true, data: [] }));
vi.mock('@/lib/api/timetable', () => ({
  getSection,
  listPeriods,
  listRooms: vi.fn(async () => ({ ok: true, data: [] })),
  listBellSchedules: vi.fn(async () => ({
    ok: true,
    data: [
      { id: 'bs1', name: 'Main' },
      { id: 'bs2', name: 'Winter' },
    ],
  })),
}));
const getStaff = vi.fn(async (id: string) => ({ id, firstName: 'T', lastName: id }));
vi.mock('@/lib/api/staff', () => ({
  getStaff,
  listStaff: vi.fn(async () => ({ data: [] })),
}));
const getStudent = vi.fn();
const listStudents = vi.fn(async (filters: { ids?: string[] }) => ({
  data: (filters.ids ?? []).map((id) => ({ id, firstName: 'S', lastName: id })),
  meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
}));
vi.mock('@/lib/api/students', () => ({ getStudent, listStudents }));
vi.mock('@/components/timetable/section-roster-controls', () => ({
  SectionBulkEnrollForm: () => null,
  SectionEnrollForm: () => null,
  SectionPublishControls: () => null,
  WithdrawStudentButton: () => null,
}));

describe('section roster lookups (PRC-M097)', () => {
  it('batches 50 missing students into one ids request', async () => {
    const enrollments = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      studentId: `stu-${i}`,
      status: 'ENROLLED',
    }));
    getSection.mockResolvedValue({
      ok: true,
      data: {
        id: 'sec-1',
        institutionId: 'inst-A',
        name: 'S',
        code: 'S',
        status: 'DRAFT',
        enrollments,
        meetings: [
          { id: 'm1', staffId: 'staff-1', dayOfWeek: 1, periodId: 'p1' },
          { id: 'm2', staffId: 'staff-1', dayOfWeek: 2, periodId: 'p1' },
        ],
      },
    });
    const { default: Page } = await import('./page');
    await Page({ params: Promise.resolve({ id: 'inst-A', sectionId: 'sec-1' }) });
    expect(getStudent).not.toHaveBeenCalled();
    const idCalls = listStudents.mock.calls.filter(([f]) => f.ids);
    expect(idCalls).toHaveLength(1);
    expect(idCalls[0]![0].ids).toHaveLength(50);
    // Duplicate staff ids are fetched once; periods once per bell schedule.
    expect(getStaff).toHaveBeenCalledTimes(1);
    expect(listPeriods).toHaveBeenCalledTimes(2);
  });
});
