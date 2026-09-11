import { describe, expect, it } from 'vitest';

import { assertStaffAccess, hasStaffAccess } from './staff-access.js';

describe('staff-access', () => {
  it('allows HR officers and admins to create/update staff', () => {
    expect(hasStaffAccess(['hr_officer'], 'staff.create')).toBe(true);
    expect(hasStaffAccess([{ roleName: 'REGISTRAR' }], 'staff.hr.write')).toBe(true);
    expect(hasStaffAccess(['admin'], 'payroll.export')).toBe(true);
  });

  it('denies teacher / viewer mutations', () => {
    expect(hasStaffAccess(['teacher'], 'staff.create')).toBe(false);
    expect(hasStaffAccess(['viewer'], 'staff.import')).toBe(false);
    expect(hasStaffAccess([], 'staff.delete')).toBe(false);
    expect(() => assertStaffAccess(['teacher'], 'staff.create')).toThrow(/Forbidden/);
  });
});
