'use client';

import { Bell, HelpCircle, LogOut, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@proctira/ui/components';

import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { signOut } from '@/lib/auth';
import { initialsFromName } from '@/lib/institutions/directory-presentation';
import { useDirectoryContext } from '@/lib/institutions/use-directory-context';
import { useAuth } from '@/providers/AuthProvider';
import { useOptionalBrand } from '@/providers/BrandConfigProvider';

/**
 * Top header bar for the dashboard layout (Design System v2.0).
 * Global search (opens the ⌘K command palette), theme toggle, language
 * switcher, help link, notification bell, and the user menu with logout
 * action.
 *
 * Identity (Requirement 2 AC1, AC2, AC8): `displayName`/`roles`/`tenantId`
 * come from `useAuth()`'s `AuthUser` — populated server-side by
 * `authUserFromTokenPayload()` (`@/lib/auth/auth-user.ts`), which already
 * falls back to `email` when the session's `displayName` is empty/absent
 * (Req 2 AC2). The tenant/organisation name and role label shown as
 * subtext reuse `useDirectoryContext()` — the SAME same-origin,
 * bearer-token-scoped source (`GET /api/v1/institutions/directory-context`)
 * the sidebar's tenant switcher already uses — rather than a second,
 * separately-defined tenant-name fetch, so header and sidebar can never
 * disagree about which tenant is showing (Req 2 AC8).
 *
 * Help (Req 2 AC3, AC4): a bare link into the existing `/help` route, no
 * new content, no fork.
 *
 * Notification bell (Req 2 AC5, AC6, AC7): fetches the same-origin
 * `GET /api/v1/notifications/unread-count` route, which itself calls
 * `getUnreadNotificationCount()` (`@/lib/api/notifications-inbox`) against
 * the real `GET /notifications/user/:userId/unread-count` gateway endpoint
 * (a single indexed `COUNT(*)` query, optionally Redis-cached) rather than
 * fetching every notification and counting client-side. Degrades to a
 * plain bell with no badge on zero, a negative/non-finite value, or a
 * fetch failure — never an error state in the header itself (Req 2.7).
 */
export function Header({ onOpenMenu }: { onOpenMenu?: () => void } = {}) {
  const t = useTranslations('auth');
  const { user, status } = useAuth();
  const brand = useOptionalBrand();
  const directory = useDirectoryContext();

  const displayName = user?.name?.trim() || 'Account';
  const roleLabel = (user?.roles?.[0] ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const orgName = directory?.organizationName?.trim() || brand?.name?.trim();
  const subtitle = [roleLabel, orgName].filter(Boolean).join(' · ');

  async function handleLogout() {
    await signOut('/login');
  }

  /** Open the global CommandPalette by dispatching its ⌘K shortcut. */
  function openCommandPalette() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  }

  return (
    <header
      data-testid="desktop-shell-header"
      className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 sm:px-6 dark:bg-card"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onOpenMenu ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-label="Open navigation menu"
            data-testid="desktop-shell-menu"
            onClick={onOpenMenu}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        {/* Global search — opens the command palette */}
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-transparent bg-muted px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-input hover:bg-card"
          aria-label="Search (Ctrl+K)"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span className="truncate">Search students, staff, invoices…</span>
          <kbd className="ms-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side - user actions */}
      <div className="flex shrink-0 items-center gap-3">
        <ThemeToggle />
        <LanguageSelector />

        <NotificationBell />

        {/* Help (Req 2 AC3, AC4) — plain link into the existing /help
            route. No new content, no fork. */}
        <Link
          href="/help"
          aria-label="Help"
          data-testid="header-help-link"
          className="inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Link>

        {status === 'loading' ? (
          <div
            className="flex items-center gap-2"
            data-testid="header-user-skeleton"
            aria-hidden="true"
          >
            <span className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <span className="hidden h-8 w-28 animate-pulse rounded-md bg-muted sm:block" />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-2 rounded-full py-1 pe-2 ps-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Account menu for ${displayName}`}
                data-testid="header-user-identity"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-semibold text-primary-foreground"
                  data-testid="header-display-name-avatar"
                >
                  {initialsFromName(displayName)}
                </span>
                <span className="hidden text-start leading-tight sm:block">
                  <span
                    className="block text-sm font-semibold text-foreground"
                    data-testid="header-display-name"
                  >
                    {displayName}
                  </span>
                  {subtitle ? (
                    <span
                      className="block text-[11px] text-muted-foreground"
                      data-testid="header-identity-subtext"
                    >
                      {subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                {t('logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/**
 * Caps the notification badge's displayed number so a large unread count
 * doesn't stretch the corner dot/badge — the same "9+" convention used by
 * most notification affordances. Only affects display.
 */
const MAX_DISPLAYED_NOTIFICATION_COUNT = 9;

function formatNotificationBadgeCount(count: number): string {
  return count > MAX_DISPLAYED_NOTIFICATION_COUNT
    ? `${MAX_DISPLAYED_NOTIFICATION_COUNT}+`
    : String(count);
}

/**
 * Notification bell (Task 12.3 / Req 2.5, 2.6, 2.7).
 *
 * Fetches the same-origin `GET /api/v1/notifications/unread-count` route
 * (`@/app/api/v1/notifications/unread-count/route.ts`) — a thin Route
 * Handler that itself calls `getUnreadNotificationCount()`
 * (`@/lib/api/notifications-inbox`), the gateway's real, indexed
 * `COUNT(*)` aggregate (Task 3.2/3.5), not a client-side count over the
 * full inbox list. This indirection exists because `getUnreadNotificationCount()`
 * depends on `next/headers` (via `gatewayFetch`) and cannot be called
 * directly from this Client Component. Renders a plain bell with no
 * badge when the count is zero, negative/non-finite (defensive — never
 * trust an upstream number blindly), the user is not yet authenticated,
 * or the fetch failed — never an error state in the header itself.
 */
function NotificationBell() {
  const { status } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    void fetch('/api/v1/notifications/unread-count', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { unread: 0 };
        return (await response.json()) as { unread?: number };
      })
      .then((body) => {
        const count = typeof body.unread === 'number' ? body.unread : 0;
        setUnread(count > 0 && Number.isFinite(count) ? count : 0);
      })
      .catch(() => {
        setUnread(0);
      });
    return () => controller.abort();
  }, [status]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href="/notifications"
      aria-label={label}
      data-testid="header-notifications-link"
      className="relative inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {unread > 0 ? (
        <span
          className="absolute end-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
          data-testid="header-notifications-badge"
          aria-hidden="true"
        >
          {formatNotificationBadgeCount(unread)}
        </span>
      ) : null}
    </Link>
  );
}
