'use client';

/**
 * MobileShell — Authenticated chrome for viewports < 768 px.
 *
 * Task 53.2 / Requirement 41 / Design §H, §K.
 *
 * Renders three persistent surfaces:
 *
 *   1. **Sticky top header** — `useBrand().logoUrl` + brand name on the
 *      start, the active page title in the middle, the persistent
 *      `<ConnectivityIndicator>` slot and a hamburger-drawer trigger on
 *      the end. The header sticks to the top of the viewport (`sticky
 *      top-0`) so the brand and connectivity status remain visible while
 *      the page scrolls.
 *
 *   2. **Bottom-tab navigation** — four primary destinations
 *      (Home, Attendance, Students, Profile). Each tab is at least
 *      48 px tall (Requirement 41 AC 3 / 37 AC 3) and pairs an icon
 *      with a visible text label (Requirement 37 AC 4). The active tab
 *      is highlighted using the `--primary` token from the tenant
 *      theme so the chrome adapts to multi-tenant branding without any
 *      hard-coded color references (Requirement 43.2).
 *
 *   3. **Hamburger drawer** — a `<Sheet>` from `@proctira/ui/components`
 *      that exposes less-frequent destinations (Settings, Reports, Help,
 *      Sign out). Each drawer link is also at least 48 px tall.
 *
 * The `<ConnectivityIndicator>` itself is delivered by Task 54.3; this
 * shell mounts a labelled placeholder (`data-testid="connectivity-
 * indicator-placeholder"`) so the slot stays visible from 53.2 onward
 * and 54.3 only has to swap the inner element.
 *
 * `data-shell="mobile"` is preserved so the Task 53.1 `<AppShell>`
 * layout-switch tests continue to pass.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardCheck,
  FileBarChart,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@proctira/ui/components';
import { useBrand } from '@/providers/BrandConfigProvider';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import { CommandPalette } from '@/components/CommandPalette';
import { cn } from '@/lib/utils';
import {
  availableDestinations,
  MOBILE_DRAWER_DESTINATIONS,
  MOBILE_TAB_DESTINATIONS,
} from './mobile-shell-routes';

// ─── Tab configuration ────────────────────────────────────────────────────────

interface MobileTab {
  /** Stable key used for React lists and active-state lookup. */
  key: 'home' | 'attendance' | 'students' | 'profile';
  /** Visible label shown beneath the icon. */
  label: string;
  /** Route the tab links to (App Router — G-404). */
  href: string;
  /** lucide-react icon component. */
  Icon: LucideIcon;
}

const TAB_ICONS: Record<MobileTab['key'], LucideIcon> = {
  home: Home,
  attendance: ClipboardCheck,
  students: Users,
  profile: User,
};

const MOBILE_TABS: readonly MobileTab[] = availableDestinations(MOBILE_TAB_DESTINATIONS).map(
  (d) => ({
    key: d.key as MobileTab['key'],
    label: d.label,
    href: d.href,
    Icon: TAB_ICONS[d.key as MobileTab['key']],
  }),
);

// ─── Drawer configuration ─────────────────────────────────────────────────────

interface DrawerLink {
  key: 'settings' | 'reports' | 'help' | 'signout';
  label: string;
  href: string;
  Icon: LucideIcon;
}

const DRAWER_ICONS: Record<DrawerLink['key'], LucideIcon> = {
  settings: Settings,
  reports: FileBarChart,
  help: HelpCircle,
  signout: LogOut,
};

const DRAWER_LINKS: readonly DrawerLink[] = availableDestinations(
  MOBILE_DRAWER_DESTINATIONS,
).map((d) => ({
  key: d.key as DrawerLink['key'],
  label: d.label,
  href: d.href,
  Icon: DRAWER_ICONS[d.key as DrawerLink['key']],
}));

// ─── Active-tab helper ────────────────────────────────────────────────────────

/**
 * Returns the tab that owns `pathname`, or `null` when no tab matches
 * (e.g., the user is on a less-frequent destination opened from the
 * drawer). A tab "owns" a pathname when the path equals or starts with
 * the tab's `href` — so `/app/students/123/edit` highlights Students.
 */
