/**
 * Unit tests for the student form zod schemas.
 * Validates the rules implementing Requirement 6.1 (mandatory name + DOB),
 * Requirement 6.3 (transfer reason), and Requirement 6.5 (custom data).
 */
import { describe, expect, it } from 'vitest';

import {
  guardianSchema,
  identityDocumentSchema,
  studentFormSchema,
  transferFormSchema,
} from './student-schema';

const baseStudent = {
  firstName: 'Aisha',
  lastName: 'Khan',
  dateOfBirth: '2010-04-15',
  gender: 'female',
  nationalId: '',
  nationality: '',
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
};

describe('studentFormSchema', () => {
  it('accepts a minimal valid record (Requirement 6.1)', () => {
    const result = studentFormSchema.safeParse(baseStudent);
    expect(result.success).toBe(true);
  });

  it('rejects missing first name', () => {
    const result = studentFormSchema.safeParse({ ...baseStudent, firstName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['firstName']?.[0]).toMatch(/required/i);
    }
  });

  it('rejects missing last name', () => {
    const result = studentFormSchema.safeParse({ ...baseStudent, lastName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['lastName']?.[0]).toMatch(/required/i);
    }
  });

  it('rejects an invalid date of birth format', () => {
    const result = studentFormSchema.safeParse({
      ...baseStudent,
      dateOfBirth: '15/04/2010',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['dateOfBirth']?.[0]).toMatch(
        /YYYY-MM-DD/i,
      );
    }
  });

  it('accepts arbitrary key/value pairs in customData (Requirement 6.5)', () => {
    const result = studentFormSchema.safeParse({
      ...baseStudent,
      customData: { religion: 'Muslim', favouriteColor: 'Teal', isScholarship: true },
    });
    expect(result.success).toBe(true);
  });

  it('rejects guardians with malformed email', () => {
    const result = studentFormSchema.safeParse({
      ...baseStudent,
      guardians: [
        {
          firstName: 'Sara',
          lastName: 'Khan',
          relationship: 'mother',
          contactPhone: '',
          contactEmail: 'not-an-email',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('guardianSchema', () => {
  it('treats blank optional fields as valid', () => {
    const result = guardianSchema.safeParse({
      firstName: 'Yusuf',
      lastName: 'Ali',
      relationship: 'father',
      contactPhone: '',
      contactEmail: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('identityDocumentSchema', () => {
  it('rejects malformed expiry dates', () => {
    const result = identityDocumentSchema.safeParse({
      type: 'passport',
      number: 'A1234567',
      issuingCountry: '',
      expiryDate: '12/01/2030',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty expiry date', () => {
    const result = identityDocumentSchema.safeParse({
      type: 'passport',
      number: 'A1234567',
      issuingCountry: '',
      expiryDate: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('transferFormSchema', () => {
  const baseTransfer = {
    sourceEnrollmentId: '7d4d3a89-3ec0-4a1b-9f9e-7db8b4e2ad21',
    destinationInstitutionId: 'a8e3a89f-1a7f-4f51-b1ad-3eaa4c3df24f',
    destinationGradeId: '1a7f1a7f-1a7f-4f51-b1ad-3eaa4c3df24f',
    destinationClassId: '',
    academicPeriodId: 'b8e3a89f-1a7f-4f51-b1ad-3eaa4c3df24f',
    transferDate: '2025-09-01',
    reason: 'Family relocation across districts.',
  };

  it('accepts a complete transfer payload (Requirement 6.3)', () => {
    expect(transferFormSchema.safeParse(baseTransfer).success).toBe(true);
  });

  it('rejects an empty reason', () => {
    const result = transferFormSchema.safeParse({ ...baseTransfer, reason: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['reason']?.[0]).toMatch(/required/i);
    }
  });

  it('rejects a missing destination institution (Requirement 6.4)', () => {
    const result = transferFormSchema.safeParse({
      ...baseTransfer,
      destinationInstitutionId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['destinationInstitutionId']?.[0]).toMatch(
        /required/i,
      );
    }
  });

  it('caps reason at 500 characters', () => {
    const result = transferFormSchema.safeParse({
      ...baseTransfer,
      reason: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});
