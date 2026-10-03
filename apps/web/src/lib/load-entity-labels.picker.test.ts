import { beforeEach, describe, expect, it, vi } from 'vitest';

const listStudents = vi.fn();
const getStudent = vi.fn();
vi.mock('@/lib/api/students', () => ({
  listStudents: (f: unknown) => listStudents(f),
  getStudent: (id: string) => getStudent(id),
}));
vi.mock('@/lib/api/staff', () => ({ listStaff: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn() }));

import { loadStudentLabelsForIds, loadStudentOptions } from './load-entity-labels';

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
    listStudents.mockReset();
    const all = Array.from({ length: 250 }, (_, i) => student(i + 1));
    listStudents.mockImplementation(
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
    getStudent.mockResolvedValue(student(7));
    const labels = await loadStudentLabelsForIds(['s-7']);
    expect(labels.get('s-7')).toBe('ADM-7 · Kid 7');
  });
});