export function getActiveMobileTab(pathname: string | null | undefined): MobileTab | null {
  if (!pathname) return null;
  // Iterate in declaration order; the more specific tabs (none here have
  // overlapping prefixes) win first. The exact equality check guards
  // against `/app/me/profile` matching anything else.
  for (const tab of MOBILE_TABS) {
    if (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) {
      return tab;
    }
  }
  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MobileShellProps {
  children: React.ReactNode;
  /**
   * Title rendered in the header center. Defaults to the active tab's
   * label so callers that do not supply a title still get a meaningful
   * heading (e.g., "Students" while on `/app/students`).
   */
  pageTitle?: string;
  /**
   * Optional primary action rendered in the header end-slot, between
   * the connectivity indicator and the hamburger trigger. Use this for
   * page-scoped CTAs like "+ New" on list views.
   */
  primaryAction?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileShell({ children, pageTitle, primaryAction }: MobileShellProps) {
  const { logoUrl, name } = useBrand();
  const pathname = usePathname();
  const activeTab = getActiveMobileTab(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Resolve a sensible title even if the caller did not pass one.
  const resolvedTitle = pageTitle ?? activeTab?.label ?? name;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" data-shell="mobile">
      {/* ─── Sticky header (Design §H — brand mark + page title + actions). */}
      <header
        className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-4"
        aria-label="Mobile header"
      >
        {/* Brand logo (Requirement 43.4 — multi-tenant). The alt text uses
            the tenant brand name so screen readers announce the
            correct organization. */}
        <Link
          href="/"
          className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center"
          aria-label={`${name} home`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt={name}
            className="h-7 w-auto"
            data-testid="mobile-shell-brand-logo"
          />
        </Link>

        {/* Page title — flex-1 so it absorbs available space and truncates
            cleanly on narrow viewports. */}
        <h1
          className="flex-1 truncate text-base font-semibold text-foreground"
          data-testid="mobile-shell-title"
        >
          {resolvedTitle}
        </h1>

        {/* Optional primary action (e.g., "+ New" on list pages). */}
        {primaryAction ? (
          <div className="flex shrink-0 items-center" data-testid="mobile-shell-primary-action">
            {primaryAction}
          </div>
        ) : null}

        {/* Persistent connectivity-indicator slot. Task 54.3 will swap this
            placeholder for the live `<ConnectivityIndicator>` component;
            keeping the slot from 53.2 onward avoids a layout shift. */}
        <div
          data-testid="connectivity-indicator-placeholder"
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
        />

        {/* Hamburger drawer trigger — opens the less-frequent destinations
            sheet (Settings / Reports / Help / Sign out). */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation menu"
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="mobile-shell-hamburger"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </SheetTrigger>

          <SheetContent side="right" className="w-72 p-0" data-testid="mobile-shell-drawer">
            <SheetHeader className="border-b border-border p-4">
              <SheetTitle>Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Less-frequent destinations: Settings, Reports, Help, Sign out.
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Secondary navigation" className="flex flex-col py-2">
              {DRAWER_LINKS.map((link) => {
                const Icon = link.Icon;
                return (
                  <Link
                    key={link.key}
                    href={link.href}
                    onClick={() => setDrawerOpen(false)}
                    className="flex h-12 items-center gap-3 px-4 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                    data-testid={`mobile-shell-drawer-link-${link.key}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      {/* ─── Routed page content (the same outlet `<DesktopShell>` wraps).
            Wrapped in `<PageErrorBoundary>` so render errors inside the page
            do NOT crash the header or bottom tabs (Property F-9). */}
      <main className="flex-1 overflow-y-auto p-4 pb-20">
        <PageErrorBoundary>{children}</PageErrorBoundary>
      </main>

      {/* ─── Bottom-tab navigation. Each tab is ≥ 48 px tall and pairs a
            lucide-react icon with a visible text label (Req 37 AC 4 /
            41 AC 3). The active tab uses the tenant `--primary` token. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background"
        aria-label="Mobile navigation"
      >
        <ul className="flex" role="list">
          {MOBILE_TABS.map((tab) => {
            const isActive = activeTab?.key === tab.key;
            const Icon = tab.Icon;
            return (
              <li key={tab.key} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  data-active={isActive ? 'true' : 'false'}
                  data-testid={`mobile-shell-tab-${tab.key}`}
                  className={cn(
                    'flex h-[3rem] min-h-[48px] flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:bg-muted',
                    isActive
                      ? 'text-[hsl(var(--primary))]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Global Command Palette (⌘K / Ctrl+K) — Task 60A.7 */}
      <CommandPalette />
    </div>
  );
}

export default MobileShell;
