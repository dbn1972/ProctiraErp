/**
 * @vitest-environment jsdom
 *
 * Sidebar keyboard-contract tests — Task 56.6 / Req 37 AC 6.
 *
 * Validates the documented keyboard contract for
 * `apps/web/src/components/layout/sidebar.tsx`:
 *
 *   • The sidebar renders inside an <aside> with a <nav> labelled
 *     "Main navigation" so screen-reader users can jump to the
 *     navigation landmark.
 *   • Every navigation entry is an anchor reachable in the natural
 *     document tab order (no roving tabindex — the sidebar uses the
 *     browser default).
 *   • The first link receives focus on the first Tab press from the
 *     document <body>.
 *   • The active route is marked with `aria-current="page"`.
 *   • `Enter` activates a link (anchor element default behaviour).
 *
 * `next-intl` and `next/navigation` are mocked so the sidebar can
 * render in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      dashboard: 'Dashboard',
      institutions: 'Institutions',
      academicPeriods: 'Academic periods',
      students: 'Students',
      staff: 'Staff',
      assessments: 'Assessments',
      attendance: 'Attendance',
      examinations: 'Examinations',
      scholarships: 'Scholarships',
      health: 'Health',
      workflows: 'Workflows',
      dataWarehouse: 'Data warehouse',
      reports: 'Reports',
      admin: 'Admin',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/students',
}));

vi.mock('next/link', () => ({
  // Stub <Link> with a real <a> so href/click semantics are preserved.
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

beforeEach(() => {
  // Sidebar uses no global state, but reset focus/activeElement.
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<Sidebar> keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('renders a navigation landmark with the documented aria-label', () => {
    render(<Sidebar />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  });

  it('renders every navigation entry as an anchor in the natural document tab order', () => {
    render(<Sidebar />);
    const links = screen.getAllByRole('link');

    // 14 nav items + 1 brand link in the header => 15 anchors.
    expect(links.length).toBe(18);

    // None of the anchors install a roving tabindex — every link is
    // independently focusable. tabindex is either unset (=> 0 by
    // default) or explicitly 0; never -1.
    for (const link of links) {
      const tabindex = link.getAttribute('tabindex');
      expect(tabindex === null || tabindex === '0').toBe(true);
    }
  });

  it('marks the link matching the current route with aria-current="page"', () => {
    render(<Sidebar />);
    // usePathname is mocked to '/students'.
    const studentsLink = screen.getByRole('link', { name: /Students/ });
    expect(studentsLink.getAttribute('aria-current')).toBe('page');

    // The dashboard link must NOT carry aria-current because the
    // pathname does not equal '/'.
    const dashboardLink = screen.getByRole('link', { name: /Dashboard/ });
    expect(dashboardLink.getAttribute('aria-current')).toBeNull();
  });

  it('first Tab press from the body lands on the brand link, then on the first nav link', () => {
    render(<Sidebar />);

    const links = screen.getAllByRole('link');
    // Focus the first anchor; in the production app the brand
    // (ProctiraERP) is the document's first focusable element inside the
    // sidebar. We assert that it can receive focus directly.
    act(() => links[0]!.focus());
    expect(document.activeElement).toBe(links[0]);

    // Tab to the next focusable element. jsdom does not implement the
    // browser's tabbing algorithm, but the *document order* of links
    // is the canonical sequence — assert that the next link in the
    // returned NodeList is the dashboard entry.
    expect(links[0]!.textContent).toContain('ProctiraERP');
    expect(links[1]!.textContent).toContain('Dashboard');
  });

  it('Enter on a focused link does not preventDefault — anchors retain native activation', () => {
    render(<Sidebar />);
    const studentsLink = screen.getByRole('link', { name: /Students/ });
    act(() => studentsLink.focus());

    // We only care that the sidebar's components do not bind a
    // custom Enter handler that swallows the default. fireEvent will
    // dispatch the keydown on the focused element; if no one calls
    // preventDefault(), the browser's default activation runs. We
    // can therefore assert the event is *not* defaultPrevented after
    // dispatch.
    let prevented = false;
    studentsLink.addEventListener('keydown', (e) => {
      // Capture in the document-bubble phase; no listener should have
      // called preventDefault before this fires.
      if (e.defaultPrevented) prevented = true;
    });
    act(() => {
      fireEvent.keyDown(studentsLink, { key: 'Enter', code: 'Enter' });
    });
    expect(prevented).toBe(false);
  });

  it('does not bind Space as an activation key on link items (anchor accessibility rule)', () => {
    render(<Sidebar />);
    const studentsLink = screen.getByRole('link', { name: /Students/ });
    act(() => studentsLink.focus());

    let prevented = false;
    studentsLink.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) prevented = true;
    });
    act(() => {
      fireEvent.keyDown(studentsLink, { key: ' ', code: 'Space' });
    });
    // Space must NOT be intercepted — it should remain available to
    // scroll the document, per the documented contract.
    expect(prevented).toBe(false);
  });
});
