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

// PRC-L232: the id is validated as a UUID before any gateway call.
const SCHOOL = '55555555-5555-4555-8555-555555555555';

describe('reactivateInstitutionAction', () => {
  beforeEach(() => {
    vi.mocked(reactivateInstitution).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  it('requires a reason, matching deactivate', async () => {
    const result = await reactivateInstitutionAction(SCHOOL, '   ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/reason is required/i);
    }
    expect(reactivateInstitution).not.toHaveBeenCalled();
  });

  it('reactivates and refreshes the institutions list', async () => {
    vi.mocked(reactivateInstitution).mockResolvedValue({
      id: SCHOOL,
      status: 'ACTIVE',
    } as Awaited<ReturnType<typeof reactivateInstitution>>);

    const result = await reactivateInstitutionAction(SCHOOL, ' Wing reopened ');
    expect(result).toEqual({ success: true, data: { id: SCHOOL, status: 'ACTIVE' } });
    expect(reactivateInstitution).toHaveBeenCalledWith(SCHOOL, 'Wing reopened');
    expect(revalidatePath).toHaveBeenCalledWith('/institutions');
    expect(revalidatePath).toHaveBeenCalledWith(`/institutions/${SCHOOL}/overview`);
  });
});

describe('reactivateInstitutionAction id validation (PRC-L232)', () => {
  it('rejects a traversal id without calling the gateway', async () => {
    vi.mocked(reactivateInstitution).mockClear();
    const result = await reactivateInstitutionAction('../plugins/x', 'Wing reopened');
    expect(result.success).toBe(false);
    expect(reactivateInstitution).not.toHaveBeenCalled();
  });
});
