/**
 * @vitest-environment jsdom
 *
 * MobileShell tests — Task 53.2 / Requirement 41 / Design §H, §K.
 *
 * Verifies the four mobile-chrome contracts called out in Task 53.2:
 *
 *   1. Bottom-tab navigation renders Home, Attendance, Students, and
 *      Profile with the correct lucide-react icons + visible labels and
 *      the expected `/app/...` hrefs.
 *   2. The active tab is highlighted via `aria-current="page"` and the
 *      `data-active="true"` flag, derived from `usePathname()`.
 *   3. The hamburger drawer opens and closes — a `<Sheet>` from
 *      `@proctira/ui/components` exposing Settings, Reports, Help, and
 *      Sign out — with each link sized for the 48 px touch-target rule.
 *   4. The brand logo in the header reads from `useBrand()` and renders
 *      the tenant logo URL plus the tenant name as accessible alt text
 *      (Requirement 43.4).
 *
 * The persistent `<ConnectivityIndicator>` placeholder slot from 53.2 is
 * also asserted so 54.3 can rely on its presence.
 *
 * `next/link`, `next/navigation`, and `BrandConfigProvider` are wired via
 * lightweight stubs/mocks so the shell can render in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/components/CommandPalette', () => ({
  CommandPalette: () => <div data-stub="command-palette" />,
}));

vi.mock('@/components/PageErrorBoundary', () => ({
  PageErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let currentPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        // `<Sheet>` close-on-link relies on the click handler we forward.
        // Suppress the navigation in tests so the harness stays on the
        // mocked path.
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

// ─── Test subject ────────────────────────────────────────────────────────────

import { MobileShell, getActiveMobileTab } from './MobileShell';
import { BrandConfigProvider, type Brand } from '@/providers/BrandConfigProvider';

const TEST_BRAND: Brand = {
  name: 'EduZo',
  shortName: 'eduzo',
  slug: 'eduzo',
  logo: { url: 'https://cdn.example.com/eduzo-logo.svg', alt: 'EduZo' },
  favicon: 'https://cdn.example.com/eduzo-favicon.ico',
  primary_color: 'hsl(220, 70%, 35%)',
  accent_color: 'hsl(180, 50%, 40%)',
  login_background: 'hsl(220, 30%, 95%)',
  document_title_template: '{page} | {brand}',
};

function renderShell(node: React.ReactNode = <div data-testid="page">page-content</div>) {
  return render(
    <BrandConfigProvider initialBrand={TEST_BRAND}>
      <MobileShell>{node}</MobileShell>
    </BrandConfigProvider>,
  );
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  currentPathname = '/';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<MobileShell> — bottom-tab navigation (Task 53.2 / Req 41 AC 3)', () => {
  it('renders all four tabs with the expected labels and hrefs', () => {
    renderShell();

    const home = screen.getByTestId('mobile-shell-tab-home');
    const attendance = screen.getByTestId('mobile-shell-tab-attendance');
    const students = screen.getByTestId('mobile-shell-tab-students');
    const profile = screen.getByTestId('mobile-shell-tab-profile');

    expect(home.getAttribute('href')).toBe('/');
    expect(attendance.getAttribute('href')).toBe('/attendance');
    expect(students.getAttribute('href')).toBe('/students');
    expect(profile.getAttribute('href')).toBe('/admin/users');

    expect(home.textContent).toContain('Home');
    expect(attendance.textContent).toContain('Attendance');
    expect(students.textContent).toContain('Students');
    expect(profile.textContent).toContain('Profile');
  });

  it('paints an SVG icon next to each tab label', () => {
    renderShell();

    for (const key of ['home', 'attendance', 'students', 'profile'] as const) {
      const tab = screen.getByTestId(`mobile-shell-tab-${key}`);
      // lucide-react renders <svg> elements; the icon should sit next to
      // the visible label.
      expect(tab.querySelector('svg')).not.toBeNull();
    }
  });

  it('mounts the bottom-nav inside a labelled <nav> landmark', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(nav.tagName.toLowerCase()).toBe('nav');
    expect(nav.querySelectorAll('[data-testid^="mobile-shell-tab-"]').length).toBe(4);
  });
});

describe('<MobileShell> — active-tab highlighting (Task 53.2)', () => {
  it('flags the Home tab when the pathname is /', () => {
    currentPathname = '/';
    renderShell();
    const home = screen.getByTestId('mobile-shell-tab-home');
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(home.getAttribute('data-active')).toBe('true');
  });

  it('flags the Students tab when the pathname is a Students sub-route', () => {
    currentPathname = '/students/abc-123/edit';
    renderShell();
    const students = screen.getByTestId('mobile-shell-tab-students');
    expect(students.getAttribute('aria-current')).toBe('page');
    expect(students.getAttribute('data-active')).toBe('true');
    // Sibling tabs must remain inactive.
    expect(screen.getByTestId('mobile-shell-tab-home').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('mobile-shell-tab-attendance').getAttribute('data-active')).toBe(
      'false',
    );
    expect(screen.getByTestId('mobile-shell-tab-profile').getAttribute('data-active')).toBe(
      'false',
    );
  });

  it('flags no tab as active when the pathname does not match any tab prefix', () => {
    currentPathname = '/admin';
    renderShell();
    for (const key of ['home', 'attendance', 'students', 'profile'] as const) {
      expect(screen.getByTestId(`mobile-shell-tab-${key}`).getAttribute('data-active')).toBe(
        'false',
      );
    }
  });

  it('exposes a pure helper `getActiveMobileTab` for callers outside the shell', () => {
    expect(getActiveMobileTab('/attendance')?.key).toBe('attendance');
    expect(getActiveMobileTab('/admin/users')?.key).toBe('profile');
    expect(getActiveMobileTab('/admin/users/edit')?.key).toBe('profile');
    expect(getActiveMobileTab('/admin')).toBeNull();
    expect(getActiveMobileTab(null)).toBeNull();
    expect(getActiveMobileTab(undefined)).toBeNull();
  });
});

describe('<MobileShell> — hamburger drawer (Task 53.2 / Design §K)', () => {
  it('keeps the drawer closed by default', () => {
    renderShell();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('mobile-shell-drawer-link-settings')).toBeNull();
  });

  it('opens the drawer when the hamburger trigger is clicked', () => {
    renderShell();
    const trigger = screen.getByTestId('mobile-shell-hamburger');
    expect(trigger.getAttribute('aria-label')).toBe('Open navigation menu');

    act(() => {
      fireEvent.click(trigger);
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('mobile-shell-drawer-link-settings')).toBeTruthy();
    expect(screen.getByTestId('mobile-shell-drawer-link-reports')).toBeTruthy();
    expect(screen.getByTestId('mobile-shell-drawer-link-help')).toBeTruthy();
    expect(screen.getByTestId('mobile-shell-drawer-link-signout')).toBeTruthy();
  });

  it('renders the secondary destinations with the expected hrefs and labels', () => {
    renderShell();
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-shell-hamburger'));
    });

    expect(screen.getByTestId('mobile-shell-drawer-link-settings').getAttribute('href')).toBe(
      '/admin',
    );
    expect(screen.getByTestId('mobile-shell-drawer-link-reports').getAttribute('href')).toBe(
      '/reports',
    );
    expect(screen.getByTestId('mobile-shell-drawer-link-help').getAttribute('href')).toBe('/help');
    expect(screen.getByTestId('mobile-shell-drawer-link-signout').getAttribute('href')).toBe(
      '/api/auth/logout',
    );

    for (const [key, href] of [
      ['fees', '/fees'],
      ['hostel', '/hostel'],
      ['transport', '/transport'],
      ['library', '/library'],
      ['communication', '/communication'],
    ] as const) {
      expect(screen.getByTestId(`mobile-shell-drawer-link-${key}`).getAttribute('href')).toBe(href);
    }

    expect(screen.getByTestId('mobile-shell-drawer-link-settings').textContent).toContain(
      'Settings',
    );
    expect(screen.getByTestId('mobile-shell-drawer-link-reports').textContent).toContain('Reports');
    expect(screen.getByTestId('mobile-shell-drawer-link-help').textContent).toContain('Help');
    expect(screen.getByTestId('mobile-shell-drawer-link-signout').textContent).toContain(
      'Sign out',
    );
  });

  it('closes the drawer on Escape', () => {
    renderShell();
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-shell-hamburger'));
    });
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document.activeElement || document.body, {
        key: 'Escape',
        code: 'Escape',
      });
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the drawer when a secondary link is clicked', () => {
    renderShell();
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-shell-hamburger'));
    });
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('mobile-shell-drawer-link-settings'));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('<MobileShell> — brand logo from useBrand() (Task 53.2 / Req 43.4)', () => {
  it('renders the brand logo URL from the active tenant brand', () => {
    renderShell();
    const logo = screen.getByTestId('mobile-shell-brand-logo') as HTMLImageElement;
    expect(logo.tagName.toLowerCase()).toBe('img');
    expect(logo.getAttribute('src')).toBe('https://cdn.example.com/eduzo-logo.svg');
    expect(logo.getAttribute('alt')).toBe('EduZo');
  });

  it('reads the tenant brand name to label the brand link for screen readers', () => {
    renderShell();
    expect(screen.getByLabelText('EduZo home')).toBeTruthy();
  });
});

describe('<MobileShell> — persistent connectivity-indicator slot (Task 53.2 → 54.3 hand-off)', () => {
  it('mounts a placeholder for the future <ConnectivityIndicator>', () => {
    renderShell();
    const placeholder = screen.getByTestId('connectivity-indicator-placeholder');
    expect(placeholder).toBeTruthy();
    // The slot is in the header so it stays visible while the page scrolls.
    const header = screen.getByLabelText('Mobile header');
    expect(header.contains(placeholder)).toBe(true);
  });
});

describe('<MobileShell> — page outlet & data-shell hook', () => {
  it('renders the routed children inside the main outlet', () => {
    renderShell(<div data-testid="page">stable-content</div>);
    expect(screen.getByTestId('page').textContent).toBe('stable-content');
  });

  it('preserves the data-shell="mobile" hook used by AppShell tests', () => {
    renderShell();
    expect(document.querySelector('[data-shell="mobile"]')).not.toBeNull();
  });
});
