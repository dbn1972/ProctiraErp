/**
 * Unit tests for hostel domain RBAC helpers (W1-SEC-02 residual).
 */
import { describe, expect, it } from 'vitest';

import { assertHostelAccess, hasHostelAccess, normalizeHostelRoles } from './hostel-access.js';

describe('hostel-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeHostelRoles(['Warden', { roleId: 'Registrar' }])).toEqual([
      'warden',
      'registrar',
    ]);
    expect(normalizeHostelRoles(null)).toEqual([]);
  });

  it('allows warden for occupancy and ops actions', () => {
    expect(hasHostelAccess(['warden'], 'hostel.read')).toBe(true);
    expect(hasHostelAccess(['warden'], 'assignment.manage')).toBe(true);
    expect(hasHostelAccess(['warden'], 'ops.write')).toBe(true);
    expect(hasHostelAccess(['bursar'], 'fee.manage')).toBe(true);
  });

  it('denies teacher and empty roles (fail closed)', () => {
    expect(hasHostelAccess(['teacher'], 'hostel.read')).toBe(false);
    expect(hasHostelAccess([], 'facility.write')).toBe(false);
    expect(() => assertHostelAccess(['viewer'], 'assignment.manage')).toThrow(/Forbidden/);
  });

  it('denies teacher fee structure writes', () => {
    expect(hasHostelAccess(['teacher'], 'fee.manage')).toBe(false);
  });
});
