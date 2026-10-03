/**
 * PRC-M083: label maps resolve ids beyond the first directory page by id
 * instead of falling back to truncated UUIDs.
 */
import { describe, expect, it, vi } from 'vitest';

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

import { loadStudentDirectory, loadStudentLabelMap, withPersonLabels } from './load-entity-labels';

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
