import { describe, expect, it } from 'vitest';

import {
  assertNoDeadAppPrefix,
  availableDestinations,
  MOBILE_DRAWER_DESTINATIONS,
  MOBILE_TAB_DESTINATIONS,
} from './mobile-shell-routes';

describe('G-404 MobileShell route audit', () => {
  it('exposes only available tab + drawer destinations', () => {
    const tabs = availableDestinations(MOBILE_TAB_DESTINATIONS);
    const drawer = availableDestinations(MOBILE_DRAWER_DESTINATIONS);
    // PRC-L259: Profile is hidden until a self-profile page exists.
    expect(tabs.map((t) => t.key)).toEqual(['home', 'attendance', 'students']);
    expect(drawer.map((d) => d.key)).toEqual([
      'fees',
      'hostel',
      'transport',
      'library',
      'communication',
      'settings',
      'reports',
      'help',
      'signout',
    ]);
  });

  it('has no /app/* SPA dead-prefix links among available destinations', () => {
    expect(
      assertNoDeadAppPrefix([...MOBILE_TAB_DESTINATIONS, ...MOBILE_DRAWER_DESTINATIONS]),
    ).toEqual([]);
  });

  it('points tabs at App Router paths that exist under (dashboard)', () => {
    const byKey = Object.fromEntries(MOBILE_TAB_DESTINATIONS.map((d) => [d.key, d.href]));
    expect(byKey.home).toBe('/');
    expect(byKey.attendance).toBe('/attendance');
    expect(byKey.students).toBe('/students');
  });

  it('never points Profile at /admin/users or sign-out at a GET API link (PRC-L259)', () => {
    const profile = MOBILE_TAB_DESTINATIONS.find((d) => d.key === 'profile');
    expect(profile?.available).toBe(false);
    const signout = MOBILE_DRAWER_DESTINATIONS.find((d) => d.key === 'signout');
    expect(signout?.href).toBe('/logout');
    const all = [...MOBILE_TAB_DESTINATIONS, ...MOBILE_DRAWER_DESTINATIONS];
    expect(all.filter((d) => d.available && d.href.startsWith('/api/'))).toEqual([]);
    expect(all.filter((d) => d.available && d.href === '/admin/users')).toEqual([]);
  });
});
