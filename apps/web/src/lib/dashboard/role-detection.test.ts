import { describe, expect, it } from 'vitest';

import { detectDashboardRole, dashboardRoleLabel } from './role-detection';

describe('W2-UX-04 role dashboard detection', () => {
  it('maps staff and guardian distinctly (not principal fallback)', () => {
    expect(detectDashboardRole([{ roleId: 'staff', roleName: 'Staff' }])).toBe('staff');
    expect(detectDashboardRole([{ roleId: 'guardian', roleName: 'Guardian' }])).toBe('parent');
    expect(detectDashboardRole([{ roleId: 'teacher', roleName: 'Teacher' }])).toBe('teacher');
    expect(detectDashboardRole([{ roleId: 'admin', roleName: 'Administrator' }])).toBe('principal');
  });

  it('does not collapse unknown roles into principal', () => {
    expect(detectDashboardRole([{ roleId: 'librarian', roleName: 'Librarian' }])).toBe('staff');
    expect(dashboardRoleLabel('staff')).toBe('Staff');
  });
});
