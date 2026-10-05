/**
 * PRC-M083: label maps resolve ids beyond the first directory page by id
 * instead of falling back to truncated UUIDs.
 * PRC-M156: student picker labels never expose nationalId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  listStudents: vi.fn(),
  getStudent: vi.fn(),
  listStaff: vi.fn(),
  getStaff: vi.fn(),
}));
vi.mock('@/lib/api/students', () => ({
  listStudents: api.listStudents,
  getStudent: api.getStudent,
}));
vi.mock('@/lib/api/staff', () => ({ listStaff: api.listStaff, getStaff: api.getStaff }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn(async () => []) }));
import {
  loadStudentDirectory,
  loadStudentLabelMap,
  loadStudentLabelsForIds,
  loadStudentOptions,
  withPersonLabels,
} from './load-entity-labels';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

const page = Array.from({ length: 100 }, (_, i) => ({
  id: `s-${i}`,
  firstName: 'Student',
  lastName: String(i),
  nationalId: null,
}));
describe('load-entity-labels (PRC-M083)', () => {
  it('resolves candidate N+1 beyond the capped page by id', async () => {
    api.listStudents.mockResolvedValue({ data: page, meta: { totalItems: 101 } });
    api.getStudent.mockImplementation(async (id: string) =>
      id === 's-100' ? { id, firstName: 'Late', lastName: 'Joiner', nationalId: null } : null,
    );
    const labels = await loadStudentLabelMap(['s-1', 's-100', 'missing']);
    expect(labels.get('s-1')).toBe('Student 1');
    expect(labels.get('s-100')).toBe('Late Joiner');
    expect(labels.has('missing')).toBe(false);
    // Only misses are fetched individually.
    expect(api.getStudent).toHaveBeenCalledTimes(2);
  });
  it('reports directory size so pickers can show a truncation notice', async () => {
    api.listStudents.mockResolvedValue({ data: page, meta: { totalItems: 3000 } });
    const dir = await loadStudentDirectory();
    expect(dir.options).toHaveLength(100);
    expect(dir.total).toBe(3000);
  });
  it('person labels fall back from student to staff', async () => {
    api.getStudent.mockResolvedValue(null);
    api.getStaff.mockResolvedValue({
      id: 't-1',
      firstName: 'Tara',
      lastName: 'K',
      position: 'TGT',
    });
    const labels = await withPersonLabels(new Map(), ['t-1']);
    expect(labels.get('t-1')).toBe('TGT · Tara K');
  });
});

function student(i: number) {
  return {
    id: `s-${i}`,
    firstName: 'Kid',
    lastName: String(i),
    nationalId: `NID-SECRET-${i}`,
    customData: { admissionNumber: `ADM-${i}` },
  };
}

describe('PRC-M156 student picker labels', () => {
  beforeEach(() => {
    const all = Array.from({ length: 250 }, (_, i) => student(i + 1));
    api.listStudents.mockImplementation(
      async ({ page, pageSize }: { page: number; pageSize: number }) => ({
        data: all.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, totalItems: 250, totalPages: Math.ceil(250 / pageSize) },
      }),
    );
  });

  it('never puts nationalId in label or searchText', async () => {
    const options = await loadStudentOptions();
    for (const option of options) {
      expect(option.label).not.toContain('NID-SECRET');
      expect(option.searchText ?? '').not.toContain('NID-SECRET');
    }
    expect(options[0]!.label).toBe('ADM-1 · Kid 1');
  });
  it('a tenant with 250 students can select student #200', async () => {
    const options = await loadStudentOptions();
    expect(options).toHaveLength(250);
    expect(options.find((o) => o.searchText?.includes('ADM-200'))?.id).toBe('s-200');
  });
  it('id-based labels also omit nationalId', async () => {
    api.getStudent.mockResolvedValue(student(7));
    const labels = await loadStudentLabelsForIds(['s-7']);
    expect(labels.get('s-7')).toBe('ADM-7 · Kid 7');
  });
});
