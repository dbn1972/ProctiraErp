/**
 * M1-I1: updateStudentAction forwards the edit form's `updatedAt` so the API
 * can refuse a stale save, and shows the conflict copy for the 409.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({}));
vi.mock('@/lib/institutions/api', () => ({}));
vi.mock('@/lib/api/admin.server', () => ({}));
vi.mock('@/lib/api/students', () => ({ updateStudent: vi.fn() }));
import { GatewayError } from '@/lib/api/gateway';
import { updateStudent } from '@/lib/api/students';
import type { StudentFormValues } from '@/lib/validation/student-schema';
import { updateStudentAction } from './actions';

const SID = '00000000-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-11-24T10:00:00.123Z';
const values: StudentFormValues = {
  firstName: 'Ada',
  lastName: 'First',
  dateOfBirth: '2014-05-01',
  gender: 'female',
  nationalId: '',
  nationality: '',
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
};

describe('updateStudentAction If-Match (M1-I1)', () => {
  beforeEach(() => {
    vi.mocked(updateStudent).mockReset();
  });

  it('passes the loaded updatedAt to the API client', async () => {
    vi.mocked(updateStudent).mockResolvedValue({ id: SID } as never);
    const result = await updateStudentAction(SID, values, UPDATED_AT);
    expect(result.status).toBe('success');
    expect(vi.mocked(updateStudent)).toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ lastName: 'First' }),
      UPDATED_AT,
    );
  });

  it('shows the conflict copy when the record changed since the form loaded', async () => {
    vi.mocked(updateStudent).mockRejectedValue(
      new GatewayError({ status: 409, code: 'CONFLICT', message: 'modified by another request' }),
    );
    const result = await updateStudentAction(SID, values, UPDATED_AT);
    expect(result.status).toBe('error');
    expect(result.message).toContain('This conflicts with an existing record.');
    expect(result.message).not.toContain('modified by another request');
  });
});
