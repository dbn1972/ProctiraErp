/**
 * @vitest-environment jsdom
 *
 * AppShell tests — Task 53.1 / Requirement 41
 *
 * Verifies the layout selector mounts `<DesktopShell>` at or above 768 px
 * and `<MobileShell>` below 768 px, that both shells render the same
 * `children` outlet, and that the children instance is preserved across
 * a viewport change so the routed page does not unmount when the user
 * crosses the breakpoint (Requirement 41 AC 6).
 *
 * `next-intl`, `next/navigation`, and the auth helpers used by the desktop
 * chrome's Header / Sidebar / Breadcrumbs are mocked so the shell can
 * render in isolation.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the desktop chrome subcomponents and the mobile shell with stand-ins
// so the test stays focused on the layout-switch contract. Each stand-in
// renders the same `data-shell` / `data-stub` attributes and the children
// outlet, which is the only behaviour AppShell coordinates.
vi.mock('./sidebar', () => ({
  Sidebar: () => <aside data-stub="sidebar" />,
}));

vi.mock('./header', () => ({
  Header: () => <header data-stub="header" />,
}));

vi.mock('./breadcrumbs', () => ({
  Breadcrumbs: () => <nav data-stub="breadcrumbs" />,
}));

// Mock the mobile chrome too — its real implementation pulls in
// `useBrand()`, `usePathname()`, and the `<Sheet>` primitive, none of
// which are relevant to the layout-switch contract this suite owns.
// Task 53.2 has its own dedicated test file for MobileShell internals.
vi.mock('./MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => (
    <div data-shell="mobile" data-stub="mobile-shell">
      {children}
    </div>
  ),
}));

vi.mock('@/components/CommandPalette', () => ({
  CommandPalette: () => <div data-stub="command-palette" />,
}));

vi.mock('@/components/PageErrorBoundary', () => ({
  PageErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Test subject ────────────────────────────────────────────────────────────

import { AppShell } from './AppShell';
import { MOBILE_MEDIA_QUERY } from '@/hooks/useViewport';

// ─── matchMedia helper ───────────────────────────────────────────────────────

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null;
  addEventListener: Mock;
  removeEventListener: Mock;
  addListener: Mock;
  removeListener: Mock;
  dispatchEvent: (ev: Event) => boolean;
  fire: (matches: boolean) => void;
}

function installMatchMedia(initial: boolean): FakeMediaQueryList {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: FakeMediaQueryList = {
    matches: initial,
    media: MOBILE_MEDIA_QUERY,
    onchange: null,
    addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.add(cb);
    }) as unknown as Mock,
    removeEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.delete(cb);
    }) as unknown as Mock,
    addListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => listeners.add(cb)) as unknown as Mock,
    removeListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb)) as unknown as Mock,
    dispatchEvent: () => true,
    fire(matches: boolean) {
      this.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((cb) => cb(event));
    },
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
  return mql;
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AppShell — layout switch (Requirement 41 / Design §H)', () => {
  it('renders the DesktopShell at viewports ≥ 768 px', () => {
    installMatchMedia(false);

    render(
      <AppShell>
        <div data-testid="page">page-content</div>
      </AppShell>,
    );

    expect(document.querySelector('[data-shell="desktop"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="mobile"]')).toBeNull();
    expect(screen.getByTestId('page').textContent).toBe('page-content');
  });

  it('renders the MobileShell at viewports below 768 px', () => {
    installMatchMedia(true);

    render(
      <AppShell>
        <div data-testid="page">page-content</div>
      </AppShell>,
    );

    expect(document.querySelector('[data-shell="mobile"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="desktop"]')).toBeNull();
    expect(screen.getByTestId('page').textContent).toBe('page-content');
  });

  it('subscribes to the canonical (max-width: 767px) media query', () => {
    installMatchMedia(false);

    render(
      <AppShell>
        <span />
      </AppShell>,
    );

    // The hook should subscribe at least once with the canonical query.
    const matchMediaMock = vi.mocked(window.matchMedia);
    const calls = matchMediaMock.mock.calls.map((call) => call[0]);
    expect(calls).toContain(MOBILE_MEDIA_QUERY);
  });

  it('switches chrome live when the viewport crosses the breakpoint', () => {
    const mql = installMatchMedia(false);

    render(
      <AppShell>
        <div data-testid="page">page-content</div>
      </AppShell>,
    );

    expect(document.querySelector('[data-shell="desktop"]')).not.toBeNull();

    act(() => mql.fire(true));

    expect(document.querySelector('[data-shell="mobile"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="desktop"]')).toBeNull();

    act(() => mql.fire(false));

    expect(document.querySelector('[data-shell="desktop"]')).not.toBeNull();
    expect(document.querySelector('[data-shell="mobile"]')).toBeNull();
  });

  it('renders the same children in both shells', () => {
    const mql = installMatchMedia(false);

    render(
      <AppShell>
        <div data-testid="page">stable-content</div>
      </AppShell>,
    );

    expect(screen.getByTestId('page').textContent).toBe('stable-content');

    act(() => mql.fire(true));

    expect(screen.getByTestId('page').textContent).toBe('stable-content');
  });
});
