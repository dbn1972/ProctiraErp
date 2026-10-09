/**
 * PRC-M128 — student list status and graduate-eligibility are derived from the
 * real active enrollment, not from free-form customData (which defaulted every
 * student to "Enrolled").
 */
import { describe, expect, it } from 'vitest';

import type { EnrollmentEntry } from '@/lib/api/students';

import { canGraduateFromEnrollment, deriveEnrollmentStatus } from './load-student-placement';

const enrolled = { id: 'e1', status: 'ENROLLED' } as EnrollmentEntry;
const withdrawn = { id: 'e2', status: 'WITHDRAWN' } as EnrollmentEntry;

describe('deriveEnrollmentStatus (PRC-M128)', () => {
  it('returns the real enrollment status when present', () => {
    expect(deriveEnrollmentStatus(enrolled)).toBe('ENROLLED');
    expect(deriveEnrollmentStatus(withdrawn)).toBe('WITHDRAWN');
  });

  it('returns NOT_ENROLLED when there is no active enrollment (never defaults to ENROLLED)', () => {
    expect(deriveEnrollmentStatus(null)).toBe('NOT_ENROLLED');
  });
});

describe('canGraduateFromEnrollment (PRC-M128)', () => {
  it('only an active ENROLLED student can graduate', () => {
    expect(canGraduateFromEnrollment(enrolled)).toBe(true);
    expect(canGraduateFromEnrollment(withdrawn)).toBe(false);
    expect(canGraduateFromEnrollment(null)).toBe(false);
  });
});
