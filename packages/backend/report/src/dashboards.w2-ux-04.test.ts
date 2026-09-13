import { describe, expect, it } from 'vitest';

import {
  buildRoleDashboard,
  inferDashboardRole,
  resolveDashboardRole,
} from './dashboards.js';

describe('W2-UX-04 role dashboards', () => {
  it('treats staff as its own dashboard (not teacher/principal)', () => {
    expect(inferDashboardRole([{ roleName: 'STAFF' }])).toBe('staff');
    expect(inferDashboardRole([{ roleId: 'librarian' }])).toBe('staff');
    expect(buildRoleDashboard('staff').cards[0]?.id).toContain('staff');
  });

  it('keeps principal for admins and does not use it as unknown fallback', () => {
    expect(inferDashboardRole([{ roleName: 'Administrator' }])).toBe('principal');
    expect(inferDashboardRole([{ roleName: 'mystery-role' }])).toBe('staff');
  });

  it('forbids staff from requesting principal aggregates', () => {
    expect(() => resolveDashboardRole([{ roleName: 'STAFF' }], 'principal')).toThrow(
      /cannot fetch principal/i,
    );
  });
});
