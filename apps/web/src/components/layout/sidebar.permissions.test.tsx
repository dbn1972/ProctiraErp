/**
 * @vitest-environment jsdom
 *
 * PRC-H028: session permissions are derived from roles so teachers can reach
 * Attendance / Students / Assessments from the sidebar and Ctrl+K palette,
 * campus modules are no longer visible to every staff user, and
 * parents/guardians only see the parent portal.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { authUserFromTokenPayload } from '@/lib/auth/auth-user';
import type { TokenPayload } from '@/lib/auth/session';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/institutions/use-directory-context', () => ({
  useDirectoryContext: () => null,
}));
vi.mock('@/providers/BrandConfigProvider', () => ({
  useOptionalBrand: () => null,
}));

let currentUser: ReturnType<typeof authUserFromTokenPayload> | null = null;
vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: currentUser, status: 'authenticated' as const, isAuthenticated: true }),
}));

import { Sidebar } from './sidebar';
import { buildPaletteItems } from '@/components/CommandPalette';

function userWithRoles(...roleIds: string[]) {
  const payload = {
    sub: 'u1',
    email: 'user@example.org',
    tenantId: 't1',
    roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'a1' })),
  } as unknown as TokenPayload;
  return authUserFromTokenPayload(payload);
}

function sidebarLinks(): string[] {
  return screen
    .queryAllByTestId(/^sidebar-link-/)
    .map((el) => el.getAttribute('data-testid')!.replace('sidebar-link-', ''));
}

describe('PRC-H028 — role-derived navigation access', () => {
  beforeEach(() => {
    cleanup();
    currentUser = null;
  });

  it('session permissions are populated from roles (not [])', () => {
    const user = userWithRoles('teacher');
    expect(user.permissions).toEqual(
      expect.arrayContaining(['attendance.read', 'student.read', 'assessment.read']),
    );
  });

  it.each(['teacher', 'class_teacher'])(
    '%s sees attendance, students and assessments in sidebar and palette',
    (role) => {
      currentUser = userWithRoles(role);
      render(<Sidebar />);
      const links = sidebarLinks();
      expect(links).toEqual(expect.arrayContaining(['attendance', 'students', 'assessments']));

      const hrefs = buildPaletteItems(currentUser.permissions, currentUser.roles).map(
        (i) => i.href,
      );
      expect(hrefs).toEqual(expect.arrayContaining(['/attendance', '/students', '/assessments']));
    },
  );

  it('attendance officer / registrar reach attendance from the sidebar', () => {
    for (const role of ['attendance_officer', 'registrar']) {
      cleanup();
      currentUser = userWithRoles(role);
      render(<Sidebar />);
      expect(sidebarLinks()).toContain('attendance');
    }
  });

  it('librarian does not see Fees or Hostel unless granted', () => {
    currentUser = userWithRoles('librarian');
    render(<Sidebar />);
    const links = sidebarLinks();
    expect(links).toContain('library');
    expect(links).not.toContain('fees');
    expect(links).not.toContain('hostel');
    expect(links).not.toContain('transport');

    const hrefs = buildPaletteItems(currentUser.permissions, currentUser.roles).map((i) => i.href);
    expect(hrefs).toContain('/library');
    expect(hrefs).not.toContain('/fees');
    expect(hrefs).not.toContain('/hostel');
  });

  it('parent / guardian still sees only the parent portal', () => {
    for (const role of ['parent', 'guardian']) {
      cleanup();
      currentUser = userWithRoles(role);
      render(<Sidebar />);
      const links = sidebarLinks().filter(
        (key) => !['dashboard', 'help', 'notifications'].includes(key),
      );
      expect(links).toEqual(['parentPortal']);

      const hrefs = buildPaletteItems(currentUser.permissions, currentUser.roles).map(
        (i) => i.href,
      );
      expect(hrefs).toEqual(['/parent']);
    }
  });
});
