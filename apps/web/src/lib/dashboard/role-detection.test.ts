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

  // PRC-L271: canonical-token matching, not substring includes().
  it('classifies combined/custom role names by whole token, not substring', () => {
    // "board-admin" tokenises to board + admin; board outranks admin → board.
    expect(detectDashboardRole([{ roleId: 'board-admin', roleName: 'Board Admin' }])).toBe('board');
    // "super-admin" → principal (both tokens present).
    expect(detectDashboardRole([{ roleId: 'super-admin', roleName: 'Super Admin' }])).toBe(
      'principal',
    );
    // A custom role whose name merely contains "administrator" as a token.
    expect(detectDashboardRole([{ roleId: 'administrator', roleName: 'Administrator' }])).toBe(
      'principal',
    );
    // A role named "Headteacher" must NOT substring-match "teacher".
    expect(detectDashboardRole([{ roleId: 'headteacher', roleName: 'Headteacher' }])).toBe('staff');
  });

  it('prefers parent/guardian over a co-assigned staff role', () => {
    expect(
      detectDashboardRole([
        { roleId: 'staff', roleName: 'Staff' },
        { roleId: 'guardian', roleName: 'Guardian' },
      ]),
    ).toBe('parent');
  });
});
