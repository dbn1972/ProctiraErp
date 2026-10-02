/**
 * PRC-L052 — dashboard home quick actions are permission-filtered and the
 * header date renders in the tenant timezone, not the server's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DASHBOARD_QUICK_ACTIONS, formatDashboardDate, visibleQuickActions } from './home';

function user(roleIds: string[]) {
  return {
    sub: 'user-1',
    tenantId: 'tenant-a',
    email: 'user@tenant-a.test',
    roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
  };
}

const ids = (roles: string[]) => visibleQuickActions(user(roles)).map((a) => a.id);

describe('PRC-L052 visibleQuickActions', () => {
  it('shows no admin shortcuts to a guardian (parent) session', () => {
    expect(ids(['guardian'])).toEqual([]);
  });

  it('shows nothing when there is no session or no roles', () => {
    expect(visibleQuickActions(null)).toEqual([]);
    expect(ids([])).toEqual([]);
  });

  it('shows only attendance and results to a teacher', () => {
    expect(ids(['teacher'])).toEqual(['mark-attendance', 'enter-results']);
  });

  it('hides write shortcuts from read-only staff', () => {
    expect(ids(['staff'])).toEqual([]);
  });

  it('shows every shortcut to admin, principal and super-admin', () => {
    const all = DASHBOARD_QUICK_ACTIONS.map((a) => a.id);
    expect(ids(['admin'])).toEqual(all);
    expect(ids(['principal'])).toEqual(all);
    expect(ids(['SUPER-ADMIN'])).toEqual(all);
  });
});

describe('PRC-L052 formatDashboardDate', () => {
  // 20:00 UTC on 9 Jan is already 10 Jan (01:30) in Asia/Kolkata.
  const nearIstMidnight = new Date('2026-01-09T20:00:00Z');

  it('uses the tenant timezone rather than the server timezone', () => {
    expect(formatDashboardDate(nearIstMidnight, 'Asia/Kolkata')).toContain('10 January 2026');
    expect(formatDashboardDate(nearIstMidnight, 'UTC')).toContain('9 January 2026');
  });

  it('falls back to Asia/Kolkata for an invalid timezone', () => {
    expect(formatDashboardDate(nearIstMidnight, 'Not/AZone')).toContain('10 January 2026');
  });
});

describe('PRC-L052 dashboard page wiring', () => {
  const page = readFileSync(resolve(__dirname, '../../app/(dashboard)/page.tsx'), 'utf8');

  it('renders quick actions from the permission filter and tenant timezone', () => {
    expect(page).toContain('visibleQuickActions(session?.user)');
    expect(page).toContain('resolveTenantTimezone()');
    expect(page).not.toMatch(/href="\/students\/new"/);
    expect(page).not.toMatch(/toLocaleDateString\(/);
  });
});
