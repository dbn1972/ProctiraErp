/**
 * @vitest-environment jsdom
 *
 * Sidebar — tenantIdentitySlot integration tests (Task 11.2/11.3 / Req 1 AC1, AC3).
 *
 * `Sidebar` is a Client Component. It cannot import or invoke the async
 * Server Component `TenantIdentityBlock` (`./TenantIdentityBlock.tsx`)
 * directly — Next.js App Router only allows a Server Component's
 * already-rendered output to cross the boundary as a prop. `sidebar.tsx`
 * accepts that output as `tenantIdentitySlot?: ReactNode` and places it
 * between the logo block and `<nav>`.
 *
 * This file only covers the integration point Task 11.2 adds: does
 * `<Sidebar>` render whatever slot content it is given, in the right
 * position, and does it stay fully functional (nav still renders/works)
 * when no slot content is supplied (the degraded case, produced upstream
 * by `DashboardLayout` — see `apps/web/src/app/(dashboard)/layout.test.tsx`).
 *
 * It deliberately does NOT re-test:
 *   - `TenantIdentityBlock`'s own internals (degradation, formatting,
 *     tenant-name/headcount rendering) — covered by
 *     `TenantIdentityBlock.test.tsx`.
 *   - The keyboard/tab-order contract — covered by
 *     `sidebar.keyboard.test.tsx`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      name: 'Admin',
      roles: ['admin'],
      permissions: ['student.read'],
      scope: { level: 'country' as const },
      tenant_id: 'tenant-1',
    },
    status: 'authenticated' as const,
    isAuthenticated: true,
  }),
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

import { Sidebar } from './sidebar';

// ─── Setup ───────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<Sidebar> — tenantIdentitySlot placement (Task 11.2 / Req 1 AC1)', () => {
  it('renders the supplied slot content between the logo block and the nav landmark', () => {
    render(
      <Sidebar
        tenantIdentitySlot={<div data-testid="tenant-slot">Sunrise Public School</div>}
      />,
    );

    const slot = screen.getByTestId('tenant-slot');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });

    // The slot sits immediately before <nav> ...
    expect(slot.nextElementSibling).toBe(nav);
    // ... and immediately after the logo block (which contains the brand link).
    expect(slot.previousElementSibling?.textContent).toContain('ProctiraERP');
  });

  it('accepts arbitrary already-rendered slot content without inspecting or transforming it', () => {
    render(
      <Sidebar
        tenantIdentitySlot={
          <div data-testid="tenant-slot">
            <span>Greenwood International</span>
            <span>1,240 students</span>
          </div>
        }
      />,
    );

    expect(screen.getByText('Greenwood International')).toBeInTheDocument();
    expect(screen.getByText('1,240 students')).toBeInTheDocument();
  });
});

describe('<Sidebar> — degraded case: no slot content (Req 1 AC3)', () => {
  it('renders nothing extra in the slot position when tenantIdentitySlot is omitted, and the nav stays fully functional', () => {
    render(<Sidebar />);

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const aside = nav.closest('aside');
    expect(aside).not.toBeNull();

    // The logo block's next sibling is directly <nav> — nothing renders
    // between them when there is no slot content.
    const logoBlock = aside!.firstElementChild;
    expect(logoBlock?.nextElementSibling).toBe(nav);

    // The sidebar itself remains fully functional: nav links still render
    // with real hrefs.
    expect(screen.queryByTestId('tenant-slot')).toBeNull();
    expect(screen.getByTestId('sidebar-link-students').getAttribute('href')).toBe('/students');
    expect(screen.getAllByRole('link').length).toBeGreaterThan(1);
  });

  it('renders nothing extra when tenantIdentitySlot is explicitly null (the degraded upstream case)', () => {
    render(<Sidebar tenantIdentitySlot={null} />);

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const aside = nav.closest('aside');
    const logoBlock = aside!.firstElementChild;

    expect(logoBlock?.nextElementSibling).toBe(nav);
    expect(screen.getByTestId('sidebar-link-students')).toBeTruthy();
  });
});
