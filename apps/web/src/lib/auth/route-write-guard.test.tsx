/**
 * PRC-M480: staff write routes deny student/parent sessions and allow the roles the
 * gateway grants the matching write permission.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionAction } from '@proctira/auth';
import type { ServerSession } from '@/lib/auth/server';

let current: ServerSession | null = null;
vi.mock('@/lib/auth/server', () => ({
  getSession: vi.fn(async () => current),
  requireSession: vi.fn(async () => current),
}));

import LmsBankLayout from '@/app/(dashboard)/lms/bank/layout';
import LmsRubricsLayout from '@/app/(dashboard)/lms/rubrics/layout';
import { sessionHasPermission } from './permission-guards';
import { RequireRoutePermission } from './route-write-guard';

function sessionWithRoles(roleIds: string[]): ServerSession {
  return {
    accessToken: 't',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'u1',
      tenantId: 'tenant-a',
      email: 'u@tenant-a.test',
      roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  } as ServerSession;
}

/**
 * Action each staff-tool layout gates on. LMS bank/rubrics use `update` because
 * students hold `lms:create` for learner submissions (PRC-M015).
 */
const LAYOUT_ACTION: Record<string, PermissionAction> = {
  lms: 'update',
  library: 'create',
  institution: 'create',
};

async function renderGuard(resource: string) {
  const ui = await RequireRoutePermission({
    resource,
    action: LAYOUT_ACTION[resource],
    returnTo: '/x',
    children: <p>staff tool</p>,
  });
  render(ui);
}

beforeEach(() => {
  current = null;
});

describe('RequireRoutePermission (PRC-M480)', () => {
  it.each([
    ['student', 'lms'],
    ['student', 'library'],
    ['guardian', 'library'],
    ['staff', 'library'],
  ])('denies %s on %s write routes', async (role, resource) => {
    current = sessionWithRoles([role]);
    await renderGuard(resource);
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(screen.queryByText('staff tool')).toBeNull();
  });

  it.each([
    ['teacher', 'lms'],
    ['admin', 'lms'],
    ['principal', 'library'],
    ['admin', 'institution'],
  ])('allows %s on %s write routes', async (role, resource) => {
    current = sessionWithRoles([role]);
    await renderGuard(resource);
    expect(screen.getByText('staff tool')).toBeTruthy();
  });

  it('mirrors gateway LMS grants for teachers without granting library writes', () => {
    const teacher = sessionWithRoles(['teacher']);
    expect(sessionHasPermission(teacher, 'lms', 'update')).toBe(true);
    expect(sessionHasPermission(teacher, 'library', 'create')).toBe(false);
  });

  it.each([
    ['/lms/bank', LmsBankLayout],
    ['/lms/rubrics', LmsRubricsLayout],
  ])('%s layout gates on lms:update', (_path, Layout) => {
    const el = Layout({ children: null });
    expect(el.type).toBe(RequireRoutePermission);
    expect(el.props).toMatchObject({ resource: 'lms', action: LAYOUT_ACTION.lms });
  });

  it('students may submit LMS work but not author staff LMS tools', () => {
    const student = sessionWithRoles(['student']);
    expect(sessionHasPermission(student, 'lms', 'create')).toBe(true);
    expect(sessionHasPermission(student, 'lms', 'update')).toBe(false);
  });
});
