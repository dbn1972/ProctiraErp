import { describe, expect, it } from 'vitest';

import {
  assertScholarshipAccess,
  hasScholarshipAccess,
  normalizeScholarshipRoles,
} from './scholarship-access.js';

describe('scholarship-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeScholarshipRoles(['Bursar', { roleId: 'Finance_Officer' }])).toEqual([
      'bursar',
      'finance_officer',
    ]);
    expect(normalizeScholarshipRoles(null)).toEqual([]);
  });

  it('allows bursar / scholarship_officer for reads and program writes', () => {
    expect(hasScholarshipAccess(['bursar'], 'scholarship.read')).toBe(true);
    expect(hasScholarshipAccess(['scholarship_officer'], 'program.write')).toBe(true);
    expect(hasScholarshipAccess(['financial_aid_officer'], 'application.decide')).toBe(true);
  });

  it('denies teacher and empty roles (fail closed)', () => {
    expect(hasScholarshipAccess(['teacher'], 'scholarship.read')).toBe(false);
    expect(hasScholarshipAccess(['teacher'], 'program.write')).toBe(false);
    expect(hasScholarshipAccess([], 'disbursement.manage')).toBe(false);
    expect(hasScholarshipAccess(undefined, 'compliance.record')).toBe(false);
    expect(() => assertScholarshipAccess(['teacher'], 'program.write')).toThrow(/Forbidden/);
  });

  it('denies registrar approve/reject and disbursement manage', () => {
    expect(hasScholarshipAccess(['registrar'], 'application.decide')).toBe(false);
    expect(hasScholarshipAccess(['registrar'], 'disbursement.manage')).toBe(false);
    expect(hasScholarshipAccess(['registrar'], 'application.submit')).toBe(true);
  });
});
