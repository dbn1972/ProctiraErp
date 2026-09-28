'use client';

import Link from 'next/link';
import { Bell, HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@proctira/ui/components';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { signOut } from '@/lib/auth';

/**
 * Real session identity for the header's user menu (Task 12.1, Req 2.1,
 * 2.2, 2.8).
 *
 * Resolved server-side by `DashboardLayout` (`apps/web/src/app/(dashboard)/layout.tsx`,
 * which already calls `requireSession()`) and threaded down through
 * `AppShell` → `DesktopShell` as plain data — mirroring the
 * `tenantIdentitySlot` pattern already used for the sidebar (a Server
 * Component's output crossing into a Client Component only as a prop),
 * but as flat data rather than a pre-rendered element. A pre-rendered
 * slot made sense for `TenantIdentityBlock` because it renders icons and
 * formatted markup; here there is nothing to pre-render — `Header` is
 * already the place that formats/styles the identity alongside its other
 * controls, so plain strings are simpler to thread and let `Header` own
 * the presentation.
 */
export interface HeaderIdentity {
  /** Raw session `displayName` (`TokenPayload.displayName`) — may be empty or absent. */
  displayName?: string | null;
  /**
   * Session email. Used as the `displayName` fallback (Req 2.2) via the
   * identical rule `authUserFromTokenPayload()` already implements
   * (`displayName?.trim() || email`) — inlined below rather than
   * re-derived differently, since `Header` receives this flattened shape
   * rather than a raw `TokenPayload` (which is what that helper expects).
   */
  email: string;
  /**
   * Human-readable label for the session's "primary" role.
   *
   * `TokenPayload.roles` is an array — a user can hold more than one role
   * assignment (e.g. principal at one campus, teacher at another) — and
   * nothing elsewhere in this codebase ranks or selects a single "primary"
   * role for display. Absent any precedent, `primaryRoleFromTokenPayload()`
   * (`@/lib/auth/auth-user.ts`) defines "primary" as simply the first role
   * assignment in claim order (`roles[0]`), preferring its human-readable
   * `roleName` over the raw `roleId`. `null` when the session carries no
   * role assignments at all.
   */
  primaryRole: string | null;
  /**
   * Tenant/school display name. Sourced from `TenantSettings.displayName`
   * (`getTenantSettings()`) — the SAME source and field the sidebar's
   * `TenantIdentityBlock` (Requirement 1) already uses — rather than the
   * raw `tenantId` UUID on the session token, because Requirement 2's own
   * intent ("so I don't have to... guess what my logged-in identity is")
   * calls for a legible identifier, and a UUID is not one. `null` when
   * tenant settings are unavailable.
   */
  tenantName: string | null;
  /**
   * Unread notification count for the notification bell (Task 12.3, Req
   * 2.5, 2.6, 2.7). Resolved server-side by `DashboardLayout` via
   * `getUnreadNotificationCount(session.user.sub)` — the SAME "resolve
   * once in the layout, thread down as flat data" pattern already used
   * for the rest of `HeaderIdentity` — rather than fetched client-side,
   * since `getUnreadNotificationCount()` depends on `next/headers` and
   * cannot run inside this Client Component.
   *
   * Optional (not just nullable) because a caller could omit `identity`
   * entirely (see `HeaderProps.identity`'s own doc comment); when absent
   * OR the upstream fetch failed, `Header` renders a plain bell with no
   * badge — never an error state — per Req 2.7. `DashboardLayout`
   * degrades a failed fetch to `0` itself (`.catch(() => 0)`), so `0` and
   * "absent" both mean the same thing here: nothing to show.
   */
  unreadNotificationCount?: number;
}

export interface HeaderProps {
  /**
   * Real session identity (Req 2.1, 2.2, 2.8). Optional only for
   * defensive typing — `DashboardLayout` always supplies it in practice,
   * since it calls `requireSession()` (redirecting unauthenticated users)
   * before resolving this data. Even so, `Header` never renders blank
   * text for the name: it falls back to `email`, and further to a
   * generic label, rather than an empty string, if `identity` itself is
   * ever missing (Task 12.1 item 4).
   */
  identity?: HeaderIdentity;
}

/**
 * Caps the notification badge's displayed number so a large unread count
 * doesn't stretch the corner badge or crowd the bell icon — the same
 * "9+" convention used by most notification affordances. Only affects
 * display; the underlying count is otherwise used as-is (e.g. in the
 * accessible name).
 */
const MAX_DISPLAYED_NOTIFICATION_COUNT = 9;

function formatNotificationBadgeCount(count: number): string {
  return count > MAX_DISPLAYED_NOTIFICATION_COUNT
    ? `${MAX_DISPLAYED_NOTIFICATION_COUNT}+`
    : String(count);
}

/**
 * Top header bar for the dashboard layout (Design System v2.0).
 * Global search (opens the ⌘K command palette), theme toggle, language
 * switcher, help link, notification bell, and the user identity + logout
 * action.
 */
export function Header({ identity }: HeaderProps = {}) {
  const t = useTranslations('auth');

  // Req 2.1/2.2: real display name, falling back to email, and never a
  // hardcoded placeholder or blank string — the identical fallback rule
  // `authUserFromTokenPayload()` already implements, inlined here since
  // `identity` is a flattened shape rather than a raw `TokenPayload`.
  const displayName = identity?.displayName?.trim() || identity?.email?.trim() || 'Account';
  const avatarInitial = displayName.charAt(0).toUpperCase();
  // Req 2.5/2.6/2.7: a plain bell with no badge when the count is zero,
  // negative/non-finite (defensive — never trust an upstream number
  // blindly), or `identity` itself lacks this field (not supplied, or
  // `DashboardLayout`'s fetch failed upstream and degraded to `0`
  // already). Never an error state in the header itself.
  const unreadNotificationCount =
    typeof identity?.unreadNotificationCount === 'number' &&
    Number.isFinite(identity.unreadNotificationCount) &&
    identity.unreadNotificationCount > 0
      ? identity.unreadNotificationCount
      : 0;
  // Primary role + tenant name, joined the same "·" separator already used
  // for secondary metadata elsewhere in this dashboard (e.g. the pending
  // approvals list). Omitted (not blank) when both are unavailable.
  const identitySubtext = [identity?.primaryRole, identity?.tenantName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

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
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-white/85 px-6 backdrop-blur dark:bg-card/85">
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
        <span className="truncate">Search students, staff, schools…</span>
        <kbd className="ms-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Right side - user actions */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Theme Toggle (Task 47.4) */}
        <ThemeToggle />

        {/* Language Selector (Task 48.3) — native-name dropdown over the
            Indian_Language_Set + the Arabic RTL pilot. */}
        <LanguageSelector />

        {/* Help (Task 12.2) — plain link into the existing /help route.
            No new content, no fork; matches the ThemeToggle/LanguageSelector
            icon-button sizing so the cluster reads as one coherent set. */}
        <Button asChild variant="ghost" size="icon" className="min-h-[48px] min-w-[48px]">
          <Link href="/help" aria-label="Help" data-testid="header-help-link">
            <HelpCircle className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>

        {/* Notifications (Task 12.3, Req 2.5, 2.6, 2.7) — plain link into
            the existing /notifications route (the same route the
            sidebar's 'notifications' nav item already points to), same
            bare-icon-link pattern as the help link above. A numeral
            badge overlaps the bell's top-right corner when there is an
            unread count to show; otherwise this renders a plain bell —
            never an error state, even if the count couldn't be fetched. */}
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="relative min-h-[48px] min-w-[48px]"
        >
          <Link
            href="/notifications"
            aria-label={
              unreadNotificationCount > 0
                ? `Notifications, ${unreadNotificationCount} unread`
                : 'Notifications'
            }
            data-testid="header-notifications-link"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadNotificationCount > 0 ? (
              <span
                className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
                data-testid="header-notifications-badge"
                aria-hidden="true"
              >
                {formatNotificationBadgeCount(unreadNotificationCount)}
              </span>
            ) : null}
          </Link>
        </Button>

        {/* User Menu (Task 12.1, Req 2.1, 2.2, 2.8) — real session identity:
            initials avatar + display name (falling back to email), with
            primary role and tenant name as a muted subtext line, instead
            of a hardcoded "U" circle with no accompanying text. */}
        <div className="flex items-center gap-2" data-testid="header-user-identity">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)]"
            aria-hidden="true"
          >
            <span className="text-sm font-semibold text-white">{avatarInitial}</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span
              className="max-w-[10rem] truncate text-sm font-semibold text-foreground"
              data-testid="header-display-name"
              title={displayName}
            >
              {displayName}
            </span>
            {identitySubtext ? (
              <span
                className="max-w-[10rem] truncate text-xs text-muted-foreground"
                data-testid="header-identity-subtext"
                title={identitySubtext}
              >
                {identitySubtext}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t('logout')}
          </button>
        </div>
      </div>
    </header>
  );
}
