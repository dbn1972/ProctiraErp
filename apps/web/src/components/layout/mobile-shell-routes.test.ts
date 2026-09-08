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
    expect(tabs.map((t) => t.key)).toEqual([
      'home',
      'attendance',
      'students',
      'profile',
    ]);
    expect(drawer.map((d) => d.key)).toEqual([
      'settings',
      'reports',
      'help',
      'signout',
    ]);
  });

  it('has no /app/* SPA dead-prefix links among available destinations', () => {
    expect(
      assertNoDeadAppPrefix([
        ...MOBILE_TAB_DESTINATIONS,
        ...MOBILE_DRAWER_DESTINATIONS,
      ]),
    ).toEqual([]);
  });

  it('points tabs at App Router paths that exist under (dashboard)', () => {
    const byKey = Object.fromEntries(
      MOBILE_TAB_DESTINATIONS.map((d) => [d.key, d.href]),
    );
    expect(byKey.home).toBe('/');
    expect(byKey.attendance).toBe('/attendance');
    expect(byKey.students).toBe('/students');
    expect(byKey.profile).toBe('/admin/users');
  });
});
