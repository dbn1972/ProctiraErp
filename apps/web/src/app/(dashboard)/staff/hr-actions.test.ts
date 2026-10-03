import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/staff', () => ({
  commitStaffImport: vi.fn(),
  createStaffContract: vi.fn(),
  createStaffQualification: vi.fn(),
  dryRunStaffImport: vi.fn(),
  exportStaffPayroll: vi.fn(),
  markStaffAttendanceBulk: vi.fn(),
}));

import { commitStaffImport, markStaffAttendanceBulk } from '@/lib/api/staff';
import { commitImportAction, saveAttendanceAction } from './hr-actions';
import { changedAttendanceMarks } from './_components/staff-attendance-grid';

const CSV = 'firstName,lastName\nA,B\nC,\n';

describe('commitImportAction status (PRC-L246)', () => {
  it('returns partial when the commit report has row errors', async () => {
    vi.mocked(commitStaffImport).mockResolvedValue({
      rows: 2,
      valid: 1,
      created: 1,
      errors: [{ row: 3, message: 'Required' }],
    } as never);
    const result = await commitImportAction(CSV, 'staff.csv');
    expect(result.status).toBe('partial');
  });

  it('returns success when every row was imported', async () => {
    vi.mocked(commitStaffImport).mockResolvedValue({
      rows: 1,
      valid: 1,
      created: 1,
      errors: [],
    } as never);
    const result = await commitImportAction(CSV, 'staff.csv');
    expect(result.status).toBe('success');
  });
});

describe('staff attendance save (PRC-M123)', () => {
  it('changing one mark sends one row', () => {
    const staff = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const initial = { a: 'present', b: 'present' } as const;
    const draft = { a: 'present', b: 'absent', c: undefined } as never;
    expect(changedAttendanceMarks(staff, initial, draft)).toEqual([
      { staffId: 'b', status: 'absent' },
    ]);
    expect(changedAttendanceMarks(staff, initial, initial)).toEqual([]);
  });
  it('rejects a future date without calling the API', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const result = await saveAttendanceAction({
      date: future,
      marks: [{ staffId: 'a', status: 'present' }],
    });
    expect(result.status).toBe('error');
    expect(markStaffAttendanceBulk).not.toHaveBeenCalled();
  });
});
