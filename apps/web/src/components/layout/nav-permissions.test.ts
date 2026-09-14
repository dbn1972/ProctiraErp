import { describe, expect, it } from 'vitest';

import { filterNavItemsByAccess, type NavPermissionItem } from './nav-permissions';

const SAMPLE: NavPermissionItem[] = [
  { key: 'dashboard', href: '/', icon: 'HomeIcon', requiredPermissions: [] },
  {
    key: 'students',
    href: '/students',
    icon: 'UsersIcon',
    requiredPermissions: ['student.read'],
    hideForRoleSubstrings: ['parent', 'guardian'],
  },
  {
    key: 'admin',
    href: '/admin',
    icon: 'CogIcon',
    requiredPermissions: [],
    requiredRoleSubstrings: ['admin', 'principal', 'super-admin'],
    hideForRoleSubstrings: ['parent', 'guardian'],
  },
  {
    key: 'parentPortal',
    href: '/parent',
    icon: 'UserGroupIcon',
    requiredPermissions: [],
    requiredRoleSubstrings: ['parent', 'guardian'],
  },
];

describe('W2-UX-03 sidebar permission gating', () => {
  it('hides permissioned modules when the user lacks grants', () => {
    const visible = filterNavItemsByAccess(SAMPLE, [], ['teacher']);
    expect(visible.map((i) => i.key)).toEqual(['dashboard']);
  });

  it('shows modules the user is granted and hides admin from teachers', () => {
    const visible = filterNavItemsByAccess(
      SAMPLE,
      ['student.read', 'settings.read'],
      ['teacher'],
    );
    expect(visible.map((i) => i.key)).toEqual(['dashboard', 'students']);
  });

  it('shows admin for administrator roles', () => {
    const visible = filterNavItemsByAccess(SAMPLE, [], ['admin']);
    expect(visible.map((i) => i.key)).toEqual(['dashboard', 'admin']);
  });

  it('shows parent portal only for guardian/parent roles', () => {
    const guardian = filterNavItemsByAccess(SAMPLE, ['student.read'], ['guardian']);
    expect(guardian.map((i) => i.key)).toEqual(['dashboard', 'parentPortal']);

    const staff = filterNavItemsByAccess(SAMPLE, ['student.read'], ['staff']);
    expect(staff.map((i) => i.key)).toEqual(['dashboard', 'students']);
  });
});
