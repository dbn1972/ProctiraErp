/**
 * HN-F4-R1: gradebook student picker options never carry the national ID.
 */
import { describe, expect, it } from 'vitest';

import type { Student } from '@/lib/api/students';

import { toGradebookStudentOption } from './student-options';

const student = (overrides: Partial<Student>): Student => ({
  id: 'stu-1',
  firstName: 'Asha',
  lastName: 'Menon',
  dateOfBirth: '2012-01-01',
  gender: 'female',
  nationalId: 'NID-4455-6677',
  nationality: null,
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('toGradebookStudentOption (HN-F4-R1)', () => {
  it('uses the name only when there is no gradebook or admission code', () => {
    const option = toGradebookStudentOption(student({}));
    expect(option).toEqual({ id: 'stu-1', label: 'Asha Menon', searchText: 'Asha Menon' });
    expect(JSON.stringify(option)).not.toContain('NID-4455');
  });

  it('falls back to the admission number, never the national ID', () => {
    const option = toGradebookStudentOption(student({ customData: { admissionNumber: 'ADM-31' } }));
    expect(option).toEqual({
      id: 'stu-1',
      label: 'ADM-31 · Asha Menon',
      searchText: 'Asha Menon ADM-31',
    });
  });

  it('prefers the gradebook code when the tenant records one', () => {
    const option = toGradebookStudentOption(
      student({ customData: { gradebookCode: 'GB-9', admissionNumber: 'ADM-31' } }),
    );
    expect(option.label).toBe('GB-9 · Asha Menon');
    expect(option.searchText).toBe('Asha Menon GB-9');
  });
});
