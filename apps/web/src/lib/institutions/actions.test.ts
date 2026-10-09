/**
 * PRC-L272 — institution server actions validate ids before any gateway call
 * and map non-gateway errors to a generic message (no raw error.message leak).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const api = vi.hoisted(() => ({
  ApiClientError: class ApiClientError extends Error {
    fieldErrors?: { field: string; message: string }[];
    constructor(message: string) {
      super(message);
      this.name = 'ApiClientError';
    }
  },
  updateInstitution: vi.fn(),
  deactivateInstitution: vi.fn(),
  reactivateInstitution: vi.fn(),
  createInstitution: vi.fn(),
  createAcademicPeriod: vi.fn(),
  createCalendarEvent: vi.fn(),
  createClassSection: vi.fn(),
  updateClassSection: vi.fn(),
  createGrade: vi.fn(),
  deleteAcademicPeriod: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  rolloverAcademicPeriod: vi.fn(),
  updateAcademicPeriod: vi.fn(),
}));
vi.mock('./api', () => api);

import {
  updateInstitutionAction,
  deactivateInstitutionAction,
  reactivateInstitutionAction,
} from './actions';

const VALID = '11111111-1111-4111-8111-111111111111';
const values = {} as never;

beforeEach(() => {
  for (const v of Object.values(api))
    if (typeof v === 'function' && 'mockReset' in v) v.mockReset();
});

describe('institution action id validation (PRC-L272)', () => {
  it('rejects a malformed id without calling the gateway (update)', async () => {
    const res = await updateInstitutionAction('not-a-uuid', values);
    expect(res).toMatchObject({ success: false, error: 'Invalid institution id.' });
    expect(api.updateInstitution).not.toHaveBeenCalled();
  });

  it('rejects a malformed id without calling the gateway (deactivate)', async () => {
    const res = await deactivateInstitutionAction('../etc', 'reason');
    expect(res).toMatchObject({ success: false, error: 'Invalid institution id.' });
    expect(api.deactivateInstitution).not.toHaveBeenCalled();
  });

  it('rejects a malformed id without calling the gateway (reactivate)', async () => {
    const res = await reactivateInstitutionAction('xyz', 'reason');
    expect(res).toMatchObject({ success: false, error: 'Invalid institution id.' });
    expect(api.reactivateInstitution).not.toHaveBeenCalled();
  });

  it('maps a non-gateway error to a generic message (no raw leak)', async () => {
    api.deactivateInstitution.mockRejectedValue(new Error('db dsn=postgres://secret@host'));
    const res = await deactivateInstitutionAction(VALID, 'reason');
    expect(res).toMatchObject({ success: false, error: 'Unexpected error. Please try again.' });
    if (!res.success) expect(res.error).not.toContain('postgres');
  });

  it('passes through a gateway ApiClientError message', async () => {
    api.deactivateInstitution.mockRejectedValue(new api.ApiClientError('Not permitted'));
    const res = await deactivateInstitutionAction(VALID, 'reason');
    expect(res).toMatchObject({ success: false, error: 'Not permitted' });
  });
});
