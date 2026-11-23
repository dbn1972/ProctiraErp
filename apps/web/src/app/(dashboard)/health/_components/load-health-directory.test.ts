/**
 * @vitest-environment node
 *
 * HL-O4: the health form pickers read one 20-row page of students, staff and schools,
 * so a student beyond the first 20 could not be selected. They now use the shared
 * directory loaders (students paged to the end, staff and schools at the API maximum).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listStudents: vi.fn(),
  getStudent: vi.fn(),
  listStaff: vi.fn(),
  getStaff: vi.fn(),
  listInstitutions: vi.fn(),
}));
vi.mock('@/lib/api/students', () => ({
  listStudents: api.listStudents,
  getStudent: api.getStudent,
}));
vi.mock('@/lib/api/staff', () => ({ listStaff: api.listStaff, getStaff: api.getStaff }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: api.listInstitutions }));

import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';
import {
  loadHealthInstitutionOptions,
  loadHealthStaffOptions,
  loadHealthStudentOptions,
} from './load-health-directory';

const TOTAL = 250;
const students = Array.from({ length: TOTAL }, (_, i) => ({
  id: `s-${i + 1}`,
  firstName: 'Kid',
  lastName: String(i + 1),
  nationalId: `NID-${i + 1}`,
  customData: {},
}));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listStudents.mockImplementation(
    async ({ page = 1, pageSize }: { page?: number; pageSize: number }) => ({
      data: students.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, totalItems: TOTAL, totalPages: Math.ceil(TOTAL / pageSize) },
    }),
  );
  api.listStaff.mockResolvedValue({
    data: [{ id: 'st-1', firstName: 'Tara', lastName: 'K', position: 'Counsellor' }],
  });
  api.listInstitutions.mockResolvedValue([{ id: 'i-1', code: 'SCH1', name: 'School One' }]);
});

describe('health form pickers (HL-O4)', () => {
  it('lists every student, so student #21 and #250 are selectable', async () => {
    const options = await loadHealthStudentOptions();
    expect(options).toHaveLength(TOTAL);
    expect(options.find((o) => o.id === 's-21')?.label).toBe('Kid 21');
    expect(options.find((o) => o.id === 's-250')?.label).toBe('Kid 250');
    expect(options.map((o) => o.label).join(' ')).not.toContain('NID-');
  });

  it('reads staff and schools at the API page maximum, not 20', async () => {
    const [staff, schools] = await Promise.all([
      loadHealthStaffOptions(),
      loadHealthInstitutionOptions(),
    ]);
    // Not pinned to one call shape: the shared staff loader may page later (PR-2).
    expect(api.listStaff.mock.calls[0]![0].pageSize).toBe(MAX_API_PAGE_SIZE);
    expect(api.listInstitutions.mock.calls[0]![0].pageSize).toBe(MAX_API_PAGE_SIZE);
    expect(staff).toEqual([
      { id: 'st-1', label: 'Counsellor · Tara K', searchText: 'Tara K Counsellor' },
    ]);
    expect(schools).toEqual([
      { id: 'i-1', label: 'SCH1 · School One', searchText: 'SCH1 School One' },
    ]);
  });
});
