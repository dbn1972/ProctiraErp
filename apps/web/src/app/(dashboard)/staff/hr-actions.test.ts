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

import { commitStaffImport } from '@/lib/api/staff';
import { commitImportAction } from './hr-actions';

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
