import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('./api', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode = 422;
    fieldErrors: Array<{ field: string; message: string }> = [];
  },
  createAcademicPeriod: vi.fn(),
  createCalendarEvent: vi.fn(),
  createClassSection: vi.fn(),
  updateClassSection: vi.fn(),
  createGrade: vi.fn(),
  createInstitution: vi.fn(),
  deactivateInstitution: vi.fn(),
  reactivateInstitution: vi.fn(),
  deleteAcademicPeriod: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  rolloverAcademicPeriod: vi.fn(),
  updateAcademicPeriod: vi.fn(),
  updateInstitution: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { reactivateInstitutionAction } from './actions';
import { reactivateInstitution } from './api';

describe('reactivateInstitutionAction', () => {
  beforeEach(() => {
    vi.mocked(reactivateInstitution).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  it('requires a reason, matching deactivate', async () => {
    const result = await reactivateInstitutionAction('school-1', '   ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/reason is required/i);
    }
    expect(reactivateInstitution).not.toHaveBeenCalled();
  });

  it('reactivates and refreshes the institutions list', async () => {
    vi.mocked(reactivateInstitution).mockResolvedValue({
      id: 'school-1',
      status: 'ACTIVE',
    } as Awaited<ReturnType<typeof reactivateInstitution>>);

    const result = await reactivateInstitutionAction('school-1', ' Wing reopened ');
    expect(result).toEqual({ success: true, data: { id: 'school-1', status: 'ACTIVE' } });
    expect(reactivateInstitution).toHaveBeenCalledWith('school-1', 'Wing reopened');
    expect(revalidatePath).toHaveBeenCalledWith('/institutions');
    expect(revalidatePath).toHaveBeenCalledWith('/institutions/school-1/overview');
  });
});
